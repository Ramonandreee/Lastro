/**
 * Documentos oficiais do ativo (CVM — dados abertos) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Lista Fatos Relevantes, Comunicados ao Mercado, Avisos aos Acionistas e
 * demais eventos entregues à CVM, com link de download do documento oficial.
 * Fonte: portal de dados abertos da CVM (dataset IPE). Os arquivos anuais são
 * ZIPs contendo um CSV; descompactamos server-side com zlib (sem dependência).
 * Só é alcançável a partir do Brasil — a Vercel roda em gru1 (São Paulo).
 *
 * Uso: GET /api/documents?ticker=PETR4&name=Petroleo%20Brasileiro&cnpj=33000167000101
 */
import { inflateRawSync } from 'zlib';

const IPE_BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS';
const KEEP_CATEGORIES = [
  'fato relevante', 'comunicado ao mercado', 'aviso aos acionistas',
  'assembleia', 'calendário de eventos corporativos', 'política',
  'informações sobre dividendos', 'reunião', 'apresentações a analistas',
];

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

// Baixa um arquivo binário. Retorna { buf, status, url, err }.
async function fetchBuf(url, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LastroBot/1.0)', 'Accept': '*/*' }, signal: ctrl.signal });
    if (!r.ok) return { buf: null, status: r.status, url };
    const ab = await r.arrayBuffer();
    return { buf: Buffer.from(ab), status: r.status, url };
  } catch (e) {
    return { buf: null, status: 0, url, err: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Extrai o primeiro CSV de um ZIP (via central directory), decodifica latin1.
function unzipFirstCsv(buf) {
  // localiza o End of Central Directory (0x06054b50), varrendo do fim
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + fnLen);
    if (/\.csv$/i.test(name)) {
      // cabeçalho local: recalcula início dos dados
      const lhFnLen = buf.readUInt16LE(localOff + 26);
      const lhExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lhFnLen + lhExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      const raw = method === 8 ? inflateRawSync(comp) : comp; // 8=deflate, 0=stored
      return raw.toString('latin1');
    }
    p += 46 + fnLen + extraLen + commentLen;
  }
  return null;
}

async function fetchCsv(year, ms = 25000) {
  const url = `${IPE_BASE}/ipe_cia_aberta_${year}.zip`;
  const r = await fetchBuf(url, ms);
  if (!r.buf) return { text: null, status: r.status, url, err: r.err };
  try {
    return { text: unzipFirstCsv(r.buf), status: r.status, url };
  } catch (e) {
    return { text: null, status: r.status, url, err: 'unzip: ' + String((e && e.message) || e) };
  }
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(';').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(';'));
  return { header, rows };
}

function colIndex(header, ...names) {
  const norm = header.map((h) => normalize(h).replace(/ /g, '_'));
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const ticker = String(q.ticker || '').trim().toUpperCase();
  const wantName = normalize(q.name);
  const wantCnpj = onlyDigits(q.cnpj);
  const nameTokens = wantName.split(' ').filter((t) => t.length >= 4).slice(0, 2);

  if (!ticker && !wantName && !wantCnpj) {
    return res.status(400).json({ error: 'informe ticker + name (ou cnpj)' });
  }

  try {
    const year = new Date().getFullYear();
    const [cur, prev] = await Promise.all([fetchCsv(year), fetchCsv(year - 1)]);
    if (!cur.text && !prev.text) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({
        error: 'CVM indisponível',
        diag: [
          { year, status: cur.status, url: cur.url, err: cur.err || null },
          { year: year - 1, status: prev.status, url: prev.url, err: prev.err || null },
        ],
        docs: [],
      });
    }

    const docs = [];
    for (const csv of [cur, prev]) {
      const text = csv && csv.text;
      if (!text) continue;
      const { header, rows } = parseCsv(text);
      const iNome = colIndex(header, 'nome_companhia');
      const iCnpj = colIndex(header, 'cnpj_companhia');
      const iCat = colIndex(header, 'categoria');
      const iTipo = colIndex(header, 'tipo');
      const iAssunto = colIndex(header, 'assunto');
      const iDataRef = colIndex(header, 'data_referencia');
      const iDataEnt = colIndex(header, 'data_entrega');
      const iLink = colIndex(header, 'link_download');
      if (iNome < 0 || iLink < 0) continue;

      for (const r of rows) {
        const nome = normalize(r[iNome]);
        const cnpj = onlyDigits(r[iCnpj]);
        const matchCnpj = wantCnpj && cnpj && cnpj === wantCnpj;
        const matchName = nameTokens.length && nameTokens.every((t) => nome.includes(t));
        if (!matchCnpj && !matchName) continue;
        const cat = (r[iCat] || '').toLowerCase();
        if (!KEEP_CATEGORIES.some((c) => cat.includes(c))) continue;
        docs.push({
          categoria: r[iCat] || null,
          tipo: r[iTipo] || null,
          assunto: r[iAssunto] || null,
          dataRef: r[iDataRef] || null,
          dataEntrega: r[iDataEnt] || null,
          link: (r[iLink] || '').trim() || null,
          empresa: r[iNome] || null,
        });
      }
    }

    docs.sort((a, b) => String(b.dataEntrega || '').localeCompare(String(a.dataEntrega || '')));
    const out = docs.slice(0, 40);

    res.setHeader('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=43200');
    return res.status(200).json({ ticker, count: out.length, docs: out });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar CVM', detail: String((e && e.message) || e), docs: [] });
  }
}
