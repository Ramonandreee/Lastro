/**
 * LASTRO — Configuração (TEMPLATE)
 * ───────────────────────────────────────────────────────
 * 1. Copie este arquivo para `config.js` (que está no .gitignore).
 * 2. Preencha os valores reais (peça ao Ramon ou pegue nos painéis).
 *
 * O app FUNCIONA sem preencher nada (modo demonstração com dados estáticos).
 * Os valores abaixo ligam: login/sincronização (Supabase), IA (proxy),
 * cotações reais (brapi) e o feed de notícias.
 */
window.LASTRO_CONFIG = {
  // Proxy serverless da IA (protege a chave da Anthropic no servidor).
  // Em produção na Vercel é '/api/ai' (ver api/ai.js).
  AI_ENDPOINT: '/api/ai',

  // Token brapi.dev para cotações da B3 (grátis em https://brapi.dev).
  BRAPI_TOKEN: 'SEU_TOKEN_BRAPI',

  // Supabase — autenticação, sincronização (tabela user_state) e notícias.
  // Use a chave publishable/anon (somente leitura pública; escrita protegida por RLS).
  SUPABASE_URL: 'https://SEU_PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_SUA_CHAVE',

  // Configurações gerais
  REFRESH_MS: 60000,        // recarrega cotações a cada 60s
  NEWS_REFRESH_MS: 300000,  // recarrega notícias a cada 5 min
  APP_NAME: 'Lastro',
  VERSION: '1.1.0',
};
