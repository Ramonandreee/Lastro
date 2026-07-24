# HANDOFF — Projeto Lastro

> Documento de contexto para retomar o projeto (com Claude Code ou com um novo dev).
> Para o guia técnico completo, veja o **README.md**. Este arquivo resume estado e histórico.

---

## O que é o Lastro

Plataforma web de inteligência para o investidor brasileiro, focada em **renda variável** — concorrente premium do Investidor10, com design refinado e Score proprietário. Produto será comercializado (planos Free / Premium / Investidor Pro). **A IA foi removida do produto (jul/2026)** — foco em dados reais e conta que fecha, sem "enrolação".

- Identidade: **Lastro** (reserva que dá respaldo). Marca esmeralda `#0E7C5A`/`#23B07E`, ouro para elite do Score, tinta quase-preta, dark mode nativo.
- App é **single-file**: `index.html` (~12.300 linhas, HTML + CSS + JS puro, sem framework). Assets sempre carregados (Chart.js, Font Awesome, PDF.js) e a matemática de dinheiro (`vendor/money.js`, centavos) são auto-hospedados em `vendor/`.

## Estado atual (jul/2026)

> **Atualização — sessão de refino "qualidade > quantidade" (jul/2026).** Rodada focada
> em honestidade de dados, limpeza e confiabilidade. O que mudou e já está na `main`:
> - **IA removida por completo** (front + backend + endpoint `api/ai.js` + SQLs de gate).
> - **Dados fabricados por RNG aposentados:** Radar de Barganhas e Detector de
>   Deterioração **removidos**; histórico de indicador na página do ativo só aparece
>   **quando é real** (DY real); donuts/curvas fake removidos.
> - **Backtest e evolução da carteira agora são REAIS:** `patrimonioEvolution()`
>   reconstrói mês a mês por **fechamentos reais** (sem RNG), CDI ponderado pela **Selic
>   real**, IBOV pelo **BOVA11**; câmbio USD por mês (USDBRL via FMP); Sharpe usa o CDI
>   real. Tudo em **centavos** (via `vendor/money.js`, sem drift). `lib/history.js` busca
>   histórico longo (até 2 anos, `range`/`interval`).
> - **Poda de navegação:** **Rastreador** standalone aposentado (os filtros seguem
>   embutidos nas listagens); **FIRE** virou a 4ª aba **"Independência"** dos Simuladores
>   (deep-link `nav('fire')` preservado, gate Pro por aba).
> - **Vercel:** removida do `vercel.json` a referência à `api/ai.js` (deletada) que
>   quebrava o build; `api/market.js` (dispatcher) ganhou 512MB/60s.
> - **Serverless consolidado:** para respeitar o **limite de 12 funções** da Vercel, os
>   proxies novos vivem sob `api/market.js` (dispatcher `?fn=crypto|usuniverse|usdetail|history|health`)
>   importando `lib/*` (helpers em `lib/` NÃO contam no limite). Hoje: **11/12** funções.
> - **Testes + observabilidade:** `node:test` em `test/*.mjs` (22 testes) + CI em
>   `.github/workflows/test.yml`; proxies logam com request-id (`lib/log.js`).
>
> **Pendências desta frente (próximos passos, decididos com o dono):**
> - **Persistência do Premium (bug de confiabilidade):** hoje o plano vive só em
>   `localStorage`, é zerado no logout e não restaura no relogin → assinante perde o
>   Premium. Decisão: **servidor é a fonte da verdade** — tabela `user_entitlement`
>   (gravável só por `service_role`, cliente só lê) + RPC provisória `grant_entitlement`
>   até haver gateway de pagamento. **A implementar.**
> - **Perfil como página cheia** (hoje é modal `#authBody`): foto, nome, e-mail, plano,
>   assinatura, renovação, configurações, segurança, dispositivos, suporte, sair.
> - **Carteiras Recomendadas reais:** substituir os números fabricados por **carteiras
>   públicas de corretoras** que publicam mensalmente (feature de dados a planejar).
>
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
- **Carteira:** Carteira, Proventos, Aporte, Imposto de Renda, Acompanhar (watchlist+alertas), Comparador.
- **Ferramentas Pro:** Raio-X, **Backtest (real — fechamentos históricos)**, Stress Test, Carteiras Recomendadas, **Simuladores** (renda, juros compostos, aposentadoria e **Independência/FIRE** — FIRE foi fundido aqui). *Aposentados (jul/2026): Radar de Barganhas, Consultor IA, Detector de Deterioração, Rastreador standalone.*
- **Conta/negócio:** cadastro em etapas com **captação de leads**, Perfil completo (dados cadastrais + perfil de investidor + contas conectadas + segurança/2FA), Assinatura, **Indique e Ganhe** (com simulador de comissão), Suporte (FAQ + tour), Planos.
- **Painel administrativo** (só para o e‑mail do dono): visão geral, clientes, leads, financeiro (MRR/ARR), aba **Ações** (plano de ação por sugestão, aprovar/arquivar, persistido) e aba **Relatórios** — construtor de relatórios com 5 tipos (geral, receita, crescimento, clientes, conversão), período preset (3M–36M) ou personalizado (de/até), filtros por plano e estado, gráficos (linha + barras), tabela de detalhamento e exportação em **PDF/CSV/compartilhar**. Séries ainda estimadas a partir dos dados atuais (`adminRamp`), prontas para virar histórico real quando o backend registrar snapshots mensais.
- **Gráfico "Patrimônio Total" (Início) + seletor de período:** seletor **7D / 30D / 3M / 6M / 1A / MAX** compacto e discreto (`.whero-periods`/`.wper`; padrão **7D**, memoriza na sessão via `sessionStorage['lastro_wperiod']` → `homeWealthPeriod`). O **gráfico** é **100% real, sem estimativa** (`wealthSeries`, MOVS + fechamentos reais, cents via `LastroMoney`) — plota **patrimônio** (inclui aportes; a linha degraus p/ cima quando você aporta). O **chip verde e a célula "Resultado"** mostram o **LUCRO real do período, aporte-neutro** — via `wealthPeriodKPI`/`portfolioPeriodVar` (mesmo método do `portfolioWeekVar`, generalizado; por lote base = fechamento real no início do período, e lote comprado dentro do período usa o preço de compra → **aporte não vira lucro**). **Rótulo honesto:** "desde {1ª aplicação}" quando ainda não completou o período (não mente "3 meses"). Chip, rodapé e SSR usam o MESMO `wealthPeriodKPI` → tudo bate. **Atenção (coordenar):** patrimônio (gráfico) ≠ lucro (chip) quando há aporte na janela — o tooltip de % do gráfico é patrimônio-based e pode divergir do chip. **Obs.: `wealthSeries()`/`wealthPeriodKPI()`/`initWealthSpark()` são editadas pelos dois donos — coordenar antes de mexer.**
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
aposentadoria, FIRE) e o **stress test** são cálculos/cenários, não dados. **O backtest
deixou de ser hipotético** — reconstrói pela série real de fechamentos (ver "sessão de
refino" acima). FIIs têm menos cobertura de fundamentos que ações no brapi
(vacância/composição não vêm da API); Stocks (EUA) o brapi não cobre.

## Stack

- **Front:** `index.html` — HTML + CSS + JS puro. Chart.js (CDN), Font Awesome (CDN), ícones de cripto via jsDelivr (`cryptocurrency-icons`).
- **Auth + DB + sync + notícias:** Supabase (Postgres + Auth + RLS). Tabela `user_state` guarda o estado do usuário (jsonb) via RPC `save_state`. *(Entitlement/plano migrará para tabela server-authoritative `user_entitlement` — ver pendências.)*
- **Cotações e dados reais:** proxies serverless em `api/*` + `lib/*` (dispatcher `api/market.js`) — brapi Pro (B3), FMP (EUA), CoinGecko (cripto), CVM (docs/FII/ETF). Chaves só no servidor (`BRAPI_TOKEN`, `FMP_KEY`). *(Não há mais IA no projeto.)*
- **Coletor de notícias:** Node em `backend/` + GitHub Actions (cron).
- **Deploy:** Vercel (`vercel.json`).

Estrutura de arquivos e como rodar: ver **README.md** (seções 3 e 4). Configuração: `config.example.js` → `config.js` (gitignored).

## Contexto do GitHub

- Repositório `Lastro` (owner: Ramonandreee). **Donos:** Ramon e Mikael — autoridade
  total e igual, ambos trabalham **direto na `main`** (sem PR). O deploy (Vercel) publica
  a cada push na `main`.
- **Só existe a branch `main`** (jul/2026 — branches antigas `claude/*` foram removidas
  para não confundir o trabalho conjunto). Comece e termine sempre da/na `main`
  (`git pull origin main` antes; push direto depois).
- **Regra de ouro:** nenhum segredo no código. `config.js` fica fora do git; chaves de
  servidor (`BRAPI_TOKEN`, `FMP_KEY`) vão nas env vars da Vercel; chaves de servidor do
  coletor de notícias, em GitHub Secrets. A chave **publishable/anon** do Supabase é
  pública por design (protegida por RLS). *(A antiga `ANTHROPIC_API_KEY` pode ser
  removida da Vercel — a IA saiu do projeto.)*

## Ainda importante saber

- **Dados reais são o padrão** hoje (B3/EUA/cripto/CVM via proxies); o curado é só
  fallback quando um proxy falha. Ainda há pontos com fallback determinístico rotulado
  (ex.: patrimônio em janelas longas sem histórico) — nunca RNG sem rótulo.
- **Fundamentos** (P/VP, ROE, vacância): brapi cobre cotações; fundamentos completos
  vêm de brapi Pro + CVM (FII/ETF). Stocks EUA via FMP.
- **Coletor CVM** é geobloqueado nos runners do GitHub (resolver via origem BR); os
  proxies rodam em `gru1` (Brasil) e alcançam a CVM.
- **Limite da Vercel:** **máximo 12 Serverless Functions** no plano. Estourar faz TODO
  deploy falhar em silêncio. Hoje 11/12 — novos endpoints entram como `?fn=` no
  dispatcher `api/market.js`, com a lógica em `lib/*` (helpers não contam).
- **Assinatura de commit:** neste ambiente os commits aparecem como "Unverified" (sem
  assinatura GPG/SSH — não disponível aqui). O e‑mail do committer está correto — é só a
  assinatura ausente, sem impacto no código.

## Roadmap curto (o que falta para "produção de verdade")

1. **Persistência do Premium / entitlement server-side** (`user_entitlement` + RPC) —
   prioridade: resolve o bug de perder o plano no relogin. *(ver pendências acima)*
2. **Perfil como página cheia** (hoje é modal).
3. **Livro de Movimentações** (venda, provento-caixa, saldo em caixa, eventos societários,
   IR realizado) — carteira/patrimônio reais centavo a centavo. **Plano faseado pronto:**
   `docs/PLANO-livro-movimentacoes.md` (MVP = venda + provento + caixa; `MOVS` como fonte de
   verdade e `CARTEIRA` como projeção derivada; sync reusa o blob `user_state`, sem endpoint novo).
4. **Import de carteira** (B3/CEI ou nota/extrato da corretora).
4. **Carteiras Recomendadas reais** (corretoras que publicam mensalmente).
5. **Proventos e IR reais** (data-com, DARF, informe anual); **2FA real** + rodapé
   institucional (CNPJ, termos, LGPD).
6. Rentabilidade real (TWR/MWR) vs CDI/IBOV/IPCA; exportar relatórios (PDF/Excel);
   histórico longo de patrimônio 100% real (ampliar `range`/`days` já suportado em `lib/history.js`).

## Convenções (resumo — detalhe no README §8)

- Validar CSS (chaves balanceadas) + JS (sintaxe) antes de cada commit (esperar `CSS chaves: 0 | JS: OK`). Rodar `node --test test/*.mjs` quando mexer em `lib/*`.
- **Trabalhar direto na `main`** (sem PR) — é produção e publica no Vercel a cada push.
- Mobile-first / iOS: cuidado com `viewport`, `touch-action`, `user-select` e `position: sticky`.
- Explicar jargão sempre com o padrão de **termo clicável** (`termLabel`/`TERM_CARDS`), nunca espalhando "?".
