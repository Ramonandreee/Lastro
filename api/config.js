/**
 * Configuração pública do front, servida a partir das variáveis de ambiente
 * da Vercel — assim nenhuma chave fica versionada no repositório.
 *
 * Servido como /config.js (ver rewrite no vercel.json). O front carrega via
 * <script src="config.js">. Só expõe valores PÚBLICOS:
 *   - SUPABASE_ANON_KEY / publishable (leitura, protegida por RLS)
 *   - BRAPI_TOKEN (já usado no navegador ao chamar a brapi.dev)
 * A chave da Anthropic NUNCA vem aqui — fica só no proxy /api/ai.
 *
 * Configure no painel da Vercel (Project Settings → Environment Variables):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, BRAPI_TOKEN  (e opcionalmente REFRESH_MS, NEWS_REFRESH_MS)
 */
export default function handler(req, res) {
  const cfg = {
    AI_ENDPOINT: process.env.AI_ENDPOINT || '/api/ai',
    BRAPI_TOKEN: process.env.BRAPI_TOKEN || '',
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    REFRESH_MS: Number(process.env.REFRESH_MS) || 60000,
    NEWS_REFRESH_MS: Number(process.env.NEWS_REFRESH_MS) || 300000,
    APP_NAME: 'Lastro',
    VERSION: '1.1.0',
  };
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // cacheia na borda por 5 min; o navegador sempre revalida
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.status(200).send(
    `window.LASTRO_CONFIG = Object.assign(window.LASTRO_CONFIG || {}, ${JSON.stringify(cfg)});`
  );
}
