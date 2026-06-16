/**
 * Vercel Cron — coleta de Fatos Relevantes da CVM (dados.cvm.gov.br).
 * ────────────────────────────────────────────────────────────────────
 * Roda na região gru1 (São Paulo) para contornar o geobloqueio do gov.br,
 * que rejeita IPs fora do Brasil — por isso a coleta falha (ETIMEDOUT) nos
 * runners do GitHub Actions (Azure EUA/Europa). De dentro do BR, funciona.
 *
 * Agendado pelo vercel.json (crons). Grava no Supabase com a service key.
 * Deduplica por hash (mesma chave usada pelo coletor de RSS) — sem conflito.
 *
 * Env vars (Vercel → Project Settings → Environment Variables):
 *   SUPABASE_URL           - https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY   - sb_secret_... (escrita; ignora RLS; NUNCA no front)
 *   CRON_SECRET            - (recomendado) protege o endpoint; a Vercel envia
 *                            Authorization: Bearer <CRON_SECRET> ao disparar o cron
 */
import crypto from 'node:crypto';

const TICKER_RE = /\b([A-Z]{4}(?:3|4|5|6|11|34|35|39))\b/;
const hashOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const detectTicker = (t) => {
  const m = String(t || '').toUpperCase().match(TICKER_RE);
  return m ? m[1] : null;
};
function detectTag(text) {
  const t = String(text || '').toLowerCase();
  const tk = detectTicker(text);
  if (tk && /11$/.test(tk)) return 'FIIs';
  if (/\b(fii|fiis|fundo imobili|aluguel|laje|galp[aã]o|shopping|vac[aâ]ncia|cri\b)/.test(t)) return 'FIIs';
  return 'Ações';
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { 'User-Agent': 'LastroBot/1.0' }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  // Proteção: se CRON_SECRET estiver definido, exige o header que a Vercel envia.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Defina SUPABASE_URL e SUPABASE_SERVICE_KEY na Vercel' });
  }

  const year = new Date().getFullYear();
  const CVM_URL = `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/IPE_CIA_ABERTA_${year}.csv`;

  try {
    const r = await fetchWithTimeout(CVM_URL, 30000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString('latin1'); // CVM usa ISO-8859-1
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) return res.status(200).json({ ok: true, fatos: 0, gravadas: 0, nota: 'CSV vazio' });

    const header = lines[0].split(';').map((h) => h.trim());
    const col = (n) => header.indexOf(n);
    const iNome = col('Nome_Companhia');
    const iCat = col('Categoria');
    const iTipo = col('Tipo');
    const iAss = col('Assunto');
    const iData = col('Data_Entrega');
    const iLink = col('Link_Download');
    const cutoff = Date.now() - 1000 * 60 * 60 * 48; // últimas 48h

    const items = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(';');
      const categoria = (c[iCat] || '').trim();
      if (!/Fato Relevante|Comunicado ao Mercado/i.test(categoria)) continue;
      const data = (c[iData] || '').trim();
      const ts = Date.parse(data);
      if (!isNaN(ts) && ts < cutoff) continue;
      const empresa = (c[iNome] || '').trim();
      const assunto = (c[iAss] || c[iTipo] || categoria).trim();
      const title = `${empresa}: ${assunto || categoria}`;
      items.push({
        hash: hashOf(title + (data || '')),
        title: title.slice(0, 280),
        url: (c[iLink] || '').trim() || null,
        source: 'CVM · Fato Relevante',
        tag: detectTag(title),
        ticker: detectTicker(empresa),
        is_official: true,
        published_at: !isNaN(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
      });
    }

    // dedupe local por hash
    const seen = new Set();
    const unique = items.filter((i) => !seen.has(i.hash) && seen.add(i.hash));

    let gravadas = 0;
    if (unique.length) {
      const up = await fetch(`${SUPABASE_URL}/rest/v1/news?on_conflict=hash`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(unique),
      });
      if (!up.ok) {
        const detail = await up.text();
        return res.status(502).json({ error: 'upsert falhou', status: up.status, detail });
      }
      gravadas = unique.length;
    }

    return res.status(200).json({ ok: true, fatos: items.length, gravadas, ano: year });
  } catch (e) {
    const detail = String(e?.cause?.code || e?.message || e);
    return res.status(502).json({ error: 'falha ao coletar CVM', detail });
  }
}
