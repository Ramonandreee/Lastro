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

- **Mercado:** Início, Ações, FIIs, ETFs (B3), Cripto, Notícias, Agenda, Score Lastro™. Filtros fundamentalistas (o antigo Rastreador) **embutidos** em cada listagem (botão Filtros) — **gratuitos**.
- **Internacional:** Stocks (EUA), BDRs, ETFs internacionais (listados nos EUA, em US$). Os ETFs foram separados: a página de Mercado mostra só os da B3 (sem filtro de região); os internacionais têm página própria.
- **Carteira:** Carteira, Proventos, Aporte, FIRE, Imposto de Renda, Acompanhar (watchlist+alertas), Comparador.
- **Ferramentas Pro:** Raio-X, Backtest, Stress Test, Radar de Barganhas, Consultor IA, Detector de Deterioração, Carteiras Recomendadas, **Simuladores** (renda, juros compostos, aposentadoria).
- **Conta/negócio:** cadastro em etapas com **captação de leads**, Perfil completo (dados cadastrais + perfil de investidor + contas conectadas + segurança/2FA), Assinatura, **Indique e Ganhe** (com simulador de comissão), Suporte (FAQ + tour), Planos.
- **Painel administrativo** (só para o e‑mail do dono): visão geral, clientes, leads, financeiro (MRR/ARR), aba **Ações** (plano de ação por sugestão, aprovar/arquivar, persistido) e aba **Relatórios** — construtor de relatórios com 5 tipos (geral, receita, crescimento, clientes, conversão), período preset (3M–36M) ou personalizado (de/até), filtros por plano e estado, gráficos (linha + barras), tabela de detalhamento e exportação em **PDF/CSV/compartilhar**. Séries ainda estimadas a partir dos dados atuais (`adminRamp`), prontas para virar histórico real quando o backend registrar snapshots mensais.
- **Auth + sincronização na nuvem** (Supabase): sessão, perfil e carteira sincronizam entre dispositivos.
- **Portão de entrada (captação de leads):** sem cadastro/login **ninguém acessa o app**. `afterSplash()` decide: sem sessão → `#intro`; com sessão + biometria → `#bioLock`; senão → app.
- **Apresentação de entrada** (`#intro`, estilo Nomad): carrossel editorial **de arraste manual** (dots, sem autoavanço) — fundo off-white, headlines grandes quase-pretas, foto por slide (Unsplash, com fallback em gradiente da marca) e verde só como acento. CTAs persistentes **"Entrar"** e **"Fazer cadastro"** abrem o login/cadastro **por cima** do portão (`#authModal` com z-index acima). O app só é revelado (`introDone()`) após autenticar; ao sair (`authLogout`) o portão volta.
- **Face ID / biometria** (WebAuthn): prompt "Ative o Face ID" no 1º login (só em aparelhos com autenticador de plataforma); ao reabrir com biometria ativa, tela **"boas-vindas de volta"** (saudação por horário + nome, "Entrar com biometria" / "Entrar com senha").
- **UX premium:** tour guiado, onboarding, busca global (⌘K), dark mode, PWA instalável, tooltips de termos como cards clicáveis, barras de abas sticky, zoom/seleção desativados no mobile (feel de app nativo).

## Dados reais (brapi Pro + CVM) — jul/2026

Os ativos da B3 puxam **dados reais** via proxies serverless (o token do brapi Pro
fica só no servidor, em `BRAPI_TOKEN` na Vercel):

- **`api/quotes.js`** — cotações ao vivo (B3 em lotes via brapi Pro; cripto via CoinGecko).
- **`api/universe.js`** — universo completo de ações/FIIs/BDRs (lista brapi).
- **`api/fundamentals.js`** — indicadores fundamentalistas em lote (P/L, P/VP, DY, ROE…).
- **`api/asset.js`** — página de ativo COMPLETA: cotação, histórico de preços (por
  período), proventos (histórico longo), perfil da empresa, fundamentos e demonstrações
  (DRE + balanço) reais. No front: `ASSET_LIVE`, `loadAssetLive`, `applyAssetLive`
  sobrepõem os valores reais em `a`/`FUND[tk]` e nos gráficos.
- **`api/documents.js`** — **Documentos oficiais da CVM** (Fatos Relevantes, Comunicados,
  Assembleias, Atas) com download. Baixa o ZIP anual do dataset IPE e descompacta com
  `zlib` nativo (Vercel roda em `gru1`/Brasil → alcança a CVM).

**Página de ativo:** todas as abas + **Comparador** exibem dados reais, com fallback
seguro para os dados curados se um proxy falhar. Cripto (CoinGecko) e notícias (coletor
Supabase) já eram reais.

**Ainda hipotético por natureza (não é bug):** simuladores/projeções (juros compostos,
aposentadoria, FIRE, backtest, stress test) são cálculos, não dados. FIIs têm menos
cobertura de fundamentos que ações no brapi (vacância/composição não vêm da API);
Stocks (EUA) o brapi não cobre.

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
