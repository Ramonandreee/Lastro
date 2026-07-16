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

export default async function handler(req, res) {
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

  // 3) rate-limit best-effort: 30 req / 5 min por usuário
  const now = Date.now(), win = 5 * 60 * 1000, lim = 30;
  const arr = (hits.get(user.id) || []).filter(t => now - t < win);
  if (arr.length >= lim) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Muitas solicitações. Tente novamente em instantes.' }); }
  arr.push(now); hits.set(user.id, arr);

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
