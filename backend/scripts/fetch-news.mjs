/**
 * ════════════════════════════════════════════════════════════
 * LASTRO · Fetcher de Notícias
 * ────────────────────────────────────────────────────────────
 * Busca notícias de duas fontes gratuitas:
 *   1. RSS de portais financeiros brasileiros
 *   2. Fatos Relevantes oficiais da CVM (dados abertos)
 * Classifica (tag + ticker), deduplica e grava no Supabase.
 *
 * Rodado pelo GitHub Actions a cada ~20 min (ver .github/workflows/news.yml).
 *
 * Variáveis de ambiente necessárias:
 *   SUPABASE_URL              - https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY      - service_role key (ignora RLS; NUNCA exponha no front)
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
  { name: 'InfoMoney',   url: 'https://www.infomoney.com.br/feed/',            tag: null },
  { name: 'Money Times', url: 'https://www.moneytimes.com.br/feed/',           tag: null },
  { name: 'Suno',        url: 'https://www.suno.com.br/noticias/feed/',        tag: null },
  // adicione outros feeds aqui conforme necessário
];

/* ─── CVM: Fatos Relevantes (dados abertos) ───────────── */
// CSV diário do IPE (Informações Periódicas e Eventuais). Semicolon-delimited, ISO-8859-1.
const CVM_YEAR = new Date().getFullYear();
const CVM_URL  = `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/IPE_CIA_ABERTA_${CVM_YEAR}.csv`;

/* ════════════════════════════════════════════════════════════
   CLASSIFICAÇÃO (heurística rápida, sem custo)
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
  if (/\b(nasdaq|wall street|nyse|s&p|dow jones|fed\b|eua\b|estados unidos|treasury)\b/.test(t)) return 'Stocks';
  if (/\b(bdr|bdrs)\b/.test(t))                                                    return 'BDRs';
  if (/\b(dividendo|dividendos|provento|proventos|jcp|rendimento|a[cç][aã]o|a[cç][oõ]es|balan[cç]o|lucro|preju[ií]zo|resultado|guidance)\b/.test(t)) return 'Ações';
  return 'Mercado';
}

const hashOf = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

/* ════════════════════════════════════════════════════════════
   FETCH: RSS
   ════════════════════════════════════════════════════════════ */
async function fetchRSS() {
  const items = [];
  for (const src of RSS_SOURCES) {
    try {
      const feed = await parser.parseURL(src.url);
      for (const it of (feed.items || []).slice(0, 15)) {
        const title = (it.title || '').trim();
        if (!title) continue;
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
      }
      console.log(`✓ ${src.name}: ${feed.items?.length || 0} itens`);
    } catch (e) {
      console.warn(`⚠ Falha em ${src.name}: ${e.message}`);
    }
  }
  return items;
}

/* ════════════════════════════════════════════════════════════
   FETCH: CVM Fatos Relevantes
   ════════════════════════════════════════════════════════════ */
function parseCsvLine(line) {
  // CSV simples da CVM é semicolon-delimited e sem aspas internas problemáticas
  return line.split(';');
}

async function fetchCVM() {
  const items = [];
  try {
    const res = await fetch(CVM_URL, { headers: { 'User-Agent': 'LastroBot/1.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('latin1'); // CVM usa ISO-8859-1
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) return items;

    const header = parseCsvLine(lines[0]).map(h => h.trim());
    const col = name => header.indexOf(name);
    const iNome = col('Nome_Companhia');
    const iCat  = col('Categoria');
    const iTipo = col('Tipo');
    const iAss  = col('Assunto');
    const iData = col('Data_Entrega');
    const iLink = col('Link_Download');

    const cutoff = Date.now() - 1000 * 60 * 60 * 48; // últimas 48h

    for (let i = 1; i < lines.length; i++) {
      const c = parseCsvLine(lines[i]);
      const categoria = (c[iCat] || '').trim();
      if (!/Fato Relevante|Comunicado ao Mercado/i.test(categoria)) continue;

      const data = (c[iData] || '').trim();
      const ts = Date.parse(data);
      if (!isNaN(ts) && ts < cutoff) continue; // só recentes

      const empresa = (c[iNome] || '').trim();
      const assunto = (c[iAss] || c[iTipo] || categoria).trim();
      const title = `${empresa}: ${assunto || categoria}`;
      items.push({
        hash: hashOf(title + (data || '')),
        title: title.slice(0, 280),
        url: (c[iLink] || '').trim() || null,
        source: 'CVM · Fato Relevante',
        tag: detectTag(title) === 'Mercado' ? 'Ações' : detectTag(title),
        ticker: detectTicker(empresa),
        is_official: true,
        published_at: !isNaN(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
      });
    }
    console.log(`✓ CVM: ${items.length} fatos relevantes recentes`);
  } catch (e) {
    console.warn(`⚠ Falha na CVM: ${e.message}`);
  }
  return items;
}

/* ════════════════════════════════════════════════════════════
   UPSERT no Supabase (PostgREST)
   ════════════════════════════════════════════════════════════ */
async function upsertNews(items) {
  if (!items.length) return 0;
  // dedupe local por hash
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
  const [rss, cvm] = await Promise.all([fetchRSS(), fetchCVM()]);
  const all = [...cvm, ...rss]; // CVM (oficial) primeiro
  const n = await upsertNews(all);
  console.log(`✓ ${n} notícias gravadas/atualizadas`);
  await generateSummary(all);
  console.log('■ Concluído');
})();
