# HANDOFF — Projeto Lastro

> Cole este documento no início da conversa com o Claude Code para retomar o projeto de onde paramos.
> Os arquivos do projeto já estão nesta pasta/repositório.

---

## O que é o Lastro

Plataforma web de inteligência para o investidor brasileiro, **focada em renda variável** — concorrente direto do Investidor10, com proposta de design premium, recursos exclusivos e IA integrada. Produto será comercializado futuramente (pensar em escalabilidade).

Identidade: **Lastro** (termo financeiro = reserva que dá respaldo). Tagline: "Inteligência para o investidor brasileiro".
- Cores: esmeralda `#0E7C5A` (ganho/marca), clay `#D14343` (perda), ouro `#A87C2A` (elite do Score), azul `#2563EB` (interativo).
- Tipografia: Fraunces (display), Inter (UI), IBM Plex Mono (dados).

## Stack atual

- **Front:** `index.html` — single-file (HTML + CSS + JS puro), ~2.160 linhas. Charts via Chart.js (CDN), ícones Font Awesome (CDN), fontes Google Fonts. Sem framework ainda.
- **Backend de notícias:** `backend/` — coletor Node (`scripts/fetch-news.mjs`) que busca RSS de portais BR + Fatos Relevantes da CVM, classifica (tag/ticker), grava no Supabase. Agendado por GitHub Actions (`.github/workflows/news.yml`, cron a cada 20 min).
- **IA:** proxy serverless em `api/ai.js` (Vercel) para proteger a chave da Anthropic.
- **Dados de mercado:** hoje são **estáticos** (arrays no `index.html`). Hooks prontos para brapi.dev (cotações) e CoinGecko (cripto), mas ainda não conectados.

## Estrutura de arquivos

```
lastro/
├── index.html              # app completo (15 telas)
├── config.js               # chaves (VAZIO no repo; preencher localmente) — está no .gitignore
├── api/ai.js               # proxy serverless da IA (Vercel)
├── backend/
│   ├── scripts/fetch-news.mjs    # coletor de notícias
│   ├── supabase/schema.sql       # schema do banco
│   ├── package.json
│   ├── README-backend.md         # guia de setup do backend
│   └── .env.example
├── .github/workflows/news.yml    # cron do coletor (GitHub Actions)
├── .gitignore              # protege config.js e .env
├── README.md               # visão geral, deploy GoDaddy, arquitetura
└── HANDOFF.md              # este arquivo
```

## Telas já implementadas (15)

**Mercado:** Painel · Ações · FIIs · BDRs · ETFs · Stocks (EUA) · Criptomoedas
**Ferramentas:** Minha Carteira · Comparador · Rastreador (Screener) · Agenda de Dividendos · Carteiras Recomendadas · Notícias
**Inteligência:** Simulador de Renda Passiva · Score Lastro™

Recursos: busca global (⌘K), dark mode, microinterações, IA integrada em várias telas.
Sistema de tabela genérico e configurável (objeto `ASSET_CFG`) — adicionar nova classe de ativo é só adicionar config.

### Score Lastro™ (diferencial proprietário)
Índice 0–100 transparente: DY sustentável (35%) + Valuation P/VP (30%) + Liquidez (20%) + Consistência (15%). Função `scoreLastro()` no `index.html`.

## Contexto do GitHub

- Repositório: `lastro` (owner: Ramonandreee), criado **público** (para ter GitHub Actions gratuito e ilimitado). Migrar para privado no futuro.
- **Regra de ouro (repo público):** NENHUM segredo no código. Chaves vão em GitHub Secrets e variáveis de ambiente. O `config.js` no repo fica com placeholders vazios.

## Estado atual / o que falta (roadmap)

Já feito:
- [x] Front com 15 telas, design premium, dark mode
- [x] Score Lastro, Simulador, Comparador, Screener
- [x] Backend de notícias (RSS + CVM) com GitHub Actions + Supabase
- [x] Proxy de IA (Vercel)

Próximos passos (a decidir prioridade):
- [x] Subir o projeto para o repositório GitHub (primeiro commit)
- [x] Conectar cotações ao vivo (brapi.dev) substituindo os arrays estáticos, com fallback
      → preço e variação de Ações/FIIs/BDRs/ETFs + cripto. Token em config.js (BRAPI_TOKEN);
        sem token cai em modo Demonstração. Indicador de status no topbar. Fundamentos seguem estáticos.
- [ ] Configurar Supabase (rodar schema.sql) e secrets do GitHub para ativar as notícias reais
- [ ] Deploy do front (GoDaddy ou Vercel) + domínio
- [ ] Deploy do proxy de IA na Vercel
- [ ] Autenticação + carteira em nuvem (Supabase Auth)
- [ ] App mobile React Native (reaproveitar Score e lógica)
- [ ] Billing/planos (Free/Pro)

## Decisões técnicas importantes

- Plano gratuito em tudo por enquanto: GitHub Actions (cron), Supabase (DB + API), Vercel (proxy/deploy).
- O cron a cada 20 min mantém Supabase vivo (pausa após 7 dias) e o repo ativo (Actions desativa após 60 dias).
- Notícias exibem título + link para a fonte (nunca o texto completo) — conformidade com direitos autorais.
- Dados fundamentalistas (P/VP, ROE, vacância) são o ponto difícil/caro: brapi cobre cotações; fundamentos completos exigiriam fonte paga no futuro.

## Primeira tarefa sugerida para o Claude Code

"Inicialize o git neste diretório, confira que o `.gitignore` está protegendo `config.js` e `.env`, garanta que não há nenhuma chave secreta nos arquivos, e me ajude a fazer o primeiro commit e push para o repositório `lastro` no GitHub."
