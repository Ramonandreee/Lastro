/**
 * Cadastro de fundos da CVM (cad_fi) — taxa de administração + patrimônio líquido REAIS.
 * ────────────────────────────────────────────────────────────────────
 * O brapi não fornece patrimônio nem taxa de administração de ETFs (Fundos de Índice).
 * A CVM publica no cadastro geral de fundos (cad_fi.csv) as colunas TAXA_ADM e
 * VL_PATRIM_LIQ (com DT_PATRIM_LIQ) de TODO fundo — inclusive ETFs e FIIs. Casamos o
 * fundo pelo NOME (o informe é por CNPJ, sem ticker), com unicidade (só aplica se um
 * único fundo bater) — nada de dado no fundo errado.
 *
 * Só alcançável do Brasil (Vercel gru1). CSV único (latin1, ';').
 *
 * Uso:
 *   GET /api/fundinfo?names=iShares%20Ibovespa|IT%20Now%20IBOV   (lote — 1 download)
 *   GET /api/fundinfo?name=CSHG%20Logistica                      (único)
 * Resposta (lote): { results: [{ query, cnpj, nome, taxaAdm, patrimonio, dtPatrim }], dataSource:'cvm' }
 */
const CAD_URL = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv';

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
function parseNum(s) {
  let t = String(s == null ? '' : s).trim();
  if (!t) return null;
  const hasComma = t.includes(','), hasDot = t.includes('.');
  if (hasComma && hasDot) t = t.replace(/\./g, '').replace(',', '.');
  else if (hasComma) t = t.replace(',', '.');
  const n = Number(t);
  return isFinite(n) ? n : null;
}
const STOP = new Set(['fii', 'fdo', 'fundo', 'fundos', 'inv', 'invest', 'investimento', 'imob', 'imobiliario', 'imobiliaria', 'de', 'do', 'da', 'dos', 'das', 'the', 'and', 'em', 'acoes', 'indice', 'fic', 'ie']);
function tokens(nm) { return normalize(nm).split(' ').filter((t) => t.length >= 3 && !STOP.has(t)); }

async function fetchText(url, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LastroBot/1.0)', 'Accept': 'text/csv,*/*' }, signal: ctrl.signal });
    if (!r.ok) return { text: null, status: r.status };
    const ab = await r.arrayBuffer();
    return { text: Buffer.from(ab).toString('latin1'), status: r.status };
  } catch (e) {
    return { text: null, status: 0, err: String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

function colIndex(header, ...names) {
  const norm = header.map((h) => normalize(h).replace(/ /g, '_'));
  for (const n of names) { const i = norm.indexOf(n); if (i >= 0) return i; }
  return -1;
}

// Lê o cad_fi e devolve a lista de fundos ATIVOS com nome/taxa/patrimônio (compacto p/ match).
function parseFundos(text) {
  const nl = text.indexOf('\n');
  if (nl < 0) return [];
  const header = text.slice(0, nl).replace(/\r$/, '').split(';');
  const iCnpj = colIndex(header, 'cnpj_fundo', 'cnpj_fundo_classe', 'cnpj');
  const iNome = colIndex(header, 'denom_social', 'denominacao_social', 'nome_fundo');
  const iTaxa = colIndex(header, 'taxa_adm');
  const iPl = colIndex(header, 'vl_patrim_liq');
  const iDt = colIndex(header, 'dt_patrim_liq');
  const iSit = colIndex(header, 'sit');
  if (iCnpj < 0 || iNome < 0) return [];
  const out = [];
  let start = nl + 1;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = len;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    const c = line.split(';');
    const nome = (c[iNome] || '').trim();
    if (!nome) continue;
    if (iSit >= 0) { const sit = normalize(c[iSit]); if (sit && !sit.includes('normal') && !sit.includes('funcionamento')) continue; } // só ativos
    out.push({
      cnpj: onlyDigits(c[iCnpj]),
      nome,
      toks: tokens(nome),
      taxaAdm: iTaxa >= 0 ? parseNum(c[iTaxa]) : null,
      patrimonio: iPl >= 0 ? parseNum(c[iPl]) : null,
      dtPatrim: iDt >= 0 ? (c[iDt] || '').trim() || null : null,
    });
  }
  return out;
}

// match conservador: todos os tokens do pedido no nome do fundo + token distintivo (≥4) + unicidade.
function matchOne(fundos, wantName) {
  const wt = tokens(wantName);
  if (!wt.length || !wt.some((t) => t.length >= 4)) return null;
  const wset = wt;
  let hit = null, count = 0;
  for (const f of fundos) {
    if (wset.every((t) => f.toks.includes(t))) { hit = f; if (++count > 1) return null; }
  }
  return count === 1 ? hit : null;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const namesParam = String(q.names || q.name || '').trim();
  if (!namesParam) return res.status(400).json({ error: 'informe name (ou names separados por |)' });
  const wanted = namesParam.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 60);

  try {
    const r = await fetchText(CAD_URL);
    if (!r.text) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ results: [], note: 'cad_fi indisponível', status: r.status }); }
    const fundos = parseFundos(r.text);
    const results = wanted.map((query) => {
      const m = matchOne(fundos, query);
      return m ? { query, cnpj: m.cnpj, nome: m.nome, taxaAdm: m.taxaAdm, patrimonio: m.patrimonio, dtPatrim: m.dtPatrim } : { query, nome: null };
    });
    // cadastro muda devagar: cache 24h na borda
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({ results, dataSource: 'cvm' });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: [], error: String((e && e.message) || e) });
  }
}
