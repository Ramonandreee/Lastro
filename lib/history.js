/**
 * Fechamentos diários históricos — Lastro (reconstrução da evolução da carteira).
 * ────────────────────────────────────────────────────────────────────
 * Devolve a série de PREÇOS DE FECHAMENTO por dia de cada ativo, para o front
 * reconstruir o patrimônio dia a dia (respeitando a data de cada aporte) — sem
 * interpolação nem aproximação. Fontes reais:
 *   - B3 (ações/FIIs/BDRs/ETFs): brapi Pro  (range=1mo&interval=1d) — precisa BRAPI_TOKEN
 *   - EUA (stocks/ETFs int.):     FMP        (historical-price-full)  — precisa FMP_KEY
 *   - Cripto:                     CoinGecko  (market_chart, BRL)      — sem chave
 *
 * Cada fonte falha com segurança (o ativo simplesmente não vem — o front cai no
 * snapshot local). Resposta: { results: { TICKER: [{d:'YYYY-MM-DD', c:Number}, ...asc] } }
 *
 * Uso: GET /api/history?symbols=PETR4,MXRF11&us=AAPL,IVV&crypto=BTC,ETH&days=40
 */
const BRAPI = 'https://brapi.dev/api';
const FMP = 'https://financialmodelingprep.com/api/v3';
const CG = 'https://api.coingecko.com/api/v3';
const BATCH = 12;

const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
  ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2', LINK: 'chainlink', DOT: 'polkadot',
  LTC: 'litecoin', MATIC: 'matic-network', TRX: 'tron', NEAR: 'near', BCH: 'bitcoin-cash',
  SHIB: 'shiba-inu', UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar', ETC: 'ethereum-classic',
  FIL: 'filecoin', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', SUI: 'sui',
};

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : null));
export const isoDay = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`; };
const parse = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0', Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

// B3 via brapi: histórico diário POR TICKER (o histórico do brapi não vem em lote —
// exatamente como o api/asset.js já faz p/ o gráfico do detalhe, que funciona).
const BRAPI_RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y']);
async function brapiHistory(symbols, token, out, range, interval) {
  if (!symbols.length || !token) return;
  const r = BRAPI_RANGES.has(range) ? range : '3mo';
  const iv = interval === '1mo' ? '1mo' : '1d';
  await mapLimit(symbols, 3, async (sym) => {
    const d = await fetchJson(`${BRAPI}/quote/${encodeURIComponent(sym)}?token=${encodeURIComponent(token)}&range=${r}&interval=${iv}`);
    const q = (d && Array.isArray(d.results) && d.results[0]) || null;
    const hist = q && Array.isArray(q.historicalDataPrice) ? q.historicalDataPrice : [];
    const ser = hist.map((h) => ({ d: isoDay((h.date || 0) * 1000), c: num(h.close ?? h.adjustedClose) })).filter((x) => x.c != null && x.c > 0);
    if (ser.length) out[String((q && q.symbol) || sym).toUpperCase()] = dedupeAsc(ser);
  });
}

// EUA via FMP: batch historical-price-full → historicalStockList[].
async function fmpHistory(symbols, key, days, out) {
  if (!symbols.length || !key) return;
  await mapLimit(chunk(symbols, BATCH), 3, async (grp) => {
    const path = grp.map(encodeURIComponent).join(',');
    const d = await fetchJson(`${FMP}/historical-price-full/${path}?serietype=line&timeseries=${days}&apikey=${encodeURIComponent(key)}`);
    const list = d && (Array.isArray(d.historicalStockList) ? d.historicalStockList : (d.symbol && Array.isArray(d.historical) ? [{ symbol: d.symbol, historical: d.historical }] : []));
    (list || []).forEach((s) => {
      const ser = (s.historical || []).map((h) => ({ d: String(h.date).slice(0, 10), c: num(h.close ?? h.price) })).filter((x) => x.c != null && x.c > 0);
      if (ser.length) out[String(s.symbol).toUpperCase()] = dedupeAsc(ser);
    });
  });
}

// Cripto via CoinGecko: market_chart diário em BRL (por moeda, id mapeado).
async function cryptoHistory(symbols, days, out) {
  const want = symbols.map((s) => s.toUpperCase()).filter((s) => COINGECKO_IDS[s]);
  if (!want.length) return;
  await mapLimit(want, 3, async (sym) => {
    const id = COINGECKO_IDS[sym];
    const d = await fetchJson(`${CG}/coins/${id}/market_chart?vs_currency=brl&days=${days}&interval=daily`);
    const prices = d && Array.isArray(d.prices) ? d.prices : [];
    const ser = prices.map((p) => ({ d: isoDay(p[0]), c: num(p[1]) })).filter((x) => x.c != null && x.c > 0);
    if (ser.length) out[sym] = dedupeAsc(ser);
  });
}

// remove dias repetidos (fica o último) e ordena ascendente por data.
export function dedupeAsc(ser) {
  const map = {};
  ser.forEach((x) => { map[x.d] = x.c; });
  return Object.keys(map).sort().map((d) => ({ d, c: map[d] }));
}

export default async function handler(req, res) {
  const q = req.query || {};
  const days = Math.min(Math.max(parseInt(q.days, 10) || 40, 7), 800);   // até ~2 anos (p/ o backtest)
  const symbols = parse(q.symbols).slice(0, 60);
  const us = parse(q.us).slice(0, 40);
  const crypto = parse(q.crypto).slice(0, 30);
  const out = {};
  try {
    await Promise.all([
      brapiHistory(symbols, process.env.BRAPI_TOKEN || '', out, String(q.range || ''), String(q.interval || '')),
      fmpHistory(us, process.env.FMP_KEY || '', days, out),
      cryptoHistory(crypto, days, out),
    ]);
    // fechamentos históricos mudam só 1x/dia → cache longo na borda
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=43200');
    return res.status(200).json({ results: out });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: out });
  }
}
