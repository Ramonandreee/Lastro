/**
 * Proxy de cotações (brapi.dev) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Com o plano Pro da brapi, vários ativos vêm numa única requisição. Este
 * proxy agrupa os tickers em lotes (batch), busca cada lote server-side com
 * concorrência limitada e agrega num único retorno para o front. Vantagens:
 *   - muito mais rápido (dezenas de ativos em poucas requisições)
 *   - o BRAPI_TOKEN fica só no servidor (não vai ao navegador)
 *   - cache na borda (s-maxage) reduz drasticamente as chamadas à brapi
 *   - degrada com elegância: sem token, a B3 fica vazia (cripto segue via CoinGecko)
 *
 * Uso: GET /api/quotes?symbols=PETR4,VALE3&crypto=BTC,ETH
 * Env: BRAPI_TOKEN (Vercel → Environment Variables)
 */
const BRAPI = 'https://brapi.dev/api';
const BATCH_SIZE = 15;   // tickers por requisição (o plano Pro aceita múltiplos)

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Busca um LOTE de tickers numa única requisição (plano Pro).
   Retorna um array de {symbol, price, change} — ignora ativos sem preço. */
async function fetchStockBatch(symbols, token) {
  if (!symbols.length) return [];
  const path = symbols.map(encodeURIComponent).join(',');
  const d = await fetchJson(`${BRAPI}/quote/${path}?token=${encodeURIComponent(token)}`);
  const results = (d && d.results) || [];
  return results
    .filter((q) => q && typeof q.regularMarketPrice === 'number')
    .map((q) => ({ symbol: q.symbol, price: q.regularMarketPrice, change: q.regularMarketChangePercent ?? null }));
}

// quebra um array em pedaços de tamanho `n`
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* Cripto: brapi free NÃO inclui cripto (FEATURE_NOT_AVAILABLE). Usamos o
   CoinGecko — grátis, sem token e com todas as moedas numa única requisição. */
const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2',
  LINK: 'chainlink', DOT: 'polkadot', LTC: 'litecoin', MATIC: 'matic-network',
  TRX: 'tron', NEAR: 'near',
};

async function fetchCrypto(coins) {
  const wanted = coins.map((c) => c.toUpperCase()).filter((c) => COINGECKO_IDS[c]);
  if (!wanted.length) return [];
  const ids = [...new Set(wanted.map((c) => COINGECKO_IDS[c]))];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=brl&include_24hr_change=true`;
  const d = await fetchJson(url);
  if (!d) return [];
  const out = [];
  for (const tk of wanted) {
    const row = d[COINGECKO_IDS[tk]];
    if (row && typeof row.brl === 'number') {
      out.push({ symbol: tk, price: row.brl, change: typeof row.brl_24h_change === 'number' ? row.brl_24h_change : null });
    }
  }
  return out;
}

// executa fn sobre items com no máximo `limit` em paralelo
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

export default async function handler(req, res) {
  const token = process.env.BRAPI_TOKEN || '';
  const q = req.query || {};
  const parse = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const symbols = parse(q.symbols).slice(0, 120);
  const coins = parse(q.crypto).slice(0, 30);

  try {
    const [batches, crypto] = await Promise.all([
      // B3 (brapi) exige token; cripto (CoinGecko) é grátis e independe do token.
      // Agrupa os tickers em lotes e busca até 4 lotes em paralelo.
      token ? mapLimit(chunk(symbols, BATCH_SIZE), 4, (grp) => fetchStockBatch(grp, token)) : Promise.resolve([]),
      fetchCrypto(coins),
    ]);
    const results = batches.flat();
    // cache na borda: 10 min "fresco" + serve obsoleto enquanto revalida
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ results, crypto, ...(token ? {} : { note: 'BRAPI_TOKEN ausente: B3 indisponível' }) });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar brapi', detail: String((e && e.message) || e) });
  }
}
