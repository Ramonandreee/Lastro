import { withObs } from "../lib/log.js";
/**
 * Proxy de fundamentos (brapi.dev Pro) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Busca indicadores fundamentalistas reais (P/L, P/VP, DY, ROE, margem,
 * valor de mercado) para os tickers pedidos, usando o endpoint de cotação
 * com `fundamental=true` + módulos. O BRAPI_TOKEN fica só no servidor.
 *
 * Os módulos do brapi espelham o Yahoo Finance: dividendYield, returnOnEquity
 * e profitMargins vêm como FRAÇÃO (0.138 = 13,8%) — normalizamos para %.
 * O campo `_raw` acompanha os valores crus para conferência.
 *
 * Uso: GET /api/fundamentals?symbols=PETR4,VALE3,ITUB4
 * Env: BRAPI_TOKEN (Vercel → Environment Variables)
 */
const BRAPI = 'https://brapi.dev/api';
const MODULES = 'summaryDetail,defaultKeyStatistics,financialData';
const BATCH_SIZE = 10;   // fundamentos são mais pesados — lotes menores

async function fetchJson(url, ms = 15000) {
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

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const pct = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 10 : null); // fração → %, 1 casa
const x2 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);   // múltiplo (x), 2 casas

function mapOne(q) {
  const sd = q.summaryDetail || {};
  const ks = q.defaultKeyStatistics || {};
  const fd = q.financialData || {};

  const pl = num(q.priceEarnings) ?? num(sd.trailingPE) ?? num(ks.trailingPE);
  const pvp = num(ks.priceToBook);
  const dy = pct(sd.dividendYield);
  const roe = pct(fd.returnOnEquity);
  const roa = pct(fd.returnOnAssets);
  const mgl = pct(fd.profitMargins);
  const mgbruta = pct(fd.grossMargins);
  const mgebit = pct(fd.operatingMargins);
  const ebitda = num(fd.ebitda);
  const receita = num(fd.totalRevenue);
  const mgebitda = pct(fd.ebitdaMargins) ?? ((ebitda != null && receita && receita > 0) ? pct(ebitda / receita) : null);
  const psr = num(sd.priceToSalesTrailing12Months) ?? num(ks.priceToSalesTrailing12Months);
  const ev = num(ks.enterpriseValue);
  const evebitda = x2(num(ks.enterpriseToEbitda));
  const lc = num(fd.currentRatio);
  const mkt = num(sd.marketCap) ?? num(q.marketCap);
  const lpa = num(q.earningsPerShare) ?? num(ks.trailingEps);
  const vpa = num(ks.bookValue);
  const shares = num(ks.sharesOutstanding) ?? num(sd.sharesOutstanding);
  const dividendRate = num(sd.dividendRate) ?? num(sd.trailingAnnualDividendRate);

  // Patrimônio total = VPA × ações (aprox. sem balanço no lote) → habilita dleb/dlpl
  const caixa = num(fd.totalCash);
  const divida = num(fd.totalDebt);
  const netDebt = (divida != null && caixa != null) ? divida - caixa : null;
  const patrimonio = (vpa != null && shares != null) ? vpa * shares : null;
  const dleb = (netDebt != null && ebitda && ebitda > 0) ? x2(netDebt / ebitda) : null;
  const dlpl = (netDebt != null && patrimonio && patrimonio > 0) ? x2(netDebt / patrimonio) : null;

  let payout = pct(num(ks.payoutRatio) ?? num(sd.payoutRatio));
  if (payout == null && dividendRate != null && lpa && lpa > 0) payout = Math.round((dividendRate / lpa) * 1000) / 10;

  return {
    symbol: q.symbol,
    // núcleo (já consumido pelas listagens)
    pl, pvp, dy, roe, mgl, mkt,
    // enriquecimento (para colunas/telas adicionais)
    roa, mgbruta, mgebit, mgebitda, psr, ev, evebitda, lc, dleb, dlpl,
    payout, lpa, vpa, sharesOutstanding: shares, dividendRate,
    week52Low: num(sd.fiftyTwoWeekLow) ?? num(q.fiftyTwoWeekLow),
    week52High: num(sd.fiftyTwoWeekHigh) ?? num(q.fiftyTwoWeekHigh),
    _raw: {
      priceEarnings: num(q.priceEarnings),
      trailingPE: num(sd.trailingPE),
      priceToBook: num(ks.priceToBook),
      dividendYield: num(sd.dividendYield),
      returnOnEquity: num(fd.returnOnEquity),
      returnOnAssets: num(fd.returnOnAssets),
      profitMargins: num(fd.profitMargins),
      grossMargins: num(fd.grossMargins),
      operatingMargins: num(fd.operatingMargins),
      ebitdaMargins: num(fd.ebitdaMargins),
      enterpriseToEbitda: num(ks.enterpriseToEbitda),
      payoutRatio: num(ks.payoutRatio) ?? num(sd.payoutRatio),
      debtToEquity: num(fd.debtToEquity),
      netDebt,
      currency: q.currency || null,
    },
  };
}

async function fetchBatch(symbols, token) {
  if (!symbols.length) return [];
  const path = symbols.map(encodeURIComponent).join(',');
  const d = await fetchJson(`${BRAPI}/quote/${path}?token=${encodeURIComponent(token)}&fundamental=true&modules=${MODULES}`);
  const results = (d && d.results) || [];
  return results.filter((q) => q && q.symbol).map(mapOne);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

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

async function handler(req, res) {
  const token = process.env.BRAPI_TOKEN || '';
  const parse = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const symbols = parse((req.query || {}).symbols).slice(0, 60);

  if (!token) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: [], note: 'BRAPI_TOKEN ausente no servidor' });
  }
  if (!symbols.length) {
    return res.status(200).json({ results: [] });
  }
  try {
    const batches = await mapLimit(chunk(symbols, BATCH_SIZE), 3, (grp) => fetchBatch(grp, token));
    const results = batches.flat();
    // fundamentos mudam devagar: cacheia 6h na borda + serve obsoleto por 24h
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ results });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar fundamentos brapi' });
  }
}

export default withObs("fundamentals", handler);
