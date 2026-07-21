/**
 * Universo completo de ativos (brapi.dev /quote/list).
 * ────────────────────────────────────────────────────────────────────
 * Retorna TODAS as ações, FIIs e BDRs disponíveis (ticker, nome, preço,
 * variação, setor, valor de mercado, logo) numa única resposta, cacheada
 * na borda. O front mescla isso nas listas, mantendo os fundamentos
 * profundos dos ativos curados. Roda em gru1 (vercel.json).
 *
 * Env: BRAPI_TOKEN
 */
const BRAPI = 'https://brapi.dev/api';

const SECTOR_PT = {
  'Finance': 'Financeiro', 'Energy Minerals': 'Petróleo e Gás', 'Non-Energy Minerals': 'Mineração',
  'Utilities': 'Energia/Saneamento', 'Retail Trade': 'Varejo', 'Consumer Services': 'Consumo Serviços',
  'Consumer Non-Durables': 'Consumo', 'Consumer Durables': 'Bens de Consumo', 'Health Technology': 'Saúde',
  'Health Services': 'Saúde', 'Process Industries': 'Indústria', 'Producer Manufacturing': 'Bens Industriais',
  'Electronic Technology': 'Tecnologia', 'Technology Services': 'Tecnologia', 'Transportation': 'Logística',
  'Communications': 'Telecom', 'Commercial Services': 'Serviços', 'Industrial Services': 'Serviços Industriais',
  'Distribution Services': 'Distribuição', 'Miscellaneous': 'Diversos',
};

async function fetchJson(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

async function list(type, token) {
  const d = await fetchJson(`${BRAPI}/quote/list?type=${type}&token=${encodeURIComponent(token)}&limit=10000`);
  const arr = (d && d.stocks) || [];
  return arr.map(s => ({
    tk: s.stock || s.symbol,
    nm: s.name || s.stock,
    seg: SECTOR_PT[s.sector] || s.sector || 'Outros',
    px: typeof s.close === 'number' ? s.close : 0,
    var: typeof s.change === 'number' ? s.change : 0,
    mkt: s.market_cap || null,
    logo: s.logo || null,
  })).filter(x => x.tk);
}

export default async function handler(req, res) {
  const token = process.env.BRAPI_TOKEN || '';
  if (!token) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ stocks: [], funds: [], bdrs: [], note: 'BRAPI_TOKEN ausente no servidor' });
  }
  try {
    const [stocks, funds, bdrs] = await Promise.all([list('stock', token), list('fund', token), list('bdr', token)]);
    // universo muda pouco intradia: cacheia 15 min na borda
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({ stocks, funds, bdrs });
  } catch (e) {
    console.error('[universe] erro', String((e && e.message) || e));   // detalhe fica no log, não vai ao cliente
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar brapi list' });
  }
}
