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
const CKAN_PKG = 'https://dados.cvm.gov.br/api/3/action/package_show?id=cia_aberta-doc-ipe';

// Descobre as URLs reais dos CSVs do IPE via catálogo CKAN da CVM (evita chutar caminho).
async function discoverCsvUrls(years, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(CKAN_PKG, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LastroBot/1.0)', 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return { map: {}, status: r.status };
    const j = await r.json();
    const resources = (j && j.result && j.result.resources) || [];
    const map = {};
    for (const res of resources) {
      const url = res && res.url ? String(res.url) : '';
      const m = url.match(/ipe_cia_aberta_(\d{4})\.csv/i);
      if (m && years.includes(Number(m[1]))) map[m[1]] = url;
    }
    return { map, status: r.status };
  } catch (e) {
    return { map: {}, err: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}
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

// Retorna { text, status, url, err } — nunca lança.
async function fetchCsv(url, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LastroBot/1.0; +https://lastro-dun.vercel.app)', 'Accept': 'text/csv,*/*' },
      signal: ctrl.signal,
    });
    if (!r.ok) return { text: null, status: r.status, url };
    const buf = await r.arrayBuffer();
    return { text: new TextDecoder('latin1').decode(buf), status: r.status, url }; // CVM usa ISO-8859-1
  } catch (e) {
    return { text: null, status: 0, url, err: String((e && e.message) || e) };
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
    const years = [year, year - 1];
    // 1) descobre as URLs reais via CKAN; 2) cai para o padrão conhecido se não achar
    const disc = await discoverCsvUrls(years);
    const urlFor = (y) => disc.map[String(y)] || `${IPE_BASE}/ipe_cia_aberta_${y}.csv`;
    const [cur, prev] = await Promise.all([fetchCsv(urlFor(year)), fetchCsv(urlFor(year - 1))]);
    if (!cur.text && !prev.text) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({
        error: 'CVM indisponível',
        ckan: { status: disc.status || null, found: Object.keys(disc.map), err: disc.err || null },
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

    // documentos mudam devagar: cacheia 2h na borda + serve obsoleto por 12h
    res.setHeader('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=43200');
    return res.status(200).json({ ticker, count: out.length, docs: out });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar CVM', detail: String((e && e.message) || e), docs: [] });
  }
}
