/**
 * Calendário de proventos REAIS (data-com / data de pagamento) — Lastro.
 * ────────────────────────────────────────────────────────────────────
 * Fonte: brapi.dev (`/quote/<tickers>?dividends=true`), que republica os
 * "Proventos em dinheiro" divulgados pela B3. Cada evento aprovado traz, no
 * objeto `dividendsData.cashDividends[]`, os campos:
 *
 *   rate           → valor por cota/ação (número)
 *   label          → tipo do provento ("DIVIDENDO", "JRS CAP PROPRIO", "RENDIMENTO"…)
 *   relatedTo      → competência ("4º trimestre/2025", "Junho/2026"…)
 *   approvedOn     → data da aprovação/anúncio pelo emissor
 *   lastDatePrior  → DATA-COM (último dia com direito ao provento)
 *   paymentDate    → DATA DE PAGAMENTO
 *   isinCode / assetIssued / remarks → metadados (ignorados aqui)
 *
 * Como a B3 publica o evento no ANÚNCIO (e não no pagamento), a mesma lista
 * costuma conter eventos já anunciados e AINDA NÃO PAGOS — é isso que permite
 * uma agenda futura real. O que este módulo NUNCA faz: inventar/estimar data.
 * Evento sem data-com e sem data de pagamento é descartado; data ausente sai
 * como `null` e o front decide como exibir.
 *
 * Uso: GET /api/market?fn=dividends&symbols=PETR4,MXRF11[&ahead=365][&past=45][&debug=1]
 * Env: BRAPI_TOKEN (só no servidor).
 */
const BRAPI = 'https://brapi.dev/api';
const BATCH = 10;            // tickers por requisição (plano Pro aceita múltiplos)
const CONCURRENCY = 3;
const MAX_SYMBOLS = 40;

const parse = (s) => String(s || '')
  .split(',').map((x) => x.trim().toUpperCase())
  .filter((x) => /^[A-Z0-9.\-]{2,12}$/.test(x));

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0', Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

/* ── normalização ──────────────────────────────────────────────────── */

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : null));

/**
 * Data → 'YYYY-MM-DD' (UTC) ou null. Aceita ISO ('2026-06-15T00:00:00.000Z'),
 * 'YYYY-MM-DD hh:mm:ss', epoch em segundos/ms. Rejeita sentinelas ('0000-00-00',
 * epoch 0, anos absurdos) — data implausível é pior que data ausente.
 */
export function isoDate(v) {
  if (v == null || v === '') return null;
  let ms = null;
  if (typeof v === 'number' && isFinite(v)) {
    ms = v > 1e11 ? v : v * 1000;               // heurística s vs ms
  } else {
    const s = String(v).trim();
    if (!s || /^0{4}-0{2}-0{2}/.test(s)) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    else {
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      if (br) ms = Date.UTC(+br[3], +br[2] - 1, +br[1]);
      else { const t = Date.parse(s); ms = isFinite(t) ? t : null; }
    }
  }
  if (ms == null || !isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 1995 || y > new Date().getUTCFullYear() + 6) return null;   // fora do plausível
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// Tipo do provento a partir do rótulo da B3 (sem inventar: desconhecido vira o próprio rótulo).
export function tipoProvento(label) {
  const s = String(label || '').toUpperCase();
  if (!s) return null;
  if (s.includes('JRS') || s.includes('JUROS') || s.includes('JCP')) return 'JCP';
  if (s.includes('RENDIMENTO')) return 'RENDIMENTO';
  if (s.includes('DIVIDENDO')) return 'DIVIDENDO';
  if (s.includes('AMORTIZ')) return 'AMORTIZACAO';
  return s;
}

/**
 * Um item de `cashDividends` → evento normalizado, ou null se não houver
 * NENHUMA data real ou valor válido. Nunca preenche data ausente.
 */
export function normEvent(d) {
  if (!d || typeof d !== 'object') return null;
  const valor = num(d.rate ?? d.value ?? d.amount);
  const dataCom = isoDate(d.lastDatePrior ?? d.comDate ?? d.exDate ?? d.dataCom);
  const dataPagamento = isoDate(d.paymentDate ?? d.payDate ?? d.dataPagamento);
  const dataAprovacao = isoDate(d.approvedOn ?? d.approvalDate);
  if (valor == null || valor <= 0) return null;
  if (!dataCom && !dataPagamento) return null;          // sem data real → fora da agenda
  return {
    tipo: tipoProvento(d.label ?? d.type),
    valor,
    dataCom,
    dataPagamento,
    dataAprovacao,
    relativoA: (d.relatedTo && String(d.relatedTo)) || null,
  };
}

// dedupe (mesma data+tipo+valor) e ordenação ascendente pela data que existir.
export function dedupeSort(list) {
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const k = `${e.dataPagamento || ''}|${e.dataCom || ''}|${e.tipo || ''}|${e.valor}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
  }
  const key = (e) => e.dataPagamento || e.dataCom || '';
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Filtra pela janela [hoje-past, hoje+ahead] usando a data que existir. */
export function inWindow(e, minISO, maxISO) {
  const k = e.dataPagamento || e.dataCom;
  return !!k && k >= minISO && k <= maxISO;
}

const shiftDays = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

/* ── busca na brapi ────────────────────────────────────────────────── */

// Extrai [{symbol, cash:[...]}] de uma resposta /quote (1 ou N tickers).
function pickResults(d) {
  const rs = (d && Array.isArray(d.results) ? d.results : []);
  return rs.map((r) => ({
    symbol: String((r && r.symbol) || '').toUpperCase(),
    cash: (r && r.dividendsData && Array.isArray(r.dividendsData.cashDividends)) ? r.dividendsData.cashDividends : null,
  })).filter((x) => x.symbol);
}

/**
 * Estratégia adaptativa: tenta em LOTE (1 requisição p/ até `BATCH` tickers com
 * `dividends=true`). Se a brapi não devolver `dividendsData` no modo lote (como
 * já acontece com o histórico — ver lib/history.js), refaz só os que faltaram,
 * um a um. Custo: 1 chamada por lote no melhor caso; 1 por ticker no pior.
 */
async function fetchDividends(symbols, token, diag) {
  const raw = {};   // TICKER → array cru de cashDividends
  const missing = [];
  await mapLimit(chunk(symbols, BATCH), CONCURRENCY, async (grp) => {
    const path = grp.map(encodeURIComponent).join(',');
    const d = await fetchJson(`${BRAPI}/quote/${path}?token=${encodeURIComponent(token)}&dividends=true`);
    const got = new Set();
    pickResults(d).forEach((r) => {
      if (r.cash) { raw[r.symbol] = r.cash; got.add(r.symbol); }
    });
    grp.forEach((s) => { if (!got.has(s)) missing.push(s); });
  });
  diag.batchHits = Object.keys(raw).length;
  diag.calls = chunk(symbols, BATCH).length;
  if (missing.length) {
    diag.calls += missing.length;
    await mapLimit(missing, CONCURRENCY, async (sym) => {
      const d = await fetchJson(`${BRAPI}/quote/${encodeURIComponent(sym)}?token=${encodeURIComponent(token)}&dividends=true`);
      pickResults(d).forEach((r) => { if (r.cash) raw[r.symbol] = r.cash; });
    });
  }
  diag.soloFallback = missing.length;
  return raw;
}

/* ── handler ───────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  const q = req.query || {};
  const symbols = [...new Set(parse(q.symbols))].slice(0, MAX_SYMBOLS);
  const ahead = Math.min(Math.max(parseInt(q.ahead, 10) || 365, 0), 730);
  const past = Math.min(Math.max(parseInt(q.past, 10) || 45, 0), 1825);
  const debug = String(q.debug || '') === '1';
  const token = process.env.BRAPI_TOKEN || '';

  const out = {};
  const meta = {
    source: 'brapi/b3', asOf: shiftDays(0), janela: { de: shiftDays(-past), ate: shiftDays(ahead) },
    pedidos: symbols.length, comEventos: 0, eventos: 0, futuros: 0,
    semDataPagamento: 0, semDataCom: 0, chamadas: 0, lote: null,
  };
  if (!symbols.length || !token) {
    // sem token/símbolo o endpoint degrada em vazio (o front cai no estado "sem dados")
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ results: out, meta: { ...meta, configured: !!token } });
  }

  const diag = { batchHits: 0, calls: 0, soloFallback: 0 };
  let raw = {};
  try { raw = await fetchDividends(symbols, token, diag); } catch { raw = {}; }

  const hoje = shiftDays(0);
  const min = shiftDays(-past);
  const max = shiftDays(ahead);
  let amostraCampos = null;

  for (const sym of symbols) {
    const cash = raw[sym];
    if (!Array.isArray(cash) || !cash.length) continue;
    if (debug && !amostraCampos && cash[0] && typeof cash[0] === 'object') amostraCampos = Object.keys(cash[0]);
    const evs = [];
    for (const item of cash) {
      const e = normEvent(item);
      if (!e) continue;
      if (!e.dataPagamento) meta.semDataPagamento++;
      if (!e.dataCom) meta.semDataCom++;
      if (!inWindow(e, min, max)) continue;
      e.futuro = (e.dataPagamento || e.dataCom) >= hoje;
      evs.push(e);
    }
    const lista = dedupeSort(evs);
    if (lista.length) {
      out[sym] = lista;
      meta.comEventos++;
      meta.eventos += lista.length;
      meta.futuros += lista.filter((e) => e.futuro).length;
    }
  }

  meta.chamadas = diag.calls;
  meta.lote = diag.soloFallback === 0 && diag.batchHits > 0;   // true = brapi entregou em lote
  if (debug) meta.camposBrutos = amostraCampos;

  // Proventos mudam por anúncio (poucas vezes ao dia) → cache curto na borda.
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=21600');
  return res.status(200).json({ results: out, meta });
}
