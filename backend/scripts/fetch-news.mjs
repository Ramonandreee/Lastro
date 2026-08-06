/**
 * ════════════════════════════════════════════════════════════
 * LASTRO · Fetcher de Notícias (renda variável)
 * ────────────────────────────────────────────────────────────
 * Busca manchetes de portais financeiros brasileiros (RSS), mantém
 * APENAS o que é relevante para renda variável (ações, FIIs, BDRs,
 * ETFs, cripto, macro/mercado) — descarta esporte, política geral,
 * entretenimento, finanças pessoais etc. Classifica (tag/ticker),
 * deduplica e grava no Supabase. Também limpa do banco o que ficou
 * fora do escopo.
 *
 * Rodado pelo GitHub Actions a cada ~20 min (.github/workflows/news.yml).
 *
 * Variáveis de ambiente necessárias:
 *   SUPABASE_URL              - https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY      - service/secret key (ignora RLS; NUNCA no front)
 * ════════════════════════════════════════════════════════════
 */

import Parser from 'rss-parser';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

/* Casamento manchete→ativo: MESMO módulo puro usado pelo front (vendor/newsmatch.js),
   para as duas pontas seguirem exatamente a mesma regra (e ela ter teste em node:test).
   Se o módulo faltar por algum motivo, o coletor degrada para o comportamento antigo
   (só ticker literal) — nunca deixa de coletar. */
let NM = null;
try {
  NM = createRequire(import.meta.url)('../../vendor/newsmatch.js');
} catch (e) {
  console.warn('⚠ vendor/newsmatch.js indisponível — marcação só por ticker literal:', e.message);
}

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ Defina SUPABASE_URL e SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'LastroBot/1.0' } });

/* ─── Fontes RSS (portais BR) ─────────────────────────── */
const RSS_SOURCES = [
  { name: 'InfoMoney',   url: 'https://www.infomoney.com.br/feed/',     tag: null },
  { name: 'Money Times', url: 'https://www.moneytimes.com.br/feed/',    tag: null },
  { name: 'Suno',        url: 'https://www.suno.com.br/noticias/feed/', tag: null },
  // adicione outros feeds aqui conforme necessário
];

/* ════════════════════════════════════════════════════════════
   CLASSIFICAÇÃO + RELEVÂNCIA (heurística rápida, sem custo)
   ════════════════════════════════════════════════════════════ */
const TICKER_RE = /\b([A-Z]{4}(?:3|4|5|6|11|34|35|39))\b/;

/** Tickers LITERAIS citados no título (só o que está escrito mesmo). */
function literalTickers(text) {
  if (NM) return NM.tickersInText(text);
  const m = (text || '').toUpperCase().match(TICKER_RE);
  return m ? [m[1]] : [];
}

/**
 * Todos os ativos citados: ticker literal + empresa citada pelo NOME
 * ("Raia Drogasil" → RADL3). Sem o nome, quase nenhuma notícia de AÇÃO ficava
 * ligada ao ativo — só os FIIs, que por convenção trazem o ticker no título.
 */
function detectTickers(text) {
  return NM ? NM.matchTickers(text) : literalTickers(text);
}

function detectTicker(text) {
  const all = detectTickers(text);
  return all.length ? all[0] : null;
}

function detectTag(text) {
  const t = (text || '').toLowerCase();
  // FII só pela CITAÇÃO LITERAL de um XXXX11 que não seja empresa conhecida —
  // senão "Santander" (SANB11) e "Klabin" (KLBN11) cairiam na aba de FIIs.
  const lit11 = literalTickers(text).find(x => /11$/.test(x));
  const isEquity11 = !!(lit11 && NM && NM.MAP[lit11.slice(0, 4)]);
  if (lit11 && !isEquity11)                                                        return 'FIIs';
  if (/\b(fii|fiis|fundo imobili|aluguel|laje|galp[aã]o|shopping|vac[aâ]ncia|cri\b)/.test(t)) return 'FIIs';
  if (/\b(bitcoin|cripto|ethereum|blockchain|token|solana|btc|eth|halving)\b/.test(t)) return 'Cripto';
  if (/\b(nasdaq|wall street|nyse|s&p|dow jones|fed\b|treasury)\b/.test(t))         return 'Stocks';
  if (/\b(bdr|bdrs)\b/.test(t))                                                     return 'BDRs';
  if (/\b(dividendo|dividendos|provento|proventos|jcp|rendimento|a[cç][aã]o|a[cç][oõ]es|balan[cç]o|lucro|preju[ií]zo|resultado|guidance)\b/.test(t)) return 'Ações';
  return 'Mercado';
}

/* Só passa o que pode influenciar ativos de renda variável.
   Precisa casar com algum termo de mercado/economia OU citar um ticker. */
const RELEVANT_RE = new RegExp([
  'a[cç][aã]o|a[cç][oõ]es|bolsa|\\bb3\\b|bovespa|ibovespa|\\bibov\\b|preg[aã]o|\\bíndice\\b|\\bindice\\b|\\bifix\\b',
  'dividendo|provento|\\bjcp\\b|\\bfii\\b|fiis|fundo imobili|\\betf\\b|\\bbdr\\b|\\bipo\\b|follow.?on|recompra|oferta p[uú]blica|subscri[cç][aã]o',
  'balan[cç]o|lucro|preju[ií]zo|receita|ebitda|guidance|trimestr|margem|endividamento|\\broe\\b|payout|\\bp/l\\b|\\bp/vp\\b',
  'selic|copom|\\bjuros\\b|infla[cç][aã]o|\\bipca\\b|\\bigp\\b|\\bpib\\b|c[aâ]mbio|d[oó]lar|\\beuro\\b|\\bfed\\b|banco central|tesouro|renda fixa|renda vari[aá]vel|\\bcdi\\b|arcabou[cç]o|reforma tribut',
  'petr[oó]leo|petrobras|min[eé]rio|commodit|safra|\\bbanco\\b|bancos|seguradora|saneamento|incorporadora|\\bvarejo\\b',
  'bitcoin|ethereum|\\bcripto\\b|blockchain|\\bbtc\\b|\\beth\\b|halving|stablecoin|\\bcrypto\\b',
  'nasdaq|wall street|s&p ?500|dow jones|\\bnyse\\b|treasury|mercado financeiro|investidor',
].join('|'), 'i');

function isRelevant(text) {
  const t = String(text || '');
  return RELEVANT_RE.test(t) || !!detectTicker(t);
}

const hashOf = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/* ════════════════════════════════════════════════════════════
   FETCH: RSS (com filtro de relevância)
   ════════════════════════════════════════════════════════════ */
async function fetchRSS() {
  const items = [];
  for (const src of RSS_SOURCES) {
    try {
      const feed = await parser.parseURL(src.url);
      let kept = 0;
      // `slice` é só um TETO por fonte (o feed costuma trazer bem menos). Subir de 25
      // para 60 não gera requisição extra: aproveita tudo que o RSS já entregou.
      for (const it of (feed.items || []).slice(0, 60)) {
        const title = (it.title || '').trim();
        if (!title || !isRelevant(title)) continue;   // descarta o que não é renda variável
        const tks = detectTickers(title);
        items.push({
          hash: hashOf(title + src.name),
          title,
          url: it.link || null,
          source: src.name,
          tag: src.tag || detectTag(title),
          ticker: tks[0] || null,
          tickers: tks.length ? tks : null,
          is_official: false,
          published_at: it.isoDate || it.pubDate || new Date().toISOString(),
        });
        kept++;
      }
      console.log(`✓ ${src.name}: ${kept} relevantes (de ${feed.items?.length || 0})`);
    } catch (e) {
      console.warn(`⚠ Falha em ${src.name}: ${e.message}`);
    }
  }
  return items;
}

/* ════════════════════════════════════════════════════════════
   UPSERT no Supabase (PostgREST)
   ════════════════════════════════════════════════════════════ */
/* A coluna `tickers` (text[]) é opcional: só existe depois que o schema atualizado
   for aplicado no Supabase. Enviar coluna inexistente faria o PostgREST devolver 400
   e NADA seria gravado — então perguntamos antes e, na dúvida, gravamos sem ela. */
let _hasTickersCol = null;
async function hasTickersColumn() {
  if (_hasTickersCol !== null) return _hasTickersCol;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/news?select=tickers&limit=1`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    _hasTickersCol = r.ok;
  } catch { _hasTickersCol = false; }
  if (!_hasTickersCol) console.log('· coluna news.tickers ausente — gravando só `ticker` (rode o schema.sql atualizado p/ ativar)');
  return _hasTickersCol;
}

async function upsertNews(items) {
  if (!items.length) return 0;
  const seen = new Set();
  let unique = items.filter(i => !seen.has(i.hash) && seen.add(i.hash));

  if (!(await hasTickersColumn())) unique = unique.map(({ tickers, ...rest }) => rest);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/news?on_conflict=hash`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(unique),
  });
  if (!res.ok) {
    console.error('✗ Erro no upsert:', res.status, await res.text());
    return 0;
  }
  return unique.length;
}

/**
 * Marca RETROATIVAMENTE as notícias já gravadas sem ticker ("Raia Drogasil abre
 * 300 lojas" foi salva com ticker=null antes do casamento por nome existir).
 * Conservador: só preenche onde está NULO — nunca sobrescreve marcação existente.
 * Agrupa por ticker para gastar poucas requisições (1 PATCH por ticker distinto).
 */
async function backfillTickers(limit = 500) {
  if (!NM) return 0;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/news?select=id,title&ticker=is.null&order=published_at.desc&limit=${limit}`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return 0;
    const rows = await r.json();
    const byTicker = new Map();
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const tk = detectTicker(row.title);
      if (!tk) continue;
      if (!byTicker.has(tk)) byTicker.set(tk, []);
      byTicker.get(tk).push(row.id);
    }
    let n = 0;
    for (const [tk, ids] of byTicker) {
      for (const group of chunk(ids, 100)) {
        const up = await fetch(`${SUPABASE_URL}/rest/v1/news?id=in.(${group.join(',')})&ticker=is.null`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ ticker: tk }),
        });
        if (up.ok) n += group.length;
        else console.warn('⚠ Falha no backfill de', tk, up.status);
      }
    }
    return n;
  } catch (e) {
    console.warn('⚠ Falha no backfill de tickers:', e.message);
    return 0;
  }
}

/* Remove do banco notícias fora do escopo de renda variável (limpa o legado). */
async function cleanupIrrelevant() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/news?select=id,title&order=published_at.desc&limit=500`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return 0;
    const rows = await r.json();
    const ids = (Array.isArray(rows) ? rows : []).filter(row => !isRelevant(row.title)).map(row => row.id);
    if (!ids.length) return 0;
    let removed = 0;
    for (const group of chunk(ids, 100)) {
      const del = await fetch(`${SUPABASE_URL}/rest/v1/news?id=in.(${group.join(',')})`, {
        method: 'DELETE',
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Prefer': 'return=minimal' },
      });
      if (del.ok) removed += group.length;
      else console.warn('⚠ Falha ao remover lote:', del.status);
    }
    return removed;
  } catch (e) {
    console.warn('⚠ Falha na limpeza:', e.message);
    return 0;
  }
}

/* ════════════════════════════════════════════════════════════
   MAIN
   ════════════════════════════════════════════════════════════ */
(async () => {
  console.log('▶ Lastro news fetcher —', new Date().toISOString());
  const rss = await fetchRSS();
  const n = await upsertNews(rss);
  console.log(`✓ ${n} notícias relevantes gravadas/atualizadas`);
  const fixed = await backfillTickers();
  if (fixed) console.log(`🏷 ${fixed} notícias antigas ganharam ticker (casamento por nome)`);
  const removed = await cleanupIrrelevant();
  if (removed) console.log(`🧹 ${removed} notícias fora de escopo removidas do banco`);
  console.log('■ Concluído');
})();
