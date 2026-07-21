/**
 * Universo de ativos dos EUA (FMP stock-screener) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * O brapi Pro cobre só a B3. Para encher as listas de Stocks (EUA) e ETFs
 * internacionais com CENTENAS de ativos reais, usamos o screener da Financial
 * Modeling Prep, ordenado por valor de mercado. Uma resposta traz ticker, nome,
 * setor, preço e valor de mercado — o front mescla nas listas e o /api/us
 * completa a variação do dia e o P/L das linhas visíveis.
 *
 * Uso: GET /api/usuniverse            (top stocks + top ETFs)
 *      GET /api/usuniverse?kind=etf   (só ETFs)  |  ?kind=stock (só ações)
 * Env: FMP_KEY (Vercel → Environment Variables). Sem chave, retorna vazio.
 */
const FMP = 'https://financialmodelingprep.com/api/v3';

const SECTOR_PT = {
  'Technology': 'Tecnologia', 'Financial Services': 'Financeiro', 'Financial': 'Financeiro',
  'Healthcare': 'Saúde', 'Consumer Cyclical': 'Consumo Cíclico', 'Consumer Defensive': 'Consumo',
  'Communication Services': 'Comunicações', 'Industrials': 'Indústria', 'Energy': 'Energia',
  'Basic Materials': 'Materiais', 'Utilities': 'Utilidades', 'Real Estate': 'Imobiliário',
  'Consumer Goods': 'Consumo', 'Services': 'Serviços', 'Industrial Goods': 'Bens Industriais',
};

const US_TK = /^[A-Z]{1,5}$/;   // só tickers "limpos" (sem ., -, dígitos)

async function fetchJson(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0', Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : null));

// Chama o screener da FMP com filtros e devolve itens já normalizados p/ o front.
async function screen(key, { isEtf, capMin, limit }) {
  const p = new URLSearchParams({
    apikey: key,
    exchange: 'nasdaq,nyse',
    country: 'US',
    marketCapMoreThan: String(capMin),
    isActivelyTrading: 'true',
    isEtf: isEtf ? 'true' : 'false',
    isFund: 'false',
    limit: String(limit),
  });
  const d = await fetchJson(`${FMP}/stock-screener?${p.toString()}`);
  if (!Array.isArray(d)) return [];
  const seen = new Set();
  const out = [];
  for (const s of d) {
    const tk = String(s.symbol || '').toUpperCase();
    if (!US_TK.test(tk) || seen.has(tk)) continue;
    const px = num(s.price);
    if (!(px > 0)) continue;
    seen.add(tk);
    out.push({
      tk,
      nm: s.companyName || tk,
      seg: isEtf ? 'ETF' : (SECTOR_PT[s.sector] || s.sector || 'Outros'),
      px,
      mkt: num(s.marketCap),
    });
  }
  // maior valor de mercado primeiro (o front mantém essa ordem como padrão)
  out.sort((a, b) => (b.mkt || 0) - (a.mkt || 0));
  return out;
}

export default async function handler(req, res) {
  const key = process.env.FMP_KEY || '';
  const kind = String((req.query && req.query.kind) || '').toLowerCase();
  if (!key) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ stocks: [], etfs: [], note: 'FMP_KEY ausente' }); }
  try {
    const wantStocks = kind !== 'etf';
    const wantEtfs = kind !== 'stock';
    const [stocks, etfs] = await Promise.all([
      wantStocks ? screen(key, { isEtf: false, capMin: 2_000_000_000, limit: 300 }) : Promise.resolve([]),
      wantEtfs ? screen(key, { isEtf: true, capMin: 500_000_000, limit: 250 }) : Promise.resolve([]),
    ]);
    // universo muda devagar (preço vem do /api/us): cache 6h na borda
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ stocks, etfs });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ stocks: [], etfs: [] });
  }
}
