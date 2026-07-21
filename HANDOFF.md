# HANDOFF — Projeto Lastro

> Documento de contexto para retomar o projeto (com Claude Code ou com um novo dev).
> Para o guia técnico completo, veja o **README.md**. Este arquivo resume estado e histórico.

---

## O que é o Lastro

Plataforma web de inteligência para o investidor brasileiro, focada em **renda variável** — concorrente premium do Investidor10, com design refinado, Score proprietário e IA integrada. Produto será comercializado (planos Free / Premium / Investidor Pro).

- Identidade: **Lastro** (reserva que dá respaldo). Marca esmeralda `#0E7C5A`/`#23B07E`, ouro para elite do Score, tinta quase-preta, dark mode nativo.
- App é **single-file**: `index.html` (~11.600 linhas, HTML + CSS + JS puro, sem framework). Assets sempre carregados (Chart.js, Font Awesome, PDF.js) são auto-hospedados em `vendor/`.

## Estado atual (jul/2026)

> **App funcional (jul/2026) — dados reais, sem demo fora do dev.** Dados fictícios
> agora vivem **só no Modo desenvolvedor** (donos). Fora dele, sem aportes, o painel
> fica **zerado** (estado vazio "Monte sua carteira"), sem a antiga carteira demo
> automática nem a pílula "Demonstração". A **sincronização entre aparelhos** ganhou
> reconciliação *last-write-wins* por carimbo de tempo (`_stateTs`/`ts` no `user_state`):
> só adota a nuvem se ela for mais nova, guarda anti-eco ao aplicar, **flush só quando
> há edição local pendente** (aparelho que só visualizou não sobrescreve a nuvem ao
> fechar), carimbo monotônico (mitiga relógio atrasado) e guarda de migração (nuvem
> vazia não apaga carteira local). **Limite conhecido do beta:** a reconciliação usa o
> relógio do cliente e substitui o blob inteiro — em edição *simultânea* nos dois
> aparelhos, o último a gravar vence (sem merge por campo), e um device com hora
> adiantada pode "ganhar" sempre. **Correção robusta futura:** mover a decisão de "quem
> é mais novo" para o servidor (RPC/trigger no Postgres que só atualiza se
> `incoming.ts >= stored.ts` usando `now()` do banco). Cabeçalho perdeu os indicadores
> "Mercado aberto"/"Ao vivo"; o menu lateral virou **recolhível no desktop** (rail).
>
> **Sync — correção da causa-raiz (jul/2026):** o `access_token` do Supabase expira
> (~1h) e não era renovado → 401 "JWT expired", carteira parava de subir e o outro
> aparelho podia sincronizar vazio por cima (perda de dados no logout). Agora:
> `refreshSession()` renova com o `refresh_token` e `sbFetch()` repete a requisição em
> 401. A função **`save_state`** (RPC no `backend/supabase/schema.sql`) carimba o `ts`
> pelo relógio do **servidor** (resolve clock-skew); cliente usa a RPC com fallback ao
> upsert direto. Duas blindagens anti-perda em `loadCloudState`: **(1)** com mutação
> local pendente (`_dirty`, persistido em `lastro_dirty`) o aparelho **empurra o local**
> em vez de adotar a nuvem; **(2)** carteira **vazia da nuvem nunca apaga** carteira
> local com posições. `authLogout` só apaga os dados do aparelho se confirmar o flush
> (senão pede confirmação). Há **status de sync visível** no menu da conta + "Sincronizar
> agora" (`syncNow`, puxa antes de subir). **Trade-offs conhecidos (by-design):** *(M1)*
> não dá para **esvaziar a carteira de forma sincronizada** — a blindagem (2) faz os
> ativos "voltarem" no outro aparelho; *(M2)* um aparelho `_dirty` vence a nuvem sem
> comparar `ts`, então edição concorrente do peer pode ser descartada. Ambos erram para
> **preservar** dados. **Setup obrigatório:** rodar `backend/supabase/schema.sql` no
> Supabase (cria `user_state` + `save_state`); sem isso, não há sync na nuvem.

Muito além do MVP inicial. Já implementado e no ar (`main`):

- **Mercado:** Início, Ações, FIIs, ETFs (B3), Cripto, Notícias, Agenda, Score Lastro™. Filtros fundamentalistas (o antigo Rastreador) **embutidos** em cada listagem (botão Filtros) — **gratuitos**.
- **Internacional:** Stocks (EUA), BDRs, ETFs internacionais (listados nos EUA, em US$). Os ETFs foram separados: a página de Mercado mostra só os da B3 (sem filtro de região); os internacionais têm página própria.
- **Carteira:** Carteira, Proventos, Aporte, FIRE, Imposto de Renda, Acompanhar (watchlist+alertas), Comparador.
- **Ferramentas Pro:** Raio-X, Backtest, Stress Test, Radar de Barganhas, Consultor IA, Detector de Deterioração, Carteiras Recomendadas, **Simuladores** (renda, juros compostos, aposentadoria).
- **Conta/negócio:** cadastro em etapas com **captação de leads**, Perfil completo (dados cadastrais + perfil de investidor + contas conectadas + segurança/2FA), Assinatura, **Indique e Ganhe** (com simulador de comissão), Suporte (FAQ + tour), Planos.
- **Painel administrativo** (só para o e‑mail do dono): visão geral, clientes, leads, financeiro (MRR/ARR), aba **Ações** (plano de ação por sugestão, aprovar/arquivar, persistido) e aba **Relatórios** — construtor de relatórios com 5 tipos (geral, receita, crescimento, clientes, conversão), período preset (3M–36M) ou personalizado (de/até), filtros por plano e estado, gráficos (linha + barras), tabela de detalhamento e exportação em **PDF/CSV/compartilhar**. Séries ainda estimadas a partir dos dados atuais (`adminRamp`), prontas para virar histórico real quando o backend registrar snapshots mensais.
- **Gráfico "Patrimônio Total" (Início) + seletor de período:** seletor **7D / 30D / 3M / 6M / 1A / MAX** compacto e discreto (`.whero-periods`/`.wper` — botões pequenos, baixa altura, realce sutil no ativo; padrão **7D**, memoriza na sessão via `sessionStorage['lastro_wperiod']` → `homeWealthPeriod`). Cada período redesenha o gráfico e **atualiza os indicadores** (chip de variação R$/% e a célula "Resultado {período}" do rodapé, via `updateWealthKPIs`). `wealthSeries(period)` usa **fonte única por janela**: (1) tabela de histórico de patrimônio (`patHistArr`), (2) reconstrução por fechamentos reais da B3 (`HIST_CLOSE`/`closeOn`, `/api/market?fn=history` — **o backend só devolve ~90 dias**: brapi `range=3mo`, `days` clampado 7–90 em `lib/history.js`). Se os dados reais **não cobrirem bem a janela** (comum em 6M/1A/MAX enquanto o histórico é curto), cai numa **estimativa determinística** (`wealthEst`) ancorada no patrimônio real, com tendência/ondulação que escalam por período (semente por período) → **cada período desenha uma curva distinta e o gráfico sempre muda**. Termina sempre no patrimônio atual. **Follow-up p/ dados 100% reais em janelas longas:** ampliar o range no `lib/history.js` (brapi `range=6mo/1y/...`) e o `days` no `loadPortfolioHistory`. **Obs.: `wealthSeries()`/`wealthEst()`/`initWealthSpark()` são editadas pelos dois donos — coordenar antes de mexer.**
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
- **`api/fii.js`** — **VP/cota, P/VP e vacância REAIS de FII** (brapi não dá) do **Informe
  Mensal FII da CVM**. `?ticker&name&price` (um fundo, casa CNPJ pelo nome) e `?index=1`
  (todos os fundos, p/ a listagem). Front: `loadFiiCvm`/`applyFiiCvm` (página) e
  `loadFiiIndex`/`matchFiiCvm` (listagem, match por nome com **unicidade** — nunca no
  fundo errado; `f.pvpReal` tem prioridade).
- **`api/fundinfo.js`** — **patrimônio líquido + taxa de administração de ETFs B3** do
  cadastro de fundos da CVM (`cad_fi.csv`: `VL_PATRIM_LIQ`/`TAXA_ADM`). Front: `loadEtfInfo`
  sobrepõe `a.pat`/`a.tx` (match por nome com unicidade).
- **`api/us.js`** — **cotação + fundamentos REAIS de Stocks EUA** (brapi cobre só B3).
  Ordem: **FMP** (se `FMP_KEY` no servidor — free tier, confiável, preço+P/L+market cap) →
  **Yahoo v7** (grátis, + P/VP e DY) → **Stooq** (fallback só de preço). Front: `loadUsQuotes`
  sobrepõe `a.px/a.var/a.pe/a.pvp/a.dy/a.mkt`. Tudo em USD.
- **`api/usuniverse.js`** — **universo EUA** (FMP stock-screener): top ~300 stocks +
  ~250 ETFs internacionais por valor de mercado (ticker, nome, setor, preço, market cap).
  Front: `loadUsUniverse` mescla em `STOCKS` e `ETFS` (usd:true) via `mergeUsUniverse`;
  `loadUsQuotes` completa preço/variação/P-L da página visível. Precisa de `FMP_KEY`.
- **`api/crypto.js`** — **mercado cripto** (CoinGecko `/coins/markets`, BRL): top-100 por
  valor de mercado com preço, market cap, volume 24h, supply, ATH/ATL, ranking e variações
  1h/24h/7d/30d. Front: `loadCryptoMarkets` expande `CRIPTO` (14→100) e enriquece a página
  do ativo (`metricsForDetail`/`keyStatsHTML` ramo cripto). Sem chave.
- **`api/usdetail.js`** — **detalhe REAL de Stock/ETF EUA** (FMP): perfil (setor, indústria,
  descrição, site, funcionários, CEO, país), fundamentos TTM (P/L, P/VP, DY, ROE, ROA,
  margens, LPA, VPA, valor de mercado/firma), histórico de preço 1a, dividendos, e p/ ETF a
  taxa de adm. (expense ratio), patrimônio (AUM), principais posições e setores. Front:
  `loadUsDetail`/`applyUsDetail` (aba Sobre, Estatísticas, gráfico real, card de posições).
  Precisa de `FMP_KEY`.
- **ETFs B3 ao vivo + completude:** `loadB3EtfQuotes` busca preço/variação REAIS dos ETFs
  da B3 via `/api/quotes` (brapi) e usa o **nome oficial** do brapi. ETFs marcados `_b3`
  ficam ocultos até a brapi confirmar o ticker (inexistente nunca aparece) — permite ampliar
  a lista com segurança.

**Fundamentos maximizados (brapi Pro):** `api/asset.js`/`api/fundamentals.js` derivam de
dado real (DRE/balanço) também ROA, ROIC (aprox.), margens, PSR, EV/EBITDA, EV/EBIT,
P/EBIT, P/Ativo, giro, dív.líq/EBITDA, dív.líq/PL, payout, CAGR, LPA, VPA, 52 sem. —
ligados no front p/ ações e BDRs. **Env vars de servidor (Vercel):** `BRAPI_TOKEN`
(obrigatória p/ B3) e `FMP_KEY` (opcional, estabiliza Stocks EUA). CVM não precisa de chave.

> **Nota:** os proxies da CVM/US **não são testáveis fora do Brasil / do ambiente de
> deploy** (geobloqueio/política de rede). Todos **falham com segurança** (retornam null →
> o front mantém o curado, sem regressão). Validar em produção nas URLs `/api/us?symbols=…`,
> `/api/fii?index=1`, `/api/fundinfo?names=…`, `/api/usuniverse` (stocks+ETFs int.),
> `/api/usdetail?symbol=AAPL` (detalhe EUA) e `/api/crypto?n=100` (CoinGecko é alcançável e
> pode ser testado direto no navegador).

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
