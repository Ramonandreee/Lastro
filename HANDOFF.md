# HANDOFF — Projeto Lastro

> Documento de contexto para retomar o projeto (com Claude Code ou com um novo dev).
> Para o guia técnico completo, veja o **README.md**. Este arquivo resume estado e histórico.

---

## O que é o Lastro

Plataforma web de inteligência para o investidor brasileiro, focada em **renda variável** — concorrente premium do Investidor10, com design refinado, Score proprietário e IA integrada. Produto será comercializado (planos Free / Premium / Investidor Pro).

- Identidade: **Lastro** (reserva que dá respaldo). Marca esmeralda `#0E7C5A`/`#23B07E`, ouro para elite do Score, tinta quase-preta, dark mode nativo.
- App é **single-file**: `index.html` (~9.900 linhas, HTML + CSS + JS puro, sem framework).

## Estado atual (jul/2026)

Muito além do MVP inicial. Já implementado e no ar (`main`):

- **Mercado:** Início, Ações, FIIs, BDRs, ETFs, Stocks, Cripto, Notícias, Agenda, Score Lastro™. Filtros fundamentalistas (o antigo Rastreador) **embutidos** em cada listagem (botão Filtros, Pro).
- **Carteira:** Carteira, Proventos, Aporte, FIRE, Imposto de Renda, Acompanhar (watchlist+alertas), Comparador.
- **Ferramentas Pro:** Raio-X, Backtest, Stress Test, Radar de Barganhas, Consultor IA, Detector de Deterioração, Carteiras Recomendadas, **Simuladores** (renda, juros compostos, aposentadoria).
- **Conta/negócio:** cadastro em etapas com **captação de leads**, Perfil completo (dados cadastrais + perfil de investidor + contas conectadas + segurança/2FA), Assinatura, **Indique e Ganhe** (com simulador de comissão), Suporte (FAQ + tour), Planos.
- **Painel administrativo** (só para o e‑mail do dono): visão geral, clientes, leads, financeiro (MRR/ARR), e uma aba **Ações** com plano de ação por sugestão (aprovar/arquivar), tudo persistido.
- **Auth + sincronização na nuvem** (Supabase): sessão, perfil e carteira sincronizam entre dispositivos.
- **UX premium:** tour guiado, onboarding, busca global (⌘K), dark mode, PWA instalável, tooltips de termos como cards clicáveis, barras de abas sticky, zoom/seleção desativados no mobile (feel de app nativo).

## Stack

- **Front:** `index.html` — HTML + CSS + JS puro. Chart.js (CDN), Font Awesome (CDN), ícones de cripto via jsDelivr (`cryptocurrency-icons`).
- **Auth + DB + sync + notícias:** Supabase (Postgres + Auth + RLS). Tabela `user_state` guarda o estado do usuário (jsonb).
- **IA:** proxy serverless `api/ai.js` (Vercel) protegendo a chave da Anthropic.
- **Cotações:** brapi.dev (B3) — token em `config.js`; sem token, modo Demonstração.
- **Coletor de notícias:** Node em `backend/` + GitHub Actions (cron).
- **Deploy:** Vercel (`vercel.json`).

Estrutura de arquivos e como rodar: ver **README.md** (seções 3 e 4). Configuração: `config.example.js` → `config.js` (gitignored).

## Contexto do GitHub

- Repositório `lastro` (owner: Ramonandreee). Colaborador adicionado para ajudar no desenvolvimento.
- **Regra de ouro:** nenhum segredo no código. `config.js` fica fora do git; chaves de servidor (Anthropic) vão nas env vars da Vercel; chaves de servidor do coletor, em GitHub Secrets. A chave **publishable/anon** do Supabase é pública por design (protegida por RLS).

## Ainda importante saber

- **Dados são de demonstração** na maior parte (arrays no `index.html`, com selo "ilustrativo"). O maior salto de valor é torná-los reais.
- **Fundamentos** (P/VP, ROE, vacância) são o ponto caro: brapi cobre cotações; fundamentos completos exigem fonte paga.
- **Coletor CVM** é geobloqueado nos runners do GitHub (resolver via origem BR).
- **Assinatura de commit:** neste ambiente os commits aparecem como "Unverified" (chave SSH de assinatura vazia). O e‑mail do committer está correto — é só a assinatura ausente, sem impacto no código.

## Roadmap curto (o que falta para "produção de verdade")

1. **Cotações ao vivo** (B3 + cripto) substituindo os dados estáticos.
2. **Import de carteira** (B3/CEI ou nota/extrato da corretora).
3. **Proventos e IR reais** (data-com, DARF, informe anual).
4. **2FA real** (hoje é demonstração) + rodapé institucional (CNPJ, termos, LGPD).
5. Rentabilidade real (TWR/MWR) vs CDI/IBOV/IPCA; exportar relatórios (PDF/Excel).

> Regra combinada com o dono: **dados reais só quando ele avisar.** Até lá, evoluir UX, organização e recursos client-side.

## Convenções (resumo — detalhe no README §8)

- Validar CSS (chaves balanceadas) + JS (sintaxe) antes de cada commit.
- Trabalhar em branch; `main` é produção.
- Mobile-first / iOS: cuidado com `viewport`, `touch-action`, `user-select` e `position: sticky`.
- Explicar jargão sempre com o padrão de **termo clicável** (`termLabel`/`TERM_CARDS`), nunca espalhando "?".
