import { withObs } from "../lib/log.js";
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
const x2 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);   // múltiplo (x), 2 casas

// Extrai o array de demonstrações do módulo brapi (aceita [] ou {history:[]}).
function stmtArr(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (Array.isArray(x.history)) return x.history;
  return [];
}
// Ordena do período mais recente para o mais antigo (por endDate/date).
function sortRecent(arr) {
  return arr.slice().sort((a, b) => (Date.parse((b && (b.endDate || b.date)) || 0) || 0) - (Date.parse((a && (a.endDate || a.date)) || 0) || 0));
}
// CAGR (%): base e topo precisam ser positivos para não distorcer.
function cagr(newV, oldV, years) {
  if (typeof newV !== 'number' || typeof oldV !== 'number' || years <= 0) return null;
  if (oldV <= 0 || newV <= 0) return null;
  const r = Math.pow(newV / oldV, 1 / years) - 1;
  return isFinite(r) ? Math.round(r * 1000) / 10 : null;
}

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
      com: d.lastDatePrior || null, // data-com (último dia com direito)
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

  // ── Demonstrações reais (para derivar o que o brapi não entrega pronto) ──
  const inc = sortRecent(stmtArr(r.incomeStatementHistory));
  const bal = sortRecent(stmtArr(r.balanceSheetHistory));
  const i0 = inc[0] || {};
  const b0 = bal[0] || {};

  const mkt = num(sd.marketCap) ?? num(r.marketCap);
  const ev = num(ks.enterpriseValue);
  const receita = num(fd.totalRevenue) ?? num(i0.totalRevenue);
  const lucro = num(fd.netIncomeToCommon) ?? num(ks.netIncomeToCommon) ?? num(i0.netIncome);
  const caixa = num(fd.totalCash);
  const divida = num(fd.totalDebt);
  const ebitda = num(fd.ebitda) ?? num(i0.ebitda);
  const ebit = num(i0.ebit) ?? num(i0.operatingIncome);
  const ativoTotal = num(b0.totalAssets);
  const patrimonio = num(b0.totalStockholderEquity)
    ?? ((num(ks.bookValue) != null && num(ks.sharesOutstanding) != null) ? ks.bookValue * ks.sharesOutstanding : null);

  // Dívida líquida = dívida total − caixa (usa financialData; senão, balanço)
  let netDebt = null;
  if (divida != null && caixa != null) netDebt = divida - caixa;
  else if (b0) {
    const dBal = (num(b0.shortLongTermDebt) || 0) + (num(b0.longTermDebt) || 0);
    const cBal = (num(b0.cash) || 0) + (num(b0.shortTermInvestments) || 0);
    if (dBal || cBal) netDebt = dBal - cBal;
  }

  // Múltiplos derivados (só de dado real; senão null)
  const dleb = (netDebt != null && ebitda && ebitda > 0) ? x2(netDebt / ebitda) : null;
  const dlpl = (netDebt != null && patrimonio && patrimonio > 0) ? x2(netDebt / patrimonio) : null;
  const pativo = (mkt != null && ativoTotal && ativoTotal > 0) ? x2(mkt / ativoTotal) : null;
  const pebit = (mkt != null && ebit && ebit > 0) ? x2(mkt / ebit) : null;
  const evebit = (ev != null && ebit && ebit > 0) ? x2(ev / ebit) : null;
  const giro = (receita != null && ativoTotal && ativoTotal > 0) ? x2(receita / ativoTotal) : null;

  // ROIC aproximado = NOPAT / capital investido, tudo de dado real da DRE/balanço.
  //   NOPAT = EBIT × (1 − alíquota efetiva);  alíquota = impostos / lucro antes de impostos.
  //   capital investido = patrimônio + dívida total.
  let roic = null;
  if (ebit && patrimonio != null && divida != null) {
    const pretax = num(i0.incomeBeforeTax);
    const taxExp = num(i0.incomeTaxExpense);
    let tax = 0.34; // alíquota nominal BR como piso conservador
    if (pretax && pretax > 0 && taxExp != null) { const t = taxExp / pretax; if (t >= 0 && t < 0.6) tax = t; }
    const nopat = ebit * (1 - tax);
    const invested = patrimonio + divida;
    if (invested > 0) roic = pct(nopat / invested);
  }

  // CAGR de receita e lucro (mais antigo → mais recente da DRE anual)
  let cagrR = null, cagrL = null;
  if (inc.length >= 2) {
    const oldI = inc[inc.length - 1], newI = inc[0];
    const yrs = inc.length - 1;
    cagrR = cagr(num(newI.totalRevenue), num(oldI.totalRevenue), yrs);
    cagrL = cagr(num(newI.netIncome), num(oldI.netIncome), yrs);
  }

  // Payout: preferimos o índice pronto (fração→%); senão, dividendRate/LPA.
  let payout = pct(num(ks.payoutRatio) ?? num(sd.payoutRatio));
  const lpa = num(r.earningsPerShare) ?? num(ks.trailingEps);
  const dividendRate = num(sd.dividendRate) ?? num(sd.trailingAnnualDividendRate);
  if (payout == null && dividendRate != null && lpa && lpa > 0) payout = Math.round((dividendRate / lpa) * 1000) / 10;

  return {
    pl: num(r.priceEarnings) ?? num(sd.trailingPE) ?? num(ks.trailingPE),
    pvp: num(ks.priceToBook),
    dy: pct(sd.dividendYield),
    roe: pct(fd.returnOnEquity),
    roa: pct(fd.returnOnAssets),
    roic,
    mgl: pct(fd.profitMargins),
    mgbruta: pct(fd.grossMargins),
    mgebit: pct(fd.operatingMargins),
    mgebitda: pct(fd.ebitdaMargins) ?? ((ebitda != null && receita && receita > 0) ? pct(ebitda / receita) : null),
    psr: num(sd.priceToSalesTrailing12Months) ?? num(ks.priceToSalesTrailing12Months),
    ev,
    evebitda: x2(num(ks.enterpriseToEbitda)),
    evebit,
    pebit,
    pativo,
    giro,
    dividaPl: num(fd.debtToEquity),  // Yahoo: dívida TOTAL/patrimônio ×100 (auditoria)
    dleb,
    dlpl,
    liqCorrente: num(fd.currentRatio),
    payout,
    cagrR,
    cagrL,
    lpa,
    vpa: num(ks.bookValue),
    mkt,
    sharesOutstanding: num(ks.sharesOutstanding) ?? num(sd.sharesOutstanding),
    dividendRate,
    week52Low: num(sd.fiftyTwoWeekLow) ?? num(r.fiftyTwoWeekLow),
    week52High: num(sd.fiftyTwoWeekHigh) ?? num(r.fiftyTwoWeekHigh),
    receita,
    lucro,
    ebitda,
    ebit,
    caixa,
    divida,
    ativoTotal,
    patrimonio,
    _raw: {
      dividendYield: num(sd.dividendYield),
      returnOnEquity: num(fd.returnOnEquity),
      returnOnAssets: num(fd.returnOnAssets),
      profitMargins: num(fd.profitMargins),
      grossMargins: num(fd.grossMargins),
      operatingMargins: num(fd.operatingMargins),
      ebitdaMargins: num(fd.ebitdaMargins),
      priceEarnings: num(r.priceEarnings),
      priceToBook: num(ks.priceToBook),
      enterpriseToEbitda: num(ks.enterpriseToEbitda),
      debtToEquity: num(fd.debtToEquity),
      payoutRatio: num(ks.payoutRatio) ?? num(sd.payoutRatio),
      netDebt,
      currency: r.currency || null,
      roicApprox: roic != null,  // ROIC é DERIVADO (NOPAT/capital), não bruto do brapi
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

async function handler(req, res) {
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
        balance: r.balanceSheetHistory || null,
        income: r.incomeStatementHistory || null,
      },
    };

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar brapi' });
  }
}

export default withObs("asset", handler);
