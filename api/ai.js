import { withObs } from "../lib/log.js";
/**
 * Proxy serverless da Inteligência Lastro (Vercel).
 * Mantém a chave da Anthropic no servidor — nunca exposta ao navegador.
 *
 * Endurecido: exige sessão Supabase válida (JWT), restringe CORS por allowlist,
 * limita model/max_tokens, aplica timeout e rate-limit best-effort, e nunca
 * vaza detalhes de erro do upstream ao cliente.
 *
 * Env necessárias (Vercel → Project Settings → Environment Variables):
 *   ANTHROPIC_API_KEY   — chave sk-ant-... (segredo)
 *   SUPABASE_URL, SUPABASE_ANON_KEY — para validar o token do usuário
 *   ALLOWED_ORIGINS     — (opcional) origens separadas por vírgula; default abaixo
 */
const ALLOWED = (process.env.ALLOWED_ORIGINS ||
  'https://lastro-dun.vercel.app,http://localhost:5173,http://localhost:5199')
  .split(',').map(s => s.trim()).filter(Boolean);

const MODELS = new Set(['claude-sonnet-4-6', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest']);
const hits = new Map(); // rate-limit best-effort (memória do runtime; a defesa principal é a autenticação)

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (origin && ALLOWED.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return origin;
}

async function verifyUser(token) {
  if (!token) return null;
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (e) { return null; }
}

// Rate limit DURÁVEL via Supabase (RPC rl_check, compartilhado entre instâncias).
// Retorna: true = dentro do limite, false = estourou, null = indisponível (cai no fallback).
async function rlCheckDurable(token, scope, limit, windowSecs) {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon || !token) return null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/rl_check`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_scope: scope, p_limit: limit, p_window: windowSecs }),
    });
    if (!r.ok) return null;                       // RPC ausente (migração não aplicada) → fallback
    const ok = await r.json();
    return typeof ok === 'boolean' ? ok : null;
  } catch { return null; }
}

// Plano EFETIVO do usuário via Supabase (my_plan). Retorna 'free'|'premium'|'pro' ou null
// (RPC ausente = migração não aplicada → sem gate de plano, comportamento atual).
async function getPlan(token) {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon || !token) return null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/my_plan`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const p = await r.json();
    return typeof p === 'string' ? p : null;
  } catch { return null; }
}

async function handler(req, res) {
  const origin = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // 1) origem: se veio Origin e não está na allowlist, bloqueia
  if (origin && !ALLOWED.includes(origin)) return res.status(403).json({ error: 'Origem não autorizada' });

  // 2) autenticação: exige sessão Supabase válida
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await verifyUser(token);
  if (!user) return res.status(401).json({ error: 'Faça login para usar a Inteligência Lastro' });

  // 3) rate-limit: 30 req / 5 min por usuário — DURÁVEL (Supabase rl_check), compartilhado entre
  //    instâncias; se a RPC não estiver aplicada, cai no limitador em memória (best-effort).
  const RL_LIMIT = 30, RL_WIN_S = 300;
  const durable = await rlCheckDurable(token, 'ai', RL_LIMIT, RL_WIN_S);
  if (durable === false) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Muitas solicitações. Tente novamente em instantes.' }); }
  if (durable === null) {
    const now = Date.now(), win = RL_WIN_S * 1000;
    const arr = (hits.get(user.id) || []).filter(t => now - t < win);
    if (arr.length >= RL_LIMIT) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Muitas solicitações. Tente novamente em instantes.' }); }
    arr.push(now); hits.set(user.id, arr);
  }

  // 3b) ENTITLEMENT server-side: usuário FREE tem cota diária de IA (enforçada no servidor,
  //     não contornável pelo cliente); PRO/Premium ilimitado. Se a migração de plano não
  //     estiver aplicada (my_plan ausente → null), não aplica o gate (comportamento atual).
  const plan = await getPlan(token);
  if (plan === 'free') {
    const _n = parseInt(process.env.AI_FREE_DAY, 10);           // 0 é respeitado; só cai no default se não-numérico
    const FREE_DAY = Number.isFinite(_n) ? _n : 15;
    const dayOk = await rlCheckDurable(token, 'ai_free_day', FREE_DAY, 86400);
    if (dayOk === false) { res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'Limite diário de IA do plano Gratuito atingido. Faça upgrade para uso ilimitado.', upgrade: true }); }
  }

  // 4) valida e limita o corpo (nada é repassado verbatim)
  const b = req.body || {};
  const model = MODELS.has(b.model) ? b.model : 'claude-sonnet-4-6';
  const max_tokens = Math.min(Math.max(parseInt(b.max_tokens, 10) || 1000, 1), 1500);
  const system = typeof b.system === 'string' ? b.system.slice(0, 8000) : undefined;
  const messages = Array.isArray(b.messages) ? b.messages.slice(0, 20) : [];
  if (!messages.length) return res.status(400).json({ error: 'Requisição inválida' });

  // 5) chama a Anthropic com timeout
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    });
    const data = await r.json();
    if (!r.ok) { console.error('[ai] upstream', r.status, data && data.error); return res.status(r.status === 401 ? 502 : r.status).json({ error: 'Falha ao consultar a IA' }); }
    return res.status(200).json(data);
  } catch (err) {
    console.error('[ai] erro', String(err));
    return res.status(504).json({ error: 'A IA demorou para responder. Tente novamente.' });
  } finally {
    clearTimeout(to);
  }
}

export default withObs("ai", handler);
