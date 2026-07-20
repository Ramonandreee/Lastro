/**
 * Mercado de cripto REAL (CoinGecko) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Uma chamada ao /coins/markets traz o TOP N por valor de mercado com tudo que a
 * página do ativo precisa: preço, valor de mercado, volume 24h, supply
 * (circulante/total/máximo), ATH/ATL, ranking e variações 1h/24h/7d/30d — em BRL.
 * Fonte pública, sem chave. Falha com segurança (retorna []).
 *
 * Uso: GET /api/crypto?n=100   (ou ?ids=bitcoin,ethereum)
 */
const CG = 'https://api.coingecko.com/api/v3';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const r2 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);

async function fetchJson(url, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0', Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

function mapOne(c) {
  return {
    id: c.id,
    tk: String(c.symbol || '').toUpperCase(),
    nm: c.name || c.id,
    px: num(c.current_price),
    mktN: num(c.market_cap),
    rank: num(c.market_cap_rank),
    vol: num(c.total_volume),
    high24: num(c.high_24h),
    low24: num(c.low_24h),
    v1h: r2(c.price_change_percentage_1h_in_currency),
    v24: r2(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h),
    v7: r2(c.price_change_percentage_7d_in_currency),
    v30: r2(c.price_change_percentage_30d_in_currency),
    supply: num(c.circulating_supply),
    totalSupply: num(c.total_supply),
    maxSupply: num(c.max_supply),
    ath: num(c.ath),
    athPct: r2(c.ath_change_percentage),
    atl: num(c.atl),
    image: c.image || null,
  };
}

export default async function handler(req, res) {
  const q = req.query || {};
  const ids = String(q.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const n = Math.min(Math.max(parseInt(q.n, 10) || 100, 1), 250);
  const per = ids.length ? ids.length : n;
  const params = `vs_currency=brl&order=market_cap_desc&per_page=${per}&page=1&sparkline=false&price_change_percentage=1h,24h,7d,30d`;
  const url = ids.length ? `${CG}/coins/markets?${params}&ids=${encodeURIComponent(ids.join(','))}` : `${CG}/coins/markets?${params}`;
  try {
    const d = await fetchJson(url);
    if (!Array.isArray(d)) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ results: [], note: 'coingecko indisponível' }); }
    const results = d.filter((c) => c && c.symbol).map(mapOne);
    // preços mudam no minuto, fundamentos (supply/ath) devagar → cache curto na borda
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ results });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: [], error: String((e && e.message) || e) });
  }
}
