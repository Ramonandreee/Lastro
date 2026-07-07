/**
 * Proxy de ativo COMPLETO (brapi.dev Pro) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Reúne, numa única resposta, tudo que o brapi oferece sobre um ativo:
 *   - cotação + variação + nome/moeda + faixa 52 semanas + volume
 *   - histórico de preços (para o gráfico real)
 *   - proventos/dividendos (data + valor + tipo)
 *   - perfil da empresa (setor, indústria, descrição, site, funcionários)
 *   - fundamentos normalizados (P/L, P/VP, DY, ROE, margem, valor de mercado…)
 *   - demonstrações (balanço, DRE, fluxo de caixa) quando o módulo existe
 *
 * Robustez: os módulos são buscados UM A UM em paralelo — um nome de módulo
 * inválido não derruba os outros. `modulesOk` retorna a lista dos que vieram.
 * O DY é calculado a partir do histórico real de proventos (12 meses) quando o
 * módulo de fundamentos não o traz. O BRAPI_TOKEN fica só no servidor.
 *
 * Uso: GET /api/asset?ticker=PETR4&range=1y&interval=1d
 * Env: BRAPI_TOKEN (Vercel → Environment Variables)
 */
const BRAPI = 'https://brapi.dev/api';
// módulos candidatos (nomes do brapi/Yahoo) — buscados individualmente
const CANDIDATE_MODULES = [
  'summaryProfile', 'defaultKeyStatistics', 'financialData',
  'balanceSheetHistory', 'incomeStatementHistory', 'summaryDetail',
];
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const INTERVALS = new Set(['1d', '1wk', '1mo']);

// Retorna { ok, status, data } — nunca lança, para o handler decidir o fallback.
async function fetchJson(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0' }, signal: ctrl.signal });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, err: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const pct = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 10 : null); // fração → %, 1 casa

function normHistory(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((p) => p && typeof p.close === 'number' && p.date)
    .map((p) => ({ t: p.date, c: p.close, v: num(p.volume) }));
}

function normDividends(dd) {
  const cash = (dd && dd.cashDividends) || [];
  if (!Array.isArray(cash)) return [];
  return cash
    .map((d) => ({
      date: d.paymentDate || d.lastDatePrior || d.approvedOn || null,
      value: num(d.rate),
      label: d.label || d.relatedTo || null,
    }))
    .filter((d) => d.value != null && d.date);
}

// DY calculado: soma dos proventos dos últimos 12 meses / preço atual.
function calcDY(dividends, price) {
  if (!price || !Array.isArray(dividends) || !dividends.length) return null;
  const now = Date.now();
  const YEAR = 365 * 24 * 3600 * 1000;
  let sum = 0, any = false;
  for (const d of dividends) {
    const t = Date.parse(d.date);
    if (!isFinite(t)) continue;
    if (t <= now && now - t <= YEAR) { sum += d.value; any = true; }
  }
  if (!any) return null;
  return Math.round((sum / price) * 1000) / 10; // %
}

function normProfile(sp) {
  if (!sp) return null;
  return {
    sector: sp.sector || null,
    industry: sp.industry || null,
    desc: sp.longBusinessSummary || null,
    website: sp.website || null,
    employees: num(sp.fullTimeEmployees),
    country: sp.country || null,
    city: sp.city || null,
    state: sp.state || null,
  };
}

function normFund(r) {
  const sd = r.summaryDetail || {};
  const ks = r.defaultKeyStatistics || {};
  const fd = r.financialData || {};
  return {
    pl: num(r.priceEarnings) ?? num(sd.trailingPE) ?? num(ks.trailingPE),
    pvp: num(ks.priceToBook),
    dy: pct(sd.dividendYield),
    roe: pct(fd.returnOnEquity),
    roa: pct(fd.returnOnAssets),
    mgl: pct(fd.profitMargins),
    mgbruta: pct(fd.grossMargins),
    mgebit: pct(fd.operatingMargins),
    psr: num(sd.priceToSalesTrailing12Months),
    dividaPl: num(fd.debtToEquity),
    liqCorrente: num(fd.currentRatio),
    lpa: num(r.earningsPerShare) ?? num(ks.trailingEps),
    vpa: num(ks.bookValue),
    mkt: num(sd.marketCap) ?? num(r.marketCap),
    ev: num(ks.enterpriseValue),
    receita: num(fd.totalRevenue),
    lucro: num(fd.netIncomeToCommon) ?? num(ks.netIncomeToCommon),
    caixa: num(fd.totalCash),
    divida: num(fd.totalDebt),
    _raw: {
      dividendYield: num(sd.dividendYield),
      returnOnEquity: num(fd.returnOnEquity),
      returnOnAssets: num(fd.returnOnAssets),
      profitMargins: num(fd.profitMargins),
      priceEarnings: num(r.priceEarnings),
      priceToBook: num(ks.priceToBook),
    },
  };
}

async function fetchModule(ticker, token, mod) {
  const resp = await fetchJson(
    `${BRAPI}/quote/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}&modules=${mod}`
  );
  const r = resp.data && resp.data.results && resp.data.results[0];
  const obj = r && r[mod];
  return { mod, obj: obj || null, ok: !!obj };
}

export default async function handler(req, res) {
  const token = process.env.BRAPI_TOKEN || '';
  const q = req.query || {};
  const ticker = String(q.ticker || '').trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const range = RANGES.has(String(q.range)) ? q.range : '1y';
  const interval = INTERVALS.has(String(q.interval)) ? q.interval : '1d';

  if (!token) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ note: 'BRAPI_TOKEN ausente no servidor' });
  }
  if (!ticker) return res.status(400).json({ error: 'ticker obrigatório' });

  try {
    // 1) requisição base: cotação + histórico + proventos + fundamentos de topo
    const base = `${BRAPI}/quote/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}`
      + `&range=${range}&interval=${interval}&fundamental=true&dividends=true`;
    const baseResp = await fetchJson(base);
    const r = baseResp.data && baseResp.data.results && baseResp.data.results[0];
    if (!r) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(baseResp.status && baseResp.status !== 200 ? baseResp.status : 404).json({
        error: 'ativo não encontrado na brapi',
        ticker,
        brapiStatus: baseResp.status,
        brapiError: (baseResp.data && (baseResp.data.message || baseResp.data.error)) || baseResp.err || null,
      });
    }

    // 2) módulos individuais em paralelo — mescla os que vierem em `r`
    const modResults = await Promise.all(CANDIDATE_MODULES.map((m) => fetchModule(ticker, token, m)));
    const modulesOk = [];
    modResults.forEach(({ mod, obj, ok }) => { if (ok) { r[mod] = obj; modulesOk.push(mod); } });

    const price = num(r.regularMarketPrice);
    const dividends = normDividends(r.dividendsData);
    const fund = normFund(r);
    if (fund.dy == null) fund.dy = calcDY(dividends, price); // DY real via proventos

    const payload = {
      symbol: r.symbol || ticker,
      modulesOk,
      name: r.longName || r.shortName || null,
      currency: r.currency || 'BRL',
      price,
      change: num(r.regularMarketChangePercent),
      dayLow: num(r.regularMarketDayLow),
      dayHigh: num(r.regularMarketDayHigh),
      week52Low: num(r.fiftyTwoWeekLow),
      week52High: num(r.fiftyTwoWeekHigh),
      volume: num(r.regularMarketVolume),
      logo: r.logourl || null,
      history: normHistory(r.historicalDataPrice),
      dividends,
      profile: normProfile(r.summaryProfile),
      fund,
      statements: {
        balance: (r.balanceSheetHistory && r.balanceSheetHistory.balanceSheetStatements) || null,
        income: (r.incomeStatementHistory && r.incomeStatementHistory.incomeStatementHistory) || null,
      },
    };

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar brapi', detail: String((e && e.message) || e) });
  }
}
