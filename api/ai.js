/**
 * Proxy serverless da Inteligência Lastro (Vercel).
 * Mantém a chave da Anthropic no servidor — nunca exposta ao navegador.
 *
 * Deploy:
 *   1. vercel env add ANTHROPIC_API_KEY   (cole sua chave sk-ant-...)
 *   2. vercel --prod
 *   3. No config.js: AI_ENDPOINT = '/api/ai'
 */
export default async function handler(req, res) {
  // CORS básico (ajuste o domínio em produção)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Falha ao consultar a IA', detail: String(err) });
  }
}
