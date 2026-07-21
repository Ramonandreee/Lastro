# Auditoria de Backend — Padrão Corporativo (Lastro)

> Data: jul/2026 · Escopo: `api/*`, `lib/*`, `backend/*`, `backend/supabase/schema.sql`, `vercel.json`, `sw.js`, camada de sync no `index.html`.
> Método: leitura direta do código (nada inferido sem evidência). Severidades: **Crítico / Alto / Médio / Baixo**.

---

## 1. Resumo executivo

O Lastro é uma **SPA single-file** (`index.html`) servida pela Vercel, com **12 Serverless Functions** (`api/*`) que funcionam como **proxies de dados públicos** (brapi Pro, FMP, CoinGecko, CVM, Yahoo/Stooq, Anthropic), **Supabase** (Auth + Postgres/PostgREST) para autenticação e sincronização de estado do usuário, e um **coletor de notícias** em GitHub Actions (cron ~20 min).

O sistema é **funcional e pragmático**, com boas decisões pontuais (segredos só no servidor, RLS por usuário, carimbo de tempo no servidor via RPC `save_state`, `/api/ai` autenticado com CORS+rate-limit+timeout, fail-safe nos proxies). Porém, **não está no nível de uma fintech em produção** em cinco eixos que exigem atenção antes de escalar para milhares de usuários:

1. **Entitlement (plano PRO) é só client-side** → paywall contornável. *(Crítico)*
2. **Cálculos financeiros em ponto flutuante** no cliente, sem módulo monetário testado. *(Crítico)*
3. **Zero testes automatizados** — dinheiro validado só por checagem manual de sintaxe. *(Crítico)*
4. **Rate limiting e observabilidade insuficientes** para produção. *(Alto)*
5. **Lacunas de LGPD/governança** (consentimento, retenção, exportação/exclusão self-service, trilha de auditoria). *(Médio)*

Nenhum problema **destrutivo** foi encontrado; os riscos são de **receita, precisão financeira, resiliência e conformidade**. As correções abaixo priorizam **menor risco / maior benefício**.

---

## 2. Inventário da arquitetura

### 2.1 Componentes (confirmados no código)

| Camada | Artefato | Responsabilidade | Externos |
|---|---|---|---|
| Front | `index.html` (~13k linhas) | UI + regras de negócio financeiras + acesso a dados | — |
| Config | `api/config.js` | Injeta config **pública** (`SUPABASE_URL/ANON_KEY`, endpoints) em `window.LASTRO_CONFIG` | env Vercel |
| Cotações B3 | `api/quotes.js` | Preço/variação em lote (brapi) + cripto (CoinGecko simple) | brapi Pro, CoinGecko |
| Universo B3 | `api/universe.js` | Lista ações/FIIs/BDRs (brapi list) | brapi Pro |
| Ativo B3 | `api/asset.js` | Detalhe: histórico, DRE/balanço, dividendos, perfil | brapi Pro |
| Fundamentos | `api/fundamentals.js` | Indicadores em lote | brapi Pro |
| FII (CVM) | `api/fii.js` | VP/cota, P/VP, vacância (Informe Mensal) | CVM |
| Fundos (CVM) | `api/fundinfo.js` | Taxa adm. + patrimônio de ETFs (cad_fi) | CVM |
| Documentos | `api/documents.js`, `api/document.js` | Fatos relevantes/IPE (CVM) | CVM |
| EUA/Cripto | `api/market.js` → `lib/{crypto,usuniverse,usdetail,history}.js` | Despachante único (`?fn=`) p/ caber no limite de 12 funções | FMP, CoinGecko, Yahoo, Stooq |
| Cotação EUA | `api/us.js` | Preço EUA (FMP→Yahoo→Stooq) | FMP, Yahoo, Stooq |
| IA | `api/ai.js` | Proxy Anthropic **autenticado** | Anthropic |
| Auth/Sync | Supabase (`user_state`, RPC `save_state`) | JWT + estado por usuário (RLS) | Supabase |
| Notícias | `backend/scripts/fetch-news.mjs` (GitHub Actions `news.yml`) | RSS → filtro relevância → Supabase (`news`/`meta`) + resumo IA | RSS, Anthropic, Supabase (service key) |

### 2.2 Banco de dados (`schema.sql`)

- **3 tabelas**: `news` (índices em `published_at`, `tag`; unique em `hash`), `meta` (kv), `user_state` (PK `user_id` → `auth.users`, `data jsonb`, `on delete cascade`).
- **RLS** habilitado em todas. `news`/`meta`: leitura pública, escrita só `service_role`. `user_state`: cada usuário só a própria linha (select/insert/update).
- **RPC** `save_state(jsonb)`: `security invoker`, exige `auth.uid()`, carimba `ts` com `clock_timestamp()` do banco (resolve clock-skew), upsert. `grant execute` a `authenticated`.

### 2.3 Diagrama textual (arquitetura atual)

```
                    ┌───────────────────────── Vercel Edge/CDN (gru1) ─────────────────────────┐
[Browser SPA]──────▶│  /                → index.html (must-revalidate)                          │
 index.html         │  /config.js       → api/config  (env pública → window.LASTRO_CONFIG)     │
   │                │  /api/quotes      → brapi Pro + CoinGecko                                │
   │  (dados)       │  /api/universe    → brapi list                                           │
   │───────────────▶│  /api/asset       → brapi (histórico/DRE/dividendos)                     │
   │                │  /api/fundamentals→ brapi                                                │
   │                │  /api/fii         → CVM (Informe FII)                                     │
   │                │  /api/fundinfo    → CVM (cad_fi)                                          │
   │                │  /api/documents   → CVM (IPE)                                             │
   │                │  /api/us          → FMP → Yahoo → Stooq                                   │
   │                │  /api/market?fn=  → lib/{crypto,usuniverse,usdetail,history}             │
   │  (IA, JWT)     │  /api/ai          → Anthropic  (auth + CORS + rate-limit + timeout)      │
   │                └──────────────────────────────────────────────────────────────────────────┘
   │  (auth JWT + refresh)      ┌──────────── Supabase ────────────┐
   ├───────────────────────────▶│ Auth (/auth/v1)                  │
   │  (sync: rpc/save_state,    │ user_state (jsonb, RLS por user) │
   │        select user_state)  │ news / meta (RLS leitura pública)│
   └───────────────────────────▶└──────────────────────────────────┘
                                          ▲ (service_key)
                    [GitHub Actions cron news.yml ~20min] ── backend/fetch-news.mjs ── RSS + Anthropic
```

### 2.4 Filas / workers / cron / cache (confirmado)

- **Cron**: 1 — GitHub Actions `news.yml` (~20 min).
- **Filas/workers**: nenhuma (arquitetura request/response + edge cache).
- **Cache**: **borda da Vercel** via `Cache-Control s-maxage` (quotes 10min, universe 15min, history/detail 1–6h, crypto 2min, fundinfo 24h) + **localStorage** no cliente (carteira, `patHist`, `HIST_CLOSE`).
- **Jobs**: coleta e limpeza de notícias, resumo IA do dia.

---

## 3. Problemas por criticidade (com evidência)

### 🔴 Crítico

**C1 — Entitlement (plano PRO) apenas no cliente.**
Evidência: `index.html` (`isPro()`, `refreshPlanUI`, `setPlan`) decide PRO localmente; `loadCloudState` **não** lê `d.plan` do blob ("*Fonte de verdade do plano = billing server-side (a implementar). Deny-by-default.*"). O único recurso PRO com barreira de servidor é `/api/ai` (exige JWT, não plano). Ou seja, **qualquer usuário vira PRO** editando `localStorage`/JS.
Impacto técnico: bypass de paywall. Impacto no cliente: injusto com pagantes; perda de receita para o negócio.

**C2 — Cálculos financeiros em ponto flutuante (float64).** *(corrigido — ver §5)*
Evidência (à época): `portfolioByTicker`/`portfolioStats` somavam posições em `Number`; centenas de posições acumulavam erro de arredondamento em **dinheiro**.
**Status:** `vendor/money.js` (centavos inteiros, sem dependência) + migração de `portfolioByTicker`/`portfolioStats` — cada posição fecha em centavos (arredonda 1x na conversão BRL) e o agregado soma **inteiros** (exato, sem drift). Equivalência old×new verificada como **exata** (0 divergências em 200 mil casos, inclusive câmbio US$). **Lacuna:** `wealthSeries`/gráfico ainda em float (funções co-editadas pelos donos — etapa separada).

**C3 — Ausência total de testes automatizados.** *(parcialmente endereçado — ver §5)*
Evidência: (à época) nenhum arquivo de teste; a única "validação" era a checagem manual de chaves CSS/sintaxe JS. Regras financeiras (variação do dia, reconstrução histórica, preço médio, proventos) mudaram várias vezes sem cobertura.
Impacto: regressões silenciosas em dinheiro. Impacto no cliente: bugs de saldo/rentabilidade chegando à produção.
**Status:** criada suíte de unidade do backend (`test/*.mjs`, runner nativo, 14 testes) + CI (`.github/workflows/test.yml`). **Lacuna remanescente:** a matemática de carteira vive no `index.html` (não importável) — precisa ser extraída para um módulo puro para ser coberta.

### 🟠 Alto

**A1 — Rate limiting durável ausente nos proxies públicos.**
Evidência: só `api/ai.js` tem rate-limit, e é **in-memory** (`const hits = new Map()`), por instância serverless — não compartilhado. `quotes/universe/asset/us/market/...` são **abertos, sem auth e sem limite**. Mitigação parcial: edge cache.
Impacto: abuso/custo (esgotar cota brapi/FMP, "DoS de custo"), degradação para todos. Impacto no cliente: lentidão/indisponibilidade de cotações.

**A2 — Observabilidade mínima.**
Evidência: apenas `console.log/console.error`. Sem logs estruturados, correlation IDs, métricas, tracing, health/readiness/liveness, dashboards ou alertas.
Impacto: MTTR alto; incidentes difíceis de diagnosticar. Impacto no cliente: falhas demoram a ser detectadas e corrigidas.

**A3 — Integridade do estado do usuário não validada no servidor.**
Evidência: `save_state(p_data jsonb)` grava o blob **como veio** (só carimba `ts`). RLS garante a linha, não o **conteúdo**. Um cliente bugado/adulterado grava carteira inconsistente.
Impacto: dados financeiros corrompidos sem validação. Impacto no cliente: carteira "quebrada" sincronizada entre aparelhos.

**A4 — `SUPABASE_SERVICE_KEY` (root do banco) no coletor de notícias.**
Evidência: `fetch-news.mjs` usa `SERVICE_KEY` (ignora RLS) via secret do GitHub Actions. Correto ficar server-side, mas é a chave mais poderosa; sem rotação/escopo definidos é risco alto se vazar.
Impacto: vazamento = acesso total ao banco. Impacto no cliente: exposição de todos os dados.

**A5 — Modelos de IA possivelmente depreciados.**
Evidência: `api/ai.js` `MODELS = {'claude-sonnet-4-6','claude-3-5-sonnet-latest','claude-3-5-haiku-latest'}` e `fetch-news.mjs` usa `'claude-sonnet-4-6'`. Podem estar fora de suporte.
Impacto: IA/resumo do dia falham silenciosamente. Impacto no cliente: recurso PRO indisponível sem aviso.

### 🟡 Médio

**M1 — Vazamento de detalhes de erro.** `api/universe.js` e `api/quotes.js` retornam `detail: e.message`; `api/documents.js` retorna `diag` com URLs/status internos. Info disclosure de baixo impacto. **→ corrigido nesta auditoria (§5).**

**M2 — Lacunas de LGPD** (ver §7). Dados pessoais (nome, telefone/WhatsApp, UF, cidade) no `user_state.data.profile` sem consentimento explícito, retenção, exportação/exclusão self-service ou trilha de auditoria.

**M3 — Sem versionamento de API.** `/api/*` sem `/v1`. Cache do app + mudança de contrato pode quebrar clientes.

**M4 — Monólito de front com regras de negócio.** `index.html` mistura UI, matemática financeira e acesso a dados → baixa testabilidade (relacionado a C3).

**M5 — Rate-limit do `ai.js` ineficaz em escala** (Map por instância). Precisa de store compartilhado (Vercel KV/Upstash).

**M6 — CORS só no `ai.js`.** Demais proxies não restringem origem (dados públicos, mas permitem hotlinking/abuso de custo por terceiros).

### 🟢 Baixo

- **B1** `diag` com URLs internas da CVM (`documents.js`).
- **B2** Possível sobreposição `documents.js` × `document.js` (revisar consolidação).
- **B3** Sem endpoint de health (`/api/health`).
- **B4** Precisão numérica no banco: se algum dia normalizar carteira, usar `numeric(p,s)` — nunca float.
- **B5** `news.yml` a cada ~20 min — validar limites de Actions/CVM/RSS.

---

## 4. Evidências (arquivo · função · contexto) — índice rápido

| ID | Arquivo | Função/Trecho |
|---|---|---|
| C1 | `index.html` / `schema.sql` | `isPro`/`refreshPlanUI`; `loadCloudState` (não lê `d.plan`); `api/ai.js` só exige JWT |
| C2 | `index.html` | `portfolioByTicker`, `portfolioStats`, `portfolioDayVar`, `wealthSeries` |
| C3 | (repo) | inexistência de testes |
| A1 | `api/ai.js:19,57-60`; demais `api/*` | `hits=new Map()`; proxies sem auth |
| A2 | todos `api/*`, `lib/*` | só `console.*` |
| A3 | `schema.sql:73-93` | `save_state` grava jsonb sem validar conteúdo |
| A4 | `fetch-news.mjs:25,125-133` | `SERVICE_KEY` |
| A5 | `api/ai.js:18`; `fetch-news.mjs:184` | modelos |
| M1 | `api/universe.js:60`, `api/quotes.js`, `api/documents.js:120-127` | `detail`/`diag` |

---

## 5. Correções implementadas nesta auditoria

**Sanitização de erros (M1/B1) — 100% dos endpoints** — remoção de detalhes internos (mensagens de exceção e URLs) das respostas de erro ao cliente. Baixíssimo risco (o front já trata erro como fail-safe e ignora o corpo). Arquivos: `universe`, `quotes`, `documents`, `asset`, `fii`, `fundamentals`, `fundinfo`, `us` + `lib/{crypto,history,usdetail,usuniverse}`.

**Observabilidade (A2/B3)** — `lib/log.js` (logger JSON estruturado + `withObs()`); health/readiness em `/api/market?fn=health`; `withObs()` aplicado nos 12 endpoints (request-id `x-request-id` + log `done/erro` com `ep/status/ms`).

**Testes de unidade (C3, parcial)** — `test/*.mjs` com o runner nativo (`node:test`, sem dependências): 14 testes cobrindo o matcher/parse da CVM (`matchOne`/`parseNum` — correção de dado financeiro), datas/dedupe do histórico e o mapeamento de mercado (`pct`/`mapOne`). CI em `.github/workflows/test.yml` (roda testes + `node --check` a cada push/PR). Funções puras exportadas de `api/fundinfo.js`, `lib/history.js`, `lib/crypto.js`, `lib/usdetail.js`.

> As demais correções (C1–C3, A1–A5) são mudanças estruturais que **exigem decisão de produto e implementação faseada** (billing, módulo monetário, suíte de testes, KV, observabilidade). Alterá-las às cegas num app financeiro em produção seria arriscado — estão no plano de evolução (§7).

---

## 6. Melhorias recomendadas (resumo)

1. **Entitlement server-side**: tabela `subscriptions` (RLS: usuário lê a própria; escrita só via webhook de billing/`service_role`); gate de recursos PRO no servidor (ex.: `/api/ai` e futuros endpoints premium checam plano, não só JWT).
2. **Módulo monetário testado**: dinheiro em **centavos inteiros** (ou `decimal.js`), arredondamento bancário explícito, cobertura unitária. Extrair a matemática de carteira do `index.html` para um módulo puro e testável.
3. **Rate limiting durável** (Vercel KV/Upstash) por IP e por usuário nos proxies; caching de borda mantido.
4. **Observabilidade**: logs JSON estruturados com `request-id`, `/api/health`, métricas (latência/erro/cache-hit por upstream), tracing (OpenTelemetry/Vercel).
5. **Validação do estado no servidor**: JSON Schema para `user_state.data`; sanity checks no `save_state` (rejeitar payloads inválidos, limitar tamanho).
6. **Versionamento e contrato de API**: `/api/v1`, envelope de erro padrão `{error, code}`, sem `detail`; paginação/idempotência documentadas.
7. **LGPD**: consentimento no cadastro, política de retenção, exportação e exclusão self-service, `audit_log`.
8. **Suíte de testes**: unit (finance), contrato (shapes das APIs), e2e (login/aporte/sync), carga (proxies).

---

## 7. Plano de evolução

**Curto prazo (1–2 semanas)** — baixo risco, alto valor
- [x] Sanitizar erros (§5).
- [x] `/api/health` (readiness + upstreams configurados) via dispatcher `/api/market?fn=health` (sem criar função nova — respeita o teto de 12).
- [x] Logger JSON estruturado com `request-id` (`lib/log.js`): `withObs()` aplicado em **TODOS os 12 endpoints** (`api/market.js` + os 11 proxies) → header `x-request-id` + log `done/erro` com `ep/status/ms` uniformes.
- [ ] Rate limit durável (Vercel KV) nos proxies mais custosos (`quotes`, `universe`, `us`, `market`, `ai`).
- [ ] Atualizar modelos de IA (`ai.js`, `fetch-news.mjs`) e validar disponibilidade.
- [ ] Consentimento LGPD + política de privacidade no cadastro.

**Médio prazo (1–2 meses)**
- [ ] Extrair matemática financeira para módulo puro em **centavos** + suíte de testes unitários.
- [ ] Entitlement server-side (tabela `subscriptions` + gates).
- [ ] Validação de `user_state` no `save_state` (JSON Schema + limites).
- [ ] Exportação/exclusão de dados self-service (LGPD) + `audit_log`.
- [ ] Testes de contrato e e2e dos fluxos críticos.

**Longo prazo (trimestre+)**
- [ ] Versionamento `/api/v1`; separar proxies por domínio; considerar app router/edge functions.
- [ ] Normalizar dados críticos (posições) em tabelas com `numeric`, mantendo o jsonb como cache.
- [ ] Tracing distribuído + dashboards + alertas (SLO de latência/erro).
- [ ] Rotação automatizada de segredos e escopo mínimo por chave.

---

## 8. Checklist de segurança

| Item | Estado | Nota |
|---|---|---|
| Segredos só no servidor | ✅ | `BRAPI_TOKEN`, `FMP_KEY`, `ANTHROPIC_API_KEY`, `SERVICE_KEY` em env; anon key pública por design |
| RLS por usuário | ✅ | `user_state` select/insert/update own |
| JWT + refresh | ✅ | client `sbFetch`/refresh; `save_state` exige `auth.uid()` |
| Hash de senha | ✅ (delegado) | Supabase Auth (bcrypt) — não gerimos senha |
| Autorização por recurso (RBAC/plano) | ❌ | Entitlement client-side (C1) |
| Rate limiting | ⚠️ | Só `ai.js`, in-memory (A1/M5) |
| Validação/sanitização de entrada | ⚠️ | Proxies limitam/`encodeURIComponent`; `save_state` não valida conteúdo (A3) |
| SQLi | ✅ | Sem SQL dinâmico; PostgREST parametrizado |
| XSS | ✅ (majoritário) | `esc()` nos campos externos; auditado nesta sessão |
| CSRF | ✅ | APIs stateless com Bearer token (não cookies de sessão) |
| SSRF | ✅ | Hosts fixos; segmentos de usuário via `encodeURIComponent`; `year` server-side |
| Path traversal / cmd injection | ✅ | Sem FS/exec com input do usuário |
| CORS | ⚠️ | Só `ai.js` (M6) |
| Logs sem dados sensíveis | ✅ | Sem PII em logs |
| Vazamento de erro | ✅ | `detail`/`diag` removidos de TODOS os endpoints (M1) |

## 9. Checklist de LGPD

| Item | Estado |
|---|---|
| Inventário de dados pessoais (nome, telefone, UF, cidade) | ⚠️ (existe, sem registro formal) |
| Base legal / consentimento | ❌ |
| Minimização | ⚠️ (coleta telefone/WhatsApp no cadastro) |
| Retenção definida | ❌ |
| Exclusão (RTBF) self-service | ⚠️ (cascade ao deletar conta; sem fluxo self-service) |
| Portabilidade/exportação | ❌ (há export CSV da carteira; não dos dados pessoais) |
| Anonimização | ❌ |
| Trilha de auditoria | ❌ |
| Controle de acesso | ✅ (RLS) |
| Segregação de funções | ⚠️ |

## 10. Checklist de governança de dados

| Item | Estado |
|---|---|
| Classificação (pessoal/sensível/financeiro/público/interno) | ⚠️ (informal — ver §2) |
| Fonte de verdade por domínio | ⚠️ (cotações = terceiros; carteira = jsonb do cliente) |
| Validação de integridade | ❌ (A3) |
| Versionamento de schema/migrações | ⚠️ (`schema.sql` único, sem tooling de migração) |
| Precisão de tipos numéricos | ❌ (float no cliente; jsonb no banco) |
| Catálogo/dicionário de dados | ❌ |

## 11. Checklist de desempenho

| Item | Estado |
|---|---|
| Cache de borda | ✅ (`s-maxage` por endpoint) |
| Cache local (offline-friendly) | ✅ (localStorage) |
| Batching de cotações | ✅ (`quotes` em lotes) |
| N+1 no banco | ✅ (uso mínimo do DB) |
| Consultas lentas | ✅ (sem queries complexas) |
| Pool de conexões | ✅ (via PostgREST/HTTP) |
| Compressão | ✅ (Vercel gzip/br) |
| Processamento assíncrono | ⚠️ (notícias via cron; resto síncrono) |

## 12. Checklist de escalabilidade

| Item | Estado |
|---|---|
| Auto-scaling | ✅ (serverless) |
| Statelessness | ✅ (exceto rate-limit in-memory do `ai.js`) |
| Limite de funções (plano) | ⚠️ (12 funções — já no teto; `api/market` consolidou) |
| Dependência de cota de terceiros | ⚠️ (brapi/FMP — mitigado por cache; sem rate limit próprio) |
| Idempotência | ✅ (`save_state` upsert; news upsert `on_conflict`) |
| Store compartilhado p/ limites | ❌ (M5) |

## 13. Checklist de observabilidade

| Item | Estado |
|---|---|
| Logs estruturados | ✅ (JSON via `lib/log.js` `withObs()` nos 12 endpoints) |
| Correlation IDs | ✅ (`x-request-id` + `rid` em todos os endpoints) |
| Métricas | ⚠️ (latência/status por request no log; sem agregador ainda) |
| Tracing | ❌ |
| Health/readiness/liveness | ✅ (`/api/market?fn=health` com upstreams) |
| Dashboards/alertas | ⚠️ (só painel Vercel básico) |

## 14. Riscos remanescentes e mitigação

| Risco | Severidade | Mitigação proposta |
|---|---|---|
| Bypass de paywall (C1) | Alta | Entitlement server-side (billing table + gates) |
| Erro de centavos em dinheiro (C2) | Alta | Módulo monetário em centavos + testes |
| Regressão financeira sem teste (C3) | Alta | Suíte unit/contrato/e2e |
| Abuso/custo em proxies (A1) | Alta | Rate limit durável (KV) + CORS |
| Incidente difícil de diagnosticar (A2) | Média | Logs estruturados + health + tracing |
| Carteira corrompida no sync (A3) | Média | Validação no `save_state` |
| Vazamento de `SERVICE_KEY` (A4) | Média | Rotação + escopo + auditoria de secrets |
| Não conformidade LGPD (M2) | Média | Consentimento, retenção, RTBF, auditoria |

---

### Nota de método
Auditoria baseada na **leitura direta do repositório**. Como brapi/FMP/CVM são geobloqueados no ambiente de auditoria, o comportamento em produção desses upstreams não foi exercitado ao vivo — as observações são sobre **código e contrato**, não sobre latência real medida.
