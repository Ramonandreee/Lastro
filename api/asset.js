/**
 * Proxy de ativo COMPLETO (brapi.dev Pro) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Reúne, numa única resposta, tudo que o brapi oferece sobre um ativo:
 *   - cotação + variação + nome/moeda
 *   - histórico de preços (para o gráfico real)
 *   - proventos/dividendos (data + valor)
 *   - perfil da empresa (setor, indústria, descrição, site, funcionários)
 *   - fundamentos normalizados (P/L, P/VP, DY, ROE, margem, valor de mercado…)
 *   - módulos crus (balanço, DRE, fluxo de caixa) para exibição detalhada
 *
 * O BRAPI_TOKEN fica só no servidor. Campos ausentes viram null (o front
 * mantém o valor curado como fallback). `_raw` acompanha valores crus dos
 * indicadores que exigem normalização (fração → %), para conferência.
 *
 * Uso: GET /api/asset?ticker=PETR4&range=1y&interval=1d
 * Env: BRAPI_TOKEN (Vercel → Environment Variables)
 */
const BRAPI = 'https://brapi.dev/api';
const MODULES = [
  'summaryProfile', 'summaryDetail', 'defaultKeyStatistics', 'financialData',
  'balanceSheetHistory', 'incomeStatementHistory', 'cashflowHistory',
].join(',');
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const INTERVALS = new Set(['1d', '1wk', '1mo']);

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
    .filter((d) => d.value != null);
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

function normFund(q) {
  const sd = q.summaryDetail || {};
  const ks = q.defaultKeyStatistics || {};
  const fd = q.financialData || {};
  return {
    pl: num(q.priceEarnings) ?? num(sd.trailingPE) ?? num(ks.trailingPE),
    pvp: num(ks.priceToBook),
    dy: pct(sd.dividendYield),
    roe: pct(fd.returnOnEquity),
    roa: pct(fd.returnOnAssets),
    mgl: pct(fd.profitMargins),
    mgbruta: pct(fd.grossMargins),
    mgebit: pct(fd.operatingMargins),
    psr: num(sd.priceToSalesTrailing12Months),
    dividaEbitda: num(fd.debtToEquity),
    liqCorrente: num(fd.currentRatio),
    lpa: num(q.earningsPerShare) ?? num(ks.trailingEps),
    vpa: num(ks.bookValue),
    mkt: num(sd.marketCap) ?? num(q.marketCap),
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
      priceEarnings: num(q.priceEarnings),
      priceToBook: num(ks.priceToBook),
    },
  };
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
    const url = `${BRAPI}/quote/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}`
      + `&range=${range}&interval=${interval}&fundamental=true&dividends=true&modules=${MODULES}`;
    const d = await fetchJson(url);
    const r = d && d.results && d.results[0];
    if (!r) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'ativo não encontrado na brapi', ticker });
    }

    const payload = {
      symbol: r.symbol || ticker,
      name: r.longName || r.shortName || null,
      currency: r.currency || 'BRL',
      price: num(r.regularMarketPrice),
      change: num(r.regularMarketChangePercent),
      dayLow: num(r.regularMarketDayLow),
      dayHigh: num(r.regularMarketDayHigh),
      week52Low: num(r.fiftyTwoWeekLow),
      week52High: num(r.fiftyTwoWeekHigh),
      volume: num(r.regularMarketVolume),
      logo: r.logourl || null,
      history: normHistory(r.historicalDataPrice),
      dividends: normDividends(r.dividendsData),
      profile: normProfile(r.summaryProfile),
      fund: normFund(r),
      statements: {
        balance: (r.balanceSheetHistory && r.balanceSheetHistory.balanceSheetStatements) || r.balanceSheetHistory || null,
        income: (r.incomeStatementHistory && r.incomeStatementHistory.incomeStatementHistory) || r.incomeStatementHistory || null,
        cashflow: (r.cashflowHistory && r.cashflowHistory.cashflowStatements) || r.cashflowHistory || null,
      },
    };

    // cotação muda intradia (cache curto); o resto muda devagar. Meio-termo: 15 min.
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar brapi', detail: String((e && e.message) || e) });
  }
}
