// ─────────────────────────────────────────────────────────────────────────────
// RASCUNHO NÃO ATIVO — rate-limiting por IP nas rotas /api/*  (Lastro)
// A Vercel só executa um arquivo chamado EXATAMENTE `middleware.js` na raiz. Este
// arquivo (`.example.`) fica inerte até você ativar. NÃO foi testado ao vivo — revise
// com a lastro-review antes de renomear.
//
// PARA ATIVAR:
//   1. Crie um banco Redis grátis no Upstash (upstash.com).
//   2. Na Vercel → Environment Variables, configure:
//        UPSTASH_REDIS_REST_URL   e   UPSTASH_REDIS_REST_TOKEN
//   3. Renomeie este arquivo para `middleware.js` e faça deploy.
//   (Não conta no limite de 12 Serverless Functions — middleware roda no Edge.)
//
// COMPORTAMENTO: janela fixa de 60s por IP. FAIL-OPEN — se o Upstash não estiver
// configurado ou falhar, a requisição PASSA normalmente (o limitador nunca derruba o
// app). Ajuste LIMIT conforme a cota paga da brapi/FMP.
// ─────────────────────────────────────────────────────────────────────────────

export const config = { matcher: '/api/:path*' };

const LIMIT = 60;    // requisições por minuto, por IP
const WINDOW = 60;   // segundos (janela)

export default async function middleware(req) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;   // sem config → não limita (fail-open)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '0.0.0.0';
  const bucket = Math.floor(Date.now() / (WINDOW * 1000));
  const key = `rl:${ip}:${bucket}`;

  try {
    // pipeline atômico: INCR (conta) + EXPIRE (limpa a chave após a janela)
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(WINDOW)]]),
    });
    if (!r.ok) return;   // erro no store → fail-open
    const out = await r.json().catch(() => null);
    const count = Array.isArray(out) && out[0] ? Number(out[0].result) : 0;
    if (count > LIMIT) {
      return new Response(
        JSON.stringify({ error: 'Muitas requisições — tente de novo em instantes.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(WINDOW) } }
      );
    }
  } catch {
    // qualquer falha → deixa passar (fail-open)
  }
  // sem retorno → a requisição segue normalmente
}
