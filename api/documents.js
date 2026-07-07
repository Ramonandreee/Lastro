/**
 * Documentos oficiais do ativo (CVM — dados abertos) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Lista Fatos Relevantes, Comunicados ao Mercado, Avisos aos Acionistas e
 * demais eventos entregues à CVM, com link de download do documento oficial.
 * Fonte: portal de dados abertos da CVM (dataset IPE — Informações
 * Periódicas e Eventuais). Só é alcançável a partir do Brasil — a Vercel
 * roda em gru1 (São Paulo), então funciona server-side.
 *
 * O CSV do IPE traz TODAS as companhias do ano; filtramos pela companhia do
 * ticker (por nome e/ou CNPJ). Cache longo na borda (documentos mudam devagar).
 *
 * Uso: GET /api/documents?ticker=PETR4&name=Petroleo%20Brasileiro&cnpj=33000167000101
 */
const IPE_BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS';
// categorias relevantes para o investidor (o resto é ruído regulatório)
const KEEP_CATEGORIES = [
  'fato relevante', 'comunicado ao mercado', 'aviso aos acionistas',
  'assembleia', 'calendário de eventos corporativos', 'política',
  'informações sobre dividendos', 'reunião', 'apresentações a analistas',
];

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

async function fetchCsv(year, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${IPE_BASE}/ipe_cia_aberta_${year}.csv`, {
      headers: { 'User-Agent': 'LastroBot/1.0' }, signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return new TextDecoder('latin1').decode(buf); // CVM usa ISO-8859-1
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// parser CSV simples (CVM usa ';' e não usa aspas nos campos)
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
    if (!cur && !prev) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'CVM indisponível', docs: [] });
    }

    const docs = [];
    for (const text of [cur, prev]) {
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

    // documentos mudam devagar: cacheia 2h na borda + serve obsoleto por 12h
    res.setHeader('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=43200');
    return res.status(200).json({ ticker, count: out.length, docs: out });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar CVM', detail: String((e && e.message) || e), docs: [] });
  }
}
