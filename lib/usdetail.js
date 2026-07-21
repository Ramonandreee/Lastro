/**
 * Detalhe REAL de um ativo dos EUA (FMP) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Enriquece a PÁGINA de um Stock/ETF internacional com dado real da Financial
 * Modeling Prep: perfil da empresa (setor, indústria, descrição, site, nº de
 * funcionários, CEO, país), fundamentos TTM (P/L, P/VP, DY, ROE, margens, ROA,
 * LPA, VPA, valor de mercado/firma), histórico de preço (1 ano) e, para ETFs,
 * taxa de administração (expense ratio), patrimônio (AUM) e principais posições.
 *
 * Cada sub-requisição falha com segurança (o que faltar simplesmente não é
 * preenchido — o front mantém o que já tinha, sem inventar).
 *
 * Uso: GET /api/usdetail?symbol=AAPL            (ação)
 *      GET /api/usdetail?symbol=IVV&kind=etf    (ETF)
 * Env: FMP_KEY (Vercel). Sem chave, retorna vazio.
 */
const FMP = 'https://financialmodelingprep.com/api/v3';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : null));
export const pct = (v) => { const n = num(v); return n == null ? null : Math.round(n * 10000) / 100; };   // fração → % (2 casas)

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0', Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}
const first = (d) => (Array.isArray(d) && d.length ? d[0] : (d && typeof d === 'object' ? d : null));

export default async function handler(req, res) {
  const key = process.env.FMP_KEY || '';
  const q = req.query || {};
  const sym = String(q.symbol || '').toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6);
  const isEtf = String(q.kind || '').toLowerCase() === 'etf';
  if (!key || !sym) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ note: key ? 'symbol ausente' : 'FMP_KEY ausente' }); }
  const k = encodeURIComponent(key);

  try {
    const [profRaw, ratioRaw, kmRaw, divRaw, histRaw, etfRaw] = await Promise.all([
      fetchJson(`${FMP}/profile/${sym}?apikey=${k}`),
      fetchJson(`${FMP}/ratios-ttm/${sym}?apikey=${k}`),
      fetchJson(`${FMP}/key-metrics-ttm/${sym}?apikey=${k}`),
      fetchJson(`${FMP}/historical-price-full/stock_dividend/${sym}?apikey=${k}`),
      fetchJson(`${FMP}/historical-price-full/${sym}?serietype=line&timeseries=260&apikey=${k}`),
      isEtf ? fetchJson(`${FMP}/etf-info?symbol=${sym}&apikey=${k}`) : Promise.resolve(null),
    ]);

    const p = first(profRaw) || {};
    const rt = first(ratioRaw) || {};
    const km = first(kmRaw) || {};

    const out = { currency: (p.currency || 'USD'), symbol: sym };

    // ── perfil ──
    out.profile = {
      name: p.companyName || null,
      sector: p.sector || null,
      industry: p.industry || null,
      desc: p.description || null,
      website: p.website || null,
      employees: num(p.fullTimeEmployees),
      ceo: p.ceo || null,
      country: p.country || null,
      exchange: p.exchangeShortName || p.exchange || null,
    };

    // ── fundamentos TTM (razões já vêm como fração p/ margens/ROE) ──
    out.fund = {
      pe: num(rt.peRatioTTM) ?? num(p.pe),
      pb: num(rt.priceToBookRatioTTM),
      // os campos *YieldTTM vêm como fração (0,0044) → pct(); *PercentageTTM já vem em % (0,44) → cru
      dy: (num(rt.dividendYielTTM) != null || num(rt.dividendYieldTTM) != null)
        ? pct(rt.dividendYielTTM ?? rt.dividendYieldTTM)
        : num(rt.dividendYieldPercentageTTM),
      roe: pct(rt.returnOnEquityTTM),
      roa: pct(rt.returnOnAssetsTTM),
      npm: pct(rt.netProfitMarginTTM),
      gpm: pct(rt.grossProfitMarginTTM),
      opm: pct(rt.operatingProfitMarginTTM),
      eps: num(km.netIncomePerShareTTM) ?? num(p.eps),
      bvps: num(km.bookValuePerShareTTM),
      mktCap: num(km.marketCapTTM) ?? num(p.mktCap),
      ev: num(km.enterpriseValueTTM),
      shares: (num(km.marketCapTTM) && num(p.price)) ? Math.round(num(km.marketCapTTM) / num(p.price)) : null,
    };

    // ── dividendos (data + valor) — ascendente, últimos ~24 ──
    const dh = (divRaw && Array.isArray(divRaw.historical)) ? divRaw.historical : [];
    out.dividends = dh
      .map((x) => ({ date: x.date, value: num(x.adjDividend ?? x.dividend) }))
      .filter((x) => x.date && x.value != null && x.value > 0)
      .slice(0, 40)
      .reverse();

    // ── histórico de preço (fechamento) — ascendente ──
    const hh = (histRaw && Array.isArray(histRaw.historical)) ? histRaw.historical : [];
    out.history = hh.map((x) => ({ c: num(x.close ?? x.price) })).filter((x) => x.c != null).reverse();

    // ── ETF: taxa de adm. (expense ratio), patrimônio (AUM), posições e setores ──
    if (isEtf) {
      const e = first(etfRaw) || {};
      const holders = Array.isArray(e.holdings) ? e.holdings : (Array.isArray(e.holdingsList) ? e.holdingsList : []);
      out.etf = {
        expenseRatio: num(e.expenseRatio),   // FMP já devolve em % (ex.: 0.03 = 0,03%) — não multiplicar
        aum: num(e.aum) ?? num(e.marketValue),
        holdingsCount: num(e.holdingsCount),
        holdings: holders.slice(0, 10).map((h) => ({ asset: h.asset || h.symbol || null, name: h.name || null, weight: num(h.weightPercentage ?? h.weight) })).filter((h) => h.asset || h.name),
        sectors: (Array.isArray(e.sectorsList) ? e.sectorsList : []).slice(0, 8).map((s) => ({ sector: s.industry || s.sector || null, weight: num(String(s.exposure || s.weightPercentage || '').replace('%', '')) })).filter((s) => s.sector),
      };
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ error: String((e && e.message) || e) });
  }
}
