/**
 * Cotações REAIS de ações dos EUA — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * O brapi Pro cobre só a B3; para os Stocks dos EUA (AAPL, NVDA, MSFT…)
 * usamos fontes públicas SEM CHAVE:
 *   1) Yahoo Finance v7 quote — preço + variação + variação% + moeda (quando responde).
 *   2) Stooq (CSV) — fallback de PREÇO real (sem variação) quando o Yahoo não responde.
 *
 * Tudo em USD (o front formata com "$"). Falha com segurança: retorna {results:[]}
 * e nunca lança — na pior hipótese o front mantém o valor curado rotulado.
 *
 * Uso: GET /api/us?symbols=AAPL,NVDA,MSFT
 * Sem env vars (fontes públicas).
 */
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : null));

async function fetchWith(url, ms, asText) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LastroBot/1.0)', 'Accept': asText ? 'text/csv,*/*' : 'application/json,*/*' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return asText ? await r.text() : await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Yahoo v7: preço + variação + variação% + moeda. Pode falhar (consent/crumb) → retorna [].
async function yahooQuotes(symbols) {
  const q = symbols.map(encodeURIComponent).join(',');
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  for (const h of hosts) {
    const d = await fetchWith(`${h}/v7/finance/quote?symbols=${q}`, 9000, false);
    const list = d && d.quoteResponse && Array.isArray(d.quoteResponse.result) ? d.quoteResponse.result : null;
    if (list && list.length) {
      return list.map((x) => ({
        symbol: String(x.symbol || '').toUpperCase(),
        price: num(x.regularMarketPrice),
        change: num(x.regularMarketChange),
        changePct: num(x.regularMarketChangePercent),
        prevClose: num(x.regularMarketPreviousClose),
        currency: x.currency || 'USD',
        source: 'yahoo',
      })).filter((x) => x.price != null);
    }
  }
  return [];
}

// Stooq CSV: PREÇO real (Close). Sem variação confiável no light quote → change nulo.
async function stooqQuotes(symbols) {
  const s = symbols.map((x) => x.toLowerCase() + '.us').join(',');
  const csv = await fetchWith(`https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlc&h&e=csv`, 9000, true);
  if (!csv) return [];
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iSym = header.indexOf('symbol'), iClose = header.indexOf('close');
  if (iSym < 0 || iClose < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const price = num(c[iClose]);
    const sym = String(c[iSym] || '').toUpperCase().replace(/\.US$/, '');
    if (sym && price != null) out.push({ symbol: sym, price, change: null, changePct: null, currency: 'USD', source: 'stooq' });
  }
  return out;
}

export default async function handler(req, res) {
  const parse = (s) => String(s || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const symbols = [...new Set(parse((req.query || {}).symbols))].slice(0, 50);
  if (!symbols.length) return res.status(200).json({ results: [] });
  try {
    let results = await yahooQuotes(symbols);          // preço + variação (quando o Yahoo responde)
    const have = new Set(results.map((x) => x.symbol));
    const missing = symbols.filter((s) => !have.has(s));
    if (missing.length) {                              // completa preço via Stooq p/ o que faltou
      const st = await stooqQuotes(missing);
      results = results.concat(st);
    }
    // cotação muda no pregão: cache curto na borda
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ results });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: [], error: String((e && e.message) || e) });
  }
}
