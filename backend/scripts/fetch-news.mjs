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
 *   ANTHROPIC_API_KEY         - (opcional) para o resumo do dia por IA
 * ════════════════════════════════════════════════════════════
 */

import Parser from 'rss-parser';
import crypto from 'node:crypto';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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

function detectTicker(text) {
  const m = (text || '').toUpperCase().match(TICKER_RE);
  return m ? m[1] : null;
}

function detectTag(text) {
  const t = (text || '').toLowerCase();
  const ticker = detectTicker(text);
  if (ticker && /11$/.test(ticker))                                                return 'FIIs';
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
      for (const it of (feed.items || []).slice(0, 25)) {
        const title = (it.title || '').trim();
        if (!title || !isRelevant(title)) continue;   // descarta o que não é renda variável
        items.push({
          hash: hashOf(title + src.name),
          title,
          url: it.link || null,
          source: src.name,
          tag: src.tag || detectTag(title),
          ticker: detectTicker(title),
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
async function upsertNews(items) {
  if (!items.length) return 0;
  const seen = new Set();
  const unique = items.filter(i => !seen.has(i.hash) && seen.add(i.hash));

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
   RESUMO DO DIA por IA (opcional — diferencial do Lastro)
   ════════════════════════════════════════════════════════════ */
async function generateSummary(items) {
  if (!ANTHROPIC_KEY || !items.length) return;
  const manchetes = items.slice(0, 15).map(i => `- ${i.title}`).join('\n');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: 'Você é analista do mercado brasileiro de renda variável. Resuma o dia em no máximo 3 frases, objetivo e sem jargão excessivo.',
        messages: [{ role: 'user', content: `Manchetes de hoje:\n${manchetes}\n\nFaça um resumo curto do dia no mercado.` }],
      }),
    });
    const d = await r.json();
    const txt = d?.content?.[0]?.text;
    if (txt) {
      await fetch(`${SUPABASE_URL}/rest/v1/meta?on_conflict=key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ key: 'resumo_dia', value: txt, updated_at: new Date().toISOString() }),
      });
      console.log('✓ Resumo do dia atualizado');
    }
  } catch (e) {
    console.warn('⚠ Falha no resumo IA:', e.message);
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
  const removed = await cleanupIrrelevant();
  if (removed) console.log(`🧹 ${removed} notícias fora de escopo removidas do banco`);
  await generateSummary(rss);
  console.log('■ Concluído');
})();
