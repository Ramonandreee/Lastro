/**
 * Proxy de cotações (brapi.dev) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * O plano gratuito da brapi permite apenas 1 ativo por requisição. Este
 * proxy busca cada ticker individualmente (server-side, com concorrência
 * limitada) e agrega num único retorno para o front. Vantagens:
 *   - respeita o limite "1 ativo/requisição" do plano free
 *   - o BRAPI_TOKEN fica só no servidor (não vai ao navegador)
 *   - cache na borda (s-maxage) reduz drasticamente as chamadas à brapi
 *
 * Uso: GET /api/quotes?symbols=PETR4,VALE3&crypto=BTC,ETH
 * Env: BRAPI_TOKEN (Vercel → Environment Variables)
 */
const BRAPI = 'https://brapi.dev/api';

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

async function oneStock(symbol, token) {
  const d = await fetchJson(`${BRAPI}/quote/${encodeURIComponent(symbol)}?token=${encodeURIComponent(token)}`);
  const q = d && d.results && d.results[0];
  if (!q || typeof q.regularMarketPrice !== 'number') return null;
  return { symbol: q.symbol || symbol, price: q.regularMarketPrice, change: q.regularMarketChangePercent ?? null };
}

async function oneCrypto(coin, token) {
  const d = await fetchJson(`${BRAPI}/v2/crypto?coin=${encodeURIComponent(coin)}&currency=BRL&token=${encodeURIComponent(token)}`);
  const q = d && d.coins && d.coins[0];
  if (!q || typeof q.regularMarketPrice !== 'number') return null;
  return { symbol: String(q.coin || coin).toUpperCase(), price: q.regularMarketPrice, change: q.regularMarketChangePercent ?? null };
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
  if (!token) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: [], crypto: [], note: 'BRAPI_TOKEN ausente no servidor' });
  }

  const q = req.query || {};
  const parse = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const symbols = parse(q.symbols).slice(0, 40);
  const coins = parse(q.crypto).slice(0, 20);

  // modo diagnóstico: mostra a resposta CRUA da brapi (status + body) sem vazar o token.
  // uso: /api/quotes?debug=1&crypto=BTC&symbols=PETR4  (remover depois)
  if (q.debug) {
    const coin = coins[0] || 'BTC';
    const sym = symbols[0] || 'PETR4';
    res.setHeader('Cache-Control', 'no-store');
    try {
      const rc = await fetch(`${BRAPI}/v2/crypto?coin=${encodeURIComponent(coin)}&currency=BRL&token=${encodeURIComponent(token)}`);
      const rcBody = await rc.text();
      const rs = await fetch(`${BRAPI}/quote/${encodeURIComponent(sym)}?token=${encodeURIComponent(token)}`);
      const rsBody = await rs.text();
      return res.status(200).json({
        debug: true,
        crypto: { url: `/api/v2/crypto?coin=${coin}&currency=BRL`, status: rc.status, body: rcBody.slice(0, 600) },
        stock: { url: `/api/quote/${sym}`, status: rs.status, body: rsBody.slice(0, 600) },
      });
    } catch (e) {
      return res.status(200).json({ debug: true, error: String((e && e.message) || e) });
    }
  }

  try {
    const [results, crypto] = await Promise.all([
      mapLimit(symbols, 4, (s) => oneStock(s, token)),
      mapLimit(coins, 4, (c) => oneCrypto(c, token)),
    ]);
    // cache na borda: 10 min "fresco" + serve obsoleto enquanto revalida
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ results, crypto });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar brapi', detail: String((e && e.message) || e) });
  }
}
