# Auditoria completa — Projeto Lastro

**Data:** 2026-07-16
**Orquestração:** multi-agentes (`.claude/agents/`) — architect · backend · frontend · finance · qa · review
**Escopo:** `index.html` (11.596 linhas), `api/*` (8 proxies serverless), `backend/` (coletor), Supabase/RLS, dados reais (brapi/BCB/CoinGecko/CVM), fluxos end-to-end.
**Estado do código:** validação obrigatória `CSS chaves: 0 | JS: OK` (íntegro). Nenhuma alteração foi feita — esta é uma auditoria de leitura.

> ### 🟢 Atualização — 2026-07-18 (estado atual)
> Os **4 Críticos** e os demais **bloqueadores** foram remediados (rodadas 1–4, §5–§8).
> Destaques desde a auditoria: o **gráfico de 7 dias virou histórico REAL** (snapshots
> diários — a série sintética saiu); o app **saiu do modo demonstração** (dados fictícios
> só no Modo desenvolvedor); a **sincronização entre aparelhos passou a funcionar de
> verdade** (renovação de JWT + carimbo de tempo no servidor + blindagens anti-perda);
> **proventos** agora respeitam a **data-com**; e a **variação do dia** só usa cotação real.
> **Veredito de publicação atual: liberado** (as mudanças que tocam dinheiro passaram por
> finance → qa → review). **Pendências reais que restam:** entitlement server-side (billing),
> 2FA real e refactors de arquitetura (dívida técnica, sem impacto de veracidade). A tabela
> de riscos abaixo é o **retrato de 2026-07-16**; para o que já foi fechado, ver §5–§8.

---

## 1. Sumário executivo — os 5 riscos mais críticos

> **Veredito de publicação: 🔴 BLOQUEADO.** Regra aplicada: nenhuma feature que toca em dado financeiro do usuário é aprovada sem validação de `lastro-finance` **e** `lastro-qa`. O finance retornou **4 Críticos de veracidade abertos**; a QA passou nos fluxos, mas os números exibidos são fabricados. Não publicar na `main` até corrigir/rotular os itens abaixo.

| # | Severidade | Risco | Onde |
|---|---|---|---|
| 1 | **Crítico** | **Prompt da IA com carteira e macro fabricados**: o system prompt fixa uma carteira (HGLG11/KNCR11/VISC11/VGIR11) e macro (SELIC 14,5%, IFIX 3.777, Ibov 168.619) e trata todo usuário como "Ramon". A "Inteligência Lastro" analisa ativos que o usuário pode não possuir, com dados possivelmente desatualizados, apresentados como fato. | `index.html:9122-9127` |
| 2 | **Crítico** | **Gráfico "últimos 7 dias" é uma série inventada**: `wealthSpark7d` reconstrói o patrimônio com ruído senoidal a partir de uma âncora sintética; o tooltip mostra **R$ exato e % "do dia"** e o card **não tem selo de estimativa** (o aria-label afirma ser a evolução real). | `index.html:8254-8266` (render 8223-8230) |
| 3 | **Crítico** | **Proventos gerados por RNG entram no patrimônio real**: `provPerCotaMonth` usa `rngF(seedFrom(...))` para fabricar pagamentos mensais que somam em `portfolioStats().prov` e no retorno total; exibidos no home ("Meus proventos" e chip "% total") **sem selo**, lado a lado com "Ganho de capital" real. | `index.html:3671-3676, 3726, 4079-4084` (exib. 8221/8242) |
| 4 | **Crítico** | **DY por ano fabricado mesmo havendo dividendos reais**: o card "Dividend Yield por ano" e o "DY médio (5 anos)" usam `indHistory('dy',...)` (série RNG), sem selo, ignorando `ASSET_LIVE.dividends`. | `index.html:10753, 10758-10762` |
| 5 | **Alto** | **Proxy de IA é um relay ABERTO**: `api/ai.js` tem CORS `*`, sem autenticação e sem rate-limit; qualquer site/pessoa faz `POST /api/ai` e consome a `ANTHROPIC_API_KEY` (custo direto). Runner-up de mesma severidade: **escalonamento de plano** (`loadCloudState` confia em `data.plan` da nuvem → usuário vira PRO grátis via DevTools). | `api/ai.js:12-27` · `index.html:4779/4802` |

**Leitura geral:** a **matemática** do app está correta (identidades de `portfolioStats`, DARF, FIRE, exemplo do Score conferido) e os **fluxos** funcionam (QA passou em onboarding, carteira, indicadores, offline). O problema central é de **veracidade e confiança**: números estimados/fabricados são apresentados como reais e rastreáveis em superfícies de dinheiro do usuário. Segurança de **segredos está limpa** (tree + histórico).

---

## 2. Achados por agente

### 2.1 `lastro-architect` — arquitetura & dívida técnica

- **[Alto]** `index.html:9466` — `viewAlertas()` ~1.730 linhas (God-object: markup + lógica + handlers). Rec: extrair sub-blocos em funções puras de string.
- **[Alto]** `index.html:3499-11594` — Todo o JS num único `<script>` global sem camadas (UI × dados × domínio × estado), 322 `onclick` inline acoplando HTML a ~832 funções. Rec: fronteiras por seção, namespace `Data.*` para fetch, delegação de eventos.
- **[Alto]** `README.md:11`, `HANDOFF.md:13`, `ONBOARDING.md:4` — Docs dizem "~9.900 linhas"; real 11.596 (~17% defasado). Rec: corrigir contagem e revisar §6 do README.
- **[Médio]** `index.html:8149-8170` (`loadMacroReal`), `11466` (`refreshQuotes`) — fetch BCB/CoinGecko dentro do fluxo de view/`afterRender`, sem camada de dados, fallback silencioso. Rec: isolar coletores com cache/erro explícito.
- **[Médio]** `index.html:4659` (`viewAssinatura` ~879), `7799` (`viewNoticias` ~649), `8919` (`viewDeterioracao` ~547) — funções gigantes multi-responsabilidade. Rec: decompor.
- **[Médio]** `index.html:6055-6071, 6782, 7038, 10914` — séries estimadas/reconstruídas (evolução vs CDI/IBOV, proventos DY/12, composição FII por RNG, `adminRamp`) como dado. Rec: manter selos, planejar histórico real.
- **[Médio]** `index.html:3946` (`const NEWS`) — notícias hardcoded ("há 2 h") como fallback; envelhecem. Rec: marcar demo / datar dinamicamente.
- **[Médio]** `index.html:4640` — assinatura/billing é mock. Rec: rastrear pendência antes de comercializar.
- **[Baixo]** `api/document.js` vs `api/documents.js` — **não são duplicatas**: `/api/documents` (lista CVM) e `/api/document` (baixa ZIP). Ambos usados. Rec: renomear para evitar confusão.
- **[Baixo]** `index.html:5688, 6639, 6643` — helper global `pc` re-declarado local em `viewAdmin` (shadowing). Rec: renomear locais (`pct`).
- **[Baixo]** `index.html:11325` (poll de tema 1,2 s) e `11571` (poll de cotações 60 s) — `setInterval` de boot nunca limpos. Rec: pausar quando pref≠auto / aba oculta.
- **[Baixo]** `index.html` — 30 `new Chart(` × 24 `.destroy()`; risco baixo (`destroyCharts` central). Rec: garantir todo `new Chart` em `charts.<key>`.

_Totais — Crítico: 0 · Alto: 3 · Médio: 5 · Baixo: 4_

### 2.2 `lastro-backend` — backend/dados & segurança

- **[Alto]** `api/ai.js:12-27` — Proxy Anthropic é relay ABERTO (sem auth, sem rate-limit, CORS `*`); `req.body` repassado verbatim. Qualquer um consome a chave paga. Rec: validar JWT do Supabase antes de proxiar, restringir `Allow-Origin` ao domínio de produção, limitar `model`/`max_tokens`, rate-limit por IP/usuário.
- **[Médio]** `index.html:11480` (`refreshQuotes`) — fetch sem `AbortController`/timeout; conexão travada prende o selo em "Atualizando…". Rec: `AbortController` + timeout ~12 s → tratar como "Offline · em cache".
- **[Médio]** `index.html:8156, 8164` (`loadMacroReal`) — fetch BCB/CoinGecko sem timeout dentro de `Promise.all`; se o BCB pendurar, `_macroBusy` nunca zera. Rec: timeout por chamada.
- **[Médio]** `index.html:28, 3498` — CDNs (Font Awesome 6.5.1, Chart.js 4.4.1) sem `integrity` (SRI)/`crossorigin`. CDN comprometido → JS arbitrário na sessão. Rec: `integrity` + `crossorigin`, ou auto-hospedar.
- **[Baixo]** `api/ai.js:29` — repassa `data`/`status` crus da Anthropic ao cliente (vaza detalhes de erro). Rec: mensagem genérica ao cliente, log só no servidor.

_OK (sem achado): sem SQL injection (tudo PostgREST parametrizado); RLS habilitado em `user_state` (`auth.uid()=user_id`) e `news`/`meta` (leitura pública por design, deny-by-default no resto); `npm audit` backend = 0 vuln; nenhum segredo hardcoded no tree/histórico; `config.js` nunca commitado; SSRF restrito; `applyQuotes` valida NaN/número._

_Totais — Crítico: 0 · Alto: 1 · Médio: 3 · Baixo: 1_

### 2.3 `lastro-frontend` — UI/UX & exposição client-side

- **[Alto]** `index.html:3498, 28` — Chart.js e Font Awesome de CDN sem SRI/crossorigin (mesmo achado do backend, na ótica de execução de JS no contexto da sessão). Rec: SRI + crossorigin.
- **[Médio]** `index.html:9144` — Saída da IA injetada como HTML **sem `esc()`**: `el.innerHTML = txt.replace(...)`. XSS se o proxy devolver conteúdo manipulado. Rec: `esc(txt)` antes dos replace (como em 11114).
- **[Médio]** `index.html:4990-4994` (`signupVerifyPhone`) — 2FA/WhatsApp cosmético: qualquer 6 dígitos marca `phoneVerified=true`. Rec: validar código no servidor; enquanto desativado, não gravar `phoneVerified=true`.
- **[Médio]** `index.html:4802` (`saveCloudState`/`cloudPayload`) — `user_state` gravado sem validação server-side (POST direto no REST). Proteção só RLS + validação client contornável; permite injetar dados arbitrários (inclusive `plan`/`tier`). Rec: validar/normalizar em Edge Function/trigger; nunca confiar em `plan`/`tier` vindos do `user_state`.
- **[Médio]** `index.html:6849, 6923, 8269, 7740` — inicializadores de gráfico com `return` silencioso quando `HAS_CHART` é falso → canvas em branco sem mensagem. Rec: usar `chartUnavail()` (7053).
- **[Médio]** `index.html:8562, 9136` — endpoint de IA com default embutido apontando para `api.anthropic.com/v1/messages` (hoje sem chave). Rec: default `/api/ai`, nunca o host da Anthropic.
- **[Baixo]** `index.html:8241-8242` — cores fixas inline (`#1B4F9C`, `#B8860B`) em tela com tema; contraste baixo no dark. Rec: tokens (`var(--brand)`/`var(--gold)`).
- **[Baixo]** `index.html:9672-9674, 5359, 5424` — e-mails dos donos hardcoded no bundle + gate do Admin só no client. Dados admin são demo/locais (sem vazamento real). Rec: se admin ler dado real, proteger por RLS/role; não expor e-mails.
- **[Baixo]** `index.html:2423-2424` — scroll-lock via `:has()` (Safari 15.4+); iOS antigo rola atrás do modal. Rec: complementar com `position:fixed`/`top` no body.
- **[Baixo]** `index.html:5` — viewport `maximum-scale=1/user-scalable=no` (intencional, feel nativo) prejudica acessibilidade (zoom). Só registro.

_Totais — Crítico: 0 · Alto: 1 · Médio: 5 · Baixo: 4_

### 2.4 `lastro-finance` — veracidade dos números (auditoria crítica)

- **[Crítico]** `index.html:9122-9127` — `SYS` (prompt da IA) com carteira e macro **hardcoded/fabricados**; a IA cita como reais/atuais e assume carteira fixa ≠ a real do usuário. Rec: injetar carteira real (`portfolioByTicker`) + macro real (`MARKET`/`loadMacroReal`) com timestamp; nunca embutir números fixos no prompt.
- **[Crítico]** `index.html:8254-8266` — `wealthSpark7d` inventa a série de 7 dias (interpolação + ruído); tooltip com R$/% exatos; card **sem selo "estimativa"**. Rec: rotular estimativa e remover valores/percentuais precisos do tooltip (ou mostrar só o ponto real final).
- **[Crítico]** `index.html:3671-3676, 3726, 4079-4084` — proventos por RNG (`factor=0.84+rngF()*0.34`) somam em `prov` → home "Meus proventos"/"% total" sem selo, misturados com número real. Rec: rotular estimado; usar rendimento-base declarado sem RNG até proventos reais por data-com.
- **[Crítico]** `index.html:10753, 10758-10762` — card "DY por ano" e "DY médio (5 anos)" via RNG, sem selo, mesmo com dividendos reais em `ASSET_LIVE`. Rec: usar DY real quando disponível; senão rotular estimativa.
- **[Alto]** `index.html:10085-10089` (usos 10091-10093, 8799, 8899) — `indHistory` gera "média histórica" por RNG que alimenta `indAnalysis` ("acima/abaixo da média histórica"), Radar de Barganhas (tem selo) e Detector de Deterioração (afirma tendência sobre empresa real). Rec: só emitir sinal com série real; rebaixar linguagem quando estimado.
- **[Alto]** `index.html:9929-9936` (render 10766-10769) — `dividendSeries` (card "Rendimentos 12m/Dividendos por ano"): FII sem `ASSET_LIVE` cai em RNG; ação usa array estático; sem selo. Rec: selo condicional real vs estimado.
- **[Médio]** `index.html:3506-3512` vs `3515-3527` — `scoreLastro` (DY35+PVP30+liq20+consist15, teto 100) ≠ `ensureScore` (DY35+PVP30+roe20+conN fixo 10,5, teto ~95,5). Mesmo ativo, Score diferente conforme curado/ao vivo. Rec: unificar fórmula e teto.
- **[Médio]** `index.html:8228, 8227` — home foot "Renda/mês" e "DY médio" derivam de `a.div` estático/DY-12 sem selo. Rec: marcar estimativa e explicitar premissa (DY/12).
- **[Médio]** `index.html:8188` — Poupança diária hardcoded (`pow(1.005,1/30)-1`) ignora TR/regra 70%·Selic; exibida junto a CDI/IBOV "ao vivo". Rec: derivar da Selic com regra oficial ou rotular aproximação.
- **[Baixo]** `index.html:10812-10821` — `receitasPorTipo`/`receitasPorRegiao` 100% RNG (código morto hoje). Rec: remover ou marcar placeholder.
- **[Baixo]** `index.html:10235` — nota diz "setor com dados reais" mas `sectorAvg` vem de arrays curados. Rec: "média setorial de referência".

_OK (matemática correta): identidades de `portfolioStats` (`lucro=atual-invest`; `lucroProv=+prov`; %/invest); `usdBrlRate` consistente; `fireCalc` e DARF (15%/20%, isenção R$ 20k) corretos e rotulados; exemplo Score HGLG11 → 78,58 → 79 ✓._

_Totais — Crítico: 4 · Alto: 2 · Médio: 3 · Baixo: 2_

### 2.5 `lastro-qa` — testes end-to-end (navegador real)

Todos os fluxos críticos renderizaram; **nenhuma exceção de JS** (`pageerror`).

| Fluxo | Veredito |
|---|---|
| Onboarding (intro + bioLock, claro/escuro) | ✅ Passou — sem barra branca; logo/X sem colisão |
| Carteira (add/edit/remove + recálculo) | ✅ Passou — patrimônio e Saúde recalcularam |
| Indicadores (painel + ativo, claro/escuro, privacidade, tooltip) | ✅ Passou — máscara só nos R$; tooltip correto |
| Offline (bloqueio de rede) | ✅ Passou c/ ressalva — cai para "Demonstração" em ~64 ms |

- **[Baixo]** `index.html:11500` (`refreshQuotes`, refresh manual offline) — toast com mensagem técnica crua "Cotações: Failed to fetch". Rec: mensagem amigável quando `!LIVE.on`.
- **[Baixo]** dobra/safe-area (painel) — `.wstats` fecham em ~779 px (sandbox); com notch (~47 px) + home-indicator (~34 px) a borda raspa ~16 px na faixa do gesto. Rec: conferir em device real; se preciso, reduzir espaçamento acima dos cards.
- **[Baixo]** modal de aporte — data exibida como `MM/DD/YYYY`: locale `en-US` do Chromium do sandbox (provável artefato, não bug). Rec: confirmar em device pt-BR.

_Limitações de sandbox (não bugs): ícones/imagens de CDN em branco; Chart.js só via injeção local._

_Totais — Crítico: 0 · Alto: 0 · Médio: 0 · Baixo: 3_

### 2.6 `lastro-review` — auditoria final & revisão cruzada

**Achados novos:**
- **[Alto]** `index.html:4779` — `loadCloudState()` confia no plano vindo da nuvem (`if(d.plan) localStorage.setItem('lastro_plan', d.plan)`; idem `d.sub` em 4782). Como o `user_state` é gravado pelo próprio cliente (RLS só garante `user_id`), o usuário faz um PATCH com `data.plan='pro'` e vira PRO. **Escalonamento de entitlement client-authoritative** (recursos pagos sem pagar). Rec: derivar plano de fonte server-side (tabela de billing com escrita só por service_role/webhook de pagamento); nunca de `data.plan`.
- **[Baixo]** `index.html:138, 750, 1597, 1862, 2425, 3061` — `backdrop-filter` sem par `-webkit-backdrop-filter`; no iOS o blur não renderiza (splash, scrims, tooltip). Inconsistente com 430/2325/2351/2988 (que têm o prefixo). Rec: adicionar `-webkit-backdrop-filter` idêntico.
- **[Baixo]** `index.html:2423-2424` — scroll-lock por `:has()` sem fallback JS. Rec: garantir também uma classe no `<body>` (como já é feito para `nav-open`).

**Revisão cruzada:** SYS fabricado, spark 7d, proventos RNG, DY por ano, relay `api/ai.js`, saída IA sem `esc()`, `user_state` sem validação, 2FA cosmético — **todos CONFIRMADOS**. Timeouts/SRI CONFIRMADO (parcial).

**Segredos — LIMPO:** varredura de tree + histórico completo (`git log -p --all`, `rev-list --all`): nenhuma chave real; só env vars e placeholders. `config.js` nunca commitado.

**Veredito: 🔴 BLOQUEADO.** Não publicar até: (1) `finance` corrigir/rotular os 4 Críticos de veracidade e `qa` provar; (2) fechar o relay `api/ai.js`; (3) mover entitlements para fonte server-side.

_Totais (novos) — Crítico: 0 · Alto: 1 · Médio: 0 · Baixo: 2_

---

## 3. Tabela final de status

| Agente | Crítico | Alto | Médio | Baixo | Subtotal |
|---|:--:|:--:|:--:|:--:|:--:|
| lastro-architect | 0 | 3 | 5 | 4 | 12 |
| lastro-backend | 0 | 1 | 3 | 1 | 5 |
| lastro-frontend | 0 | 1 | 5 | 4 | 10 |
| lastro-finance | 4 | 2 | 3 | 2 | 11 |
| lastro-qa | 0 | 0 | 0 | 3 | 3 |
| lastro-review (novos) | 0 | 1 | 0 | 2 | 3 |
| **TOTAL** | **4** | **8** | **16** | **16** | **44** |

> Observação: SRI/CDN aparece em backend e frontend (mesma causa, óticas distintas); ao consolidar as ações, contam como **1 correção**. Idem "user_state sem validação" (frontend) + "confiança em data.plan" (review) → mesma correção de entitlements server-side.

---

## 4. Plano de correção sugerido (por prioridade)

**Bloqueadores de publicação (fazer primeiro):**
1. **Veracidade (finance + qa):** rotular como "estimativa" ou substituir por dado real — (a) gráfico 7 dias, (b) "Meus proventos"/"% total" no home, (c) "DY por ano"/"DY médio", e (d) reescrever o `SYS` para injetar a carteira e o macro reais do usuário.
2. **`api/ai.js`:** exigir token de sessão (JWT Supabase), restringir CORS ao domínio, limitar `model`/`max_tokens`, rate-limit, timeout.
3. **Entitlements:** parar de confiar em `data.plan`/`data.sub` do `user_state`; validar plano no servidor.

**Alto/Médio (na sequência):** `esc()` na saída da IA (9144); SRI nos CDNs; timeouts em `refreshQuotes`/`loadMacroReal`; unificar fórmula do Score; `chartUnavail()` nos gráficos silenciosos; 2FA real quando reativado.

**Baixo (higiene):** `-webkit-backdrop-filter`; fallback do scroll-lock; toast amigável offline; tokens no lugar de cores fixas; limpar `setInterval` de boot; corrigir contagem de linhas nas docs; renomear `document.js`/`documents.js`.

> Regra de time: cada correção que toque em dinheiro do usuário volta ao ciclo **finance → qa → review** antes de publicar na `main`.

---

## 5. Remediação — rodada 1 (bloqueadores) · 2026-07-16 · commit `3704e2b`

Aprovada por **finance → qa → review** (review: *LIBERAR*; qa: *LIBERADO*, 0 regressões / 0 exceções em 12 cenários). Escopo escolhido: **bloqueadores**, com **dado real onde dá, senão selo de estimativa**.

| Bloqueador | Status | Como foi fechado |
|---|---|---|
| IA com carteira/macro fabricados (`SYS`) | ✅ Fechado | `buildSys()` injeta carteira real (`portfolioByTicker`) + macro real (`MARKET`) e instrui a **nunca inventar** número. |
| Saída da IA sem `esc()` (XSS) | ✅ Fechado | `esc(txt)` antes do markdown mínimo. |
| Endpoint da IA apontando p/ Anthropic no cliente | ✅ Fechado | Default `/api/ai` no chat e no Raio-X, com `Authorization: Bearer` da sessão. |
| `api/ai.js` relay aberto | ✅ Fechado | JWT do Supabase obrigatório, CORS por allowlist, cap de model/max_tokens, timeout, rate-limit, erros genéricos. |
| Escalonamento de plano via `user_state` | ✅ Fechado | `loadCloudState` não lê `data.plan`/`data.sub`; `cloudPayload` não os grava (deny-by-default). |
| Gráfico "7 dias" fabricado sem selo | ✅ Rotulado | Selo "estimativa · 7d" + tooltip com prefixo "~". |
| Proventos por RNG no home | ✅ Fechado/rotulado | RNG removido de `provPerCotaMonth` (determinístico); card "Meus proventos" marcado "est.". |
| DY/Dividendos por ano por RNG | ✅ Rotulado | Chips "estimativa" nos cards do ativo; a **tabela** de proventos usa dado real quando há `ASSET_LIVE`. |

**Pré-requisito operacional (Vercel):** `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` nas env vars (sem elas, `/api/ai` fica *fail-closed* em 401). Opcional: `ALLOWED_ORIGINS` para domínios de preview.

## 6. Remediação — rodada 2 (robustez/segurança não-bloqueadora) · 2026-07-16 · commit `f91610c`

Aprovada por **finance → qa → review** (todos *LIBERAR/OK*).

| Item | Sev. orig. | Status | Como |
|---|---|---|---|
| CDN sem SRI (Chart.js/Font Awesome) | Alto | ✅ | **Auto-hospedados** em `vendor/` — sem CDN de terceiros para os assets sempre carregados. |
| Timeout em `refreshQuotes`/`loadMacroReal` | Médio | ✅ | Helper `fetchT` (AbortController): BCB/CoinGecko 8s, cotações 12s. |
| Fórmula do Score curado × ao vivo | Médio | ✅ | Função única `scoreOf` (solidez = ROE p/ ações, liquidez p/ FIIs; teto 100 com clamp). |
| Toast offline com erro cru | Baixo | ✅ | Mensagem amigável ("Sem conexão — exibindo dados de demonstração"). |
| `backdrop-filter` sem `-webkit-` (iOS) | Baixo | ✅ | Prefixo adicionado nos 6 scrims/splash. |

## 7. Remediação — rodada 3 (higiene/segurança leve) · 2026-07-16 · commit `e513abd`

| Item | Sev. orig. | Status |
|---|---|---|
| PDF.js em CDN (import por foto/PDF) | Alto (CDN JS) | ✅ Auto-hospedado em `vendor/pdfjs/` — todos os JS de terceiros agora locais |
| Cores fixas inline nos cards (contraste dark) | Baixo | ✅ Tokens (`var(--brand)`/`--gold` + `-l`) |
| Contagem de linhas defasada nas docs | Alto (integridade) | ✅ README/HANDOFF corrigidos (~11.600) + nota do `vendor/` |

**Pendente (dependem de infra/decisão de produto):**
- ~~**Dado real "de verdade"** para o gráfico de 7 dias~~ → **✅ FEITO** (§8): histórico real por snapshots diários; a série sintética saiu. Falta só **DY histórico por ano** (depende de fonte por data-com).
- **Entitlement server-side** (tabela de billing + webhook) para reativar o PRO.
- **Menores aceitos como risco baixo / opcionais:** ícones de cripto em CDN (jsdelivr — imagens SVG, sem execução de JS); `chartUnavail()` (mitigado por hospedar o Chart.js); 2FA real; fallback JS do scroll-lock (`:has()`, iOS <15.4); `setInterval` de tema (já faz early-return quando pref≠auto); renomear `document.js`/`documents.js`.

## 8. Remediação — rodada 4 (app funcional + sincronização real) · 2026-07-17/18

Foco: tirar o app do "modo demonstração", tornar os dados do usuário **reais/zerados** e
fazer a **sincronização entre aparelhos funcionar de verdade**. Cada mudança que toca
dinheiro passou por **finance → qa → review** (LIBERAR/OK/PASSOU).

| Item | Sev. orig. | Status | Como foi fechado |
|---|---|---|---|
| Gráfico de 7 dias (era estimativa rotulada, §5) | Crítico | ✅ Agora **REAL** | Snapshots diários de patrimônio (`lastro_pat_hist` + sync); a série sintética `wealthSpark7d` saiu do fluxo. Sem histórico, mostra **linha plana** no valor real de hoje; selo "N dias reais" / "medindo desde hoje". Removido o selo "estimativa · 7d". |
| App preso no "modo demonstração" | — | ✅ Fechado | Removida a carteira demo automática do painel e o botão "ver com exemplo". Sem aportes → tudo **zerado**. Dados fictícios **só no Modo desenvolvedor**. |
| Variação do dia fabricada c/ mercado fechado | — | ✅ Fechado | O "hoje" soma **só ativos com cotação REAL** (`a.live`); sem pregão → R$ 0,00. |
| Próximos proventos ignoravam a data-com | Médio (finance) | ✅ Fechado | Conta **só as cotas elegíveis na data-com** (usa data-com/dia reais quando o ativo foi carregado); rótulo distingue "data-com real" de estimativa; corrige também a conversão USD→BRL que faltava. |
| Data do aporte deslocava 1 dia (fuso) | — | ✅ Fechado | `fmtDateBR`/`todayISO`/proventos passam a usar **data LOCAL** (fim do off-by-one UTC). |
| Sincronização entre aparelhos não funcionava | Médio (frontend: `user_state`) | ✅ Fechado | **Causa-raiz:** o access_token do Supabase expirava (~1h) sem renovação → 401 "JWT expired", dados presos, e o outro aparelho sincronizava vazio (perda no logout). Agora: `refreshSession()`/`sbFetch` renovam o token (proativo no poll/foco + reativo em 401); RPC **`save_state`** carimba o `ts` no **servidor** (resolve clock-skew); **blindagens** impedem apagar carteira real com nuvem vazia e priorizam mutação local pendente; `authLogout` só apaga após confirmar a nuvem. Tudo **automático, sem botão**. Requer rodar `backend/supabase/schema.sql`. |
| Higiene de UI/UX | Baixo | ✅ | Cabeçalho sem "Mercado aberto"/"Ao vivo"; menu lateral **recolhível no desktop** com tooltip; refresh não repete o pré-login (só ao reabrir o navegador); **papel de parede premium** do pré-login; card de IA sem menção à marca do modelo; input da IA com texto sempre visível. |

**Ainda pendente (infra/decisão de produto):**
- **Entitlement server-side** (tabela de billing + webhook de pagamento) para reativar o PRO — o `save_state` já é server-side, mas o **plano** ainda não é validado no servidor.
- **2FA real** (hoje cosmético) + rodapé institucional (CNPJ/termos/LGPD).
- **Refactors de arquitetura** (God-objects `viewAlertas`/`viewAssinatura`; todo o JS num único `<script>`) — dívida técnica, **sem impacto de veracidade**.
- **DY histórico por ano** real (depende de fonte por data-com); `chartUnavail()` nos gráficos silenciosos; renomear `document.js`/`documents.js`.
- **Robustez do sync (Baixa, anotado):** `syncNow` pode reportar "ok" após falha silenciosa de GET; `fetch` de logout sem timeout; retry de token no `pagehide` pode não concluir (mitigado pela persistência de `_dirty`). Trade-offs by-design: não dá para esvaziar a carteira de forma sincronizada, e um aparelho `_dirty` vence a nuvem sem comparar `ts` (ambos erram para **preservar** dados).
