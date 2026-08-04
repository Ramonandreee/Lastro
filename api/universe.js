import { withObs } from "../lib/log.js";
/**
 * Universo completo de ativos (brapi.dev /quote/list).
 * ────────────────────────────────────────────────────────────────────
 * Retorna TODAS as ações, FIIs e BDRs disponíveis (ticker, nome, preço,
 * variação, setor, valor de mercado, logo) numa única resposta, cacheada
 * na borda. O front mescla isso nas listas, mantendo os fundamentos
 * profundos dos ativos curados. Roda em gru1 (vercel.json).
 *
 * Env: BRAPI_TOKEN
 */
const BRAPI = 'https://brapi.dev/api';
const ETF_MS = 6000;   // descoberta de ETF roda DEPOIS das listas: timeout curto p/ caber no maxDuration (30s)

const SECTOR_PT = {
  'Finance': 'Financeiro', 'Energy Minerals': 'Petróleo e Gás', 'Non-Energy Minerals': 'Mineração',
  'Utilities': 'Energia/Saneamento', 'Retail Trade': 'Varejo', 'Consumer Services': 'Consumo Serviços',
  'Consumer Non-Durables': 'Consumo', 'Consumer Durables': 'Bens de Consumo', 'Health Technology': 'Saúde',
  'Health Services': 'Saúde', 'Process Industries': 'Indústria', 'Producer Manufacturing': 'Bens Industriais',
  'Electronic Technology': 'Tecnologia', 'Technology Services': 'Tecnologia', 'Transportation': 'Logística',
  'Communications': 'Telecom', 'Commercial Services': 'Serviços', 'Industrial Services': 'Serviços Industriais',
  'Distribution Services': 'Distribuição', 'Miscellaneous': 'Diversos',
};

/** Ticker de ETF/fundo na B3: 4 letras + 11 (usado só como VALIDAÇÃO, nunca como classificador). */
const B3_11 = /^[A-Z]{4}11$/;

/**
 * O item da brapi é um ETF?
 * Só decide pelo CAMPO DE TIPO da resposta — nunca pelo sufixo do ticker
 * (ETF e FII terminam ambos em 11 na B3; classificar por sufixo traria FII como ETF).
 * Sem campo de tipo → false (prefere não mostrar a mostrar errado).
 */
/** true se o item traz ALGUM campo de tipo preenchido (a fonte classifica os ativos). */
export function hasTypeField(s) {
  if (!s || typeof s !== 'object') return false;
  return [s.type, s.assetType, s.asset_type, s.category, s.securityType]
    .some(v => typeof v === 'string' && v.trim());
}

export function isEtfItem(s) {
  if (!s || typeof s !== 'object') return false;
  const typeField = [s.type, s.assetType, s.asset_type, s.category, s.securityType]
    .find(v => typeof v === 'string' && v.trim());
  if (typeField) return /\betfs?\b/i.test(typeField.trim());
  // sem campo de tipo: aceita apenas quando o setor diz literalmente "ETF"
  const sec = typeof s.sector === 'string' ? s.sector.trim().toLowerCase() : '';
  return sec === 'etf' || sec === 'etfs';
}

/** Aplica o filtro de tipo a um payload cru da brapi. */
export function selectEtfs(items) {
  return (Array.isArray(items) ? items : []).filter(isEtfItem);
}

async function fetchJson(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0' }, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Normaliza um item cru da brapi no shape consumido pelo front. */
export function mapItem(s) {
  return {
    tk: s.stock || s.symbol,
    nm: s.name || s.stock,
    seg: SECTOR_PT[s.sector] || s.sector || 'Outros',
    px: typeof s.close === 'number' ? s.close : 0,
    var: typeof s.change === 'number' ? s.change : 0,
    mkt: s.market_cap || null,
    logo: s.logo || null,
  };
}

/** Payload cru de /quote/list (sem `type` quando type é vazio). */
async function listRaw(type, token, ms) {
  const t = type ? `type=${encodeURIComponent(type)}&` : '';
  const d = await fetchJson(`${BRAPI}/quote/list?${t}token=${encodeURIComponent(token)}&limit=10000`, ms);
  const arr = (d && d.stocks) || [];
  return Array.isArray(arr) ? arr : [];
}

async function list(type, token) {
  return (await listRaw(type, token)).map(mapItem).filter(x => x.tk);
}

/**
 * Descoberta de ETFs da B3 — defensiva, em cascata, para no 1º caminho com itens:
 *  (a) /quote/list?type=etf  → filtra pelo campo de tipo; se a resposta não trouxer
 *      tipo algum, só aceita quando ela é claramente um recorte de ETFs (tickers
 *      XXXX11 desconhecidos do universo de ações/FIIs) — assim, se a brapi IGNORAR
 *      o parâmetro e devolver o universo inteiro, nada é aceito.
 *  (b) /quote/list sem filtro → mantém só o que o campo de tipo marca como ETF.
 *  (c) nada → array vazio. Nunca fabrica ativo.
 * `known` = tickers já vistos como ação/FII (evita contaminar com FII, que também é 11).
 */
export function inferEtfsFromTypedList(items, known) {
  // SEM um universo de ações/FIIs confirmado não há como distinguir ETF de FII (ambos XXXX11).
  // Se a lista de fundos falhou (429/timeout -> []), `known` fica sem FII e TODO FII passaria.
  // Piso absoluto + amostra mínima fecham esse buraco: na dúvida, não infere.
  if (!known || known.size < 100 || !Array.isArray(items) || items.length < 5) return [];
  const cand = items.filter(s => {
    const tk = s && (s.stock || s.symbol);
    return typeof tk === 'string' && B3_11.test(tk) && !known.has(tk);
  });
  // exige que praticamente TODA a resposta caiba no recorte esperado de ETFs
  return cand.length && cand.length >= items.length * 0.8 ? cand : [];
}

async function discoverEtfs(token, stocksRaw, fundsRaw) {
  const known = new Set(
    [...stocksRaw, ...fundsRaw].map(s => s && (s.stock || s.symbol)).filter(Boolean)
  );
  // (a) type=etf
  const a = await listRaw('etf', token, ETF_MS);
  if (a.length) {
    const typed = selectEtfs(a);
    if (typed.length) return { etfs: typed.map(mapItem).filter(x => x.tk), src: 'type=etf' };
    const canInfer = stocksRaw.length > 0 && fundsRaw.length > 0;   // sem os dois, `known` não é confiável
    const inferred = canInfer ? inferEtfsFromTypedList(a, known) : [];
    if (inferred.length) return { etfs: inferred.map(mapItem).filter(x => x.tk), src: 'type=etf (sem campo de tipo)' };
  }
  // (b) lista completa, filtrada pelo campo de tipo
  // (b) é o caminho mais caro (lista inteira) e o de menor chance: só vale a pena se a resposta
  //     de (a) trouxe campo de tipo em algum item — senão a fonte não classifica e daria [] de novo.
  if (!a.some(hasTypeField)) return { etfs: [], src: 'indisponível' };
  const all = await listRaw('', token, ETF_MS);
  const typedAll = selectEtfs(all);
  if (typedAll.length) return { etfs: typedAll.map(mapItem).filter(x => x.tk), src: 'lista completa + campo de tipo' };
  // (c) nada confiável
  return { etfs: [], src: 'indisponível' };
}

async function handler(req, res) {
  const token = process.env.BRAPI_TOKEN || '';
  if (!token) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ stocks: [], funds: [], bdrs: [], etfs: [], note: 'BRAPI_TOKEN ausente no servidor' });
  }
  try {
    const [stocksRaw, fundsRaw, bdrs] = await Promise.all([
      listRaw('stock', token), listRaw('fund', token), list('bdr', token),
    ]);
    const stocks = stocksRaw.map(mapItem).filter(x => x.tk);
    const funds = fundsRaw.map(mapItem).filter(x => x.tk);
    // ETFs não vêm em type=stock/fund/bdr: descoberta própria (nunca fabrica)
    let etfs = [], etfSource = 'indisponível';
    try {
      const d = await discoverEtfs(token, stocksRaw, fundsRaw);
      etfs = d.etfs; etfSource = d.src;
    } catch (e) {
      console.error('[universe] etfs', String((e && e.message) || e));   // degrada em silêncio p/ o cliente
    }
    // universo muda pouco intradia: cacheia 15 min na borda
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({ stocks, funds, bdrs, etfs, etfSource });
  } catch (e) {
    console.error('[universe] erro', String((e && e.message) || e));   // detalhe fica no log, não vai ao cliente
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'falha ao consultar brapi list' });
  }
}

export default withObs("universe", handler);
