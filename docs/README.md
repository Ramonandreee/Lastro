# `docs/` — índice

Porta de entrada da documentação técnica do Lastro. O contexto do dia a dia está na
raiz (`README.md` = arquitetura, `HANDOFF.md` = estado atual, `CLAUDE.md` = governança).
Aqui ficam os documentos longos: **planos** do que ainda vai ser feito, **specs** do que
já foi desenhado/construído e **auditorias** (fotografia de um momento).

## Convenção de nomes

`docs/<categoria>/<assunto-em-kebab-case>.md` — tudo minúsculo, sem prefixo em caixa-alta
(a categoria já vem da subpasta).

| Categoria | O que entra | Data no nome? |
|---|---|---|
| `plans/` | Plano faseado de algo a construir; lista viva de pendências. | Não — é documento vivo, atualizado no lugar. |
| `specs/` | Especificação de uma feature (comportamento, UI, modelo de dados). | Não — segue a feature enquanto ela existir. |
| `audits/` | Auditoria/revisão de um escopo numa data. | **Sim** (`-AAAA-MM`) — é fotografia, não se reescreve. |

## Planos — `docs/plans/`

| Arquivo | O que é | Status | Quando ler |
|---|---|---|---|
| [`plans/sync-tempo-real.md`](plans/sync-tempo-real.md) | Redesenho da sincronização: merge por união de `MOVS` com tombstones, CAS por `rev`, Realtime — no lugar do blob único com last-write-wins. | **Ativo** (Fase 0 em andamento) | **Antes de mexer em qualquer coisa de sync**, `user_state` ou persistência entre aparelhos. |
| [`plans/livro-movimentacoes.md`](plans/livro-movimentacoes.md) | Plano faseado do extrato tipo corretora: `MOVS` como fonte de verdade de eventos e `CARTEIRA` como projeção derivada (`deriveState`). | **Ativo, parcialmente construído** (núcleo `MOVS` já no ar; fases de UI pendentes) | Antes de tocar em `CARTEIRA`/`MOVS`, venda, provento-caixa, saldo em caixa ou evento societário. |
| [`plans/pendencias-manuais.md`](plans/pendencias-manuais.md) | Lista viva do que só Ramon/Mikael conseguem fazer fora do código (Supabase, Vercel, GitHub, chaves). | **Ativo** — atualizar a cada mudança que exija ação humana | Ao terminar algo que depende de setup manual, e antes de perguntar "por que isso não funciona em produção?". |

## Specs — `docs/specs/`

| Arquivo | O que é | Status | Quando ler |
|---|---|---|---|
| [`specs/carteiras-instituicoes.md`](specs/carteiras-instituicoes.md) | Agregador de carteiras públicas de instituições (BTG, XP…): modelo de dados, importação só da composição publicada, desempenho calculado em casa. Substitui a antiga "Carteiras Recomendadas". | **Construída, sem dados publicados** (ago/2026) | Antes de mexer na tela de carteiras de instituições ou de importar composição de terceiros. |
| [`specs/tab-bar-mobile.md`](specs/tab-bar-mobile.md) | Handoff do Estúdio de Design para a barra de navegação inferior mobile: objetivo, decisões travadas, comportamento, acessibilidade. | **Construída** — spec de referência | Antes de alterar a navegação mobile (`#tabbar`), o Hub Mercado ou o painel "Mais". |
| [`specs/ui-sistema-tab-bar.md`](specs/ui-sistema-tab-bar.md) | O detalhe visual da spec acima: tokens, cores, tipografia, estados das 3 superfícies (tab bar, Hub Mercado, painel "Mais"). Estende o `:root`/`[data-theme="dark"]` existente. | **Construída** — spec de referência | Junto com `tab-bar-mobile.md`, quando precisar do valor exato de cor/espaçamento/estado. |

## Auditorias — `docs/audits/`

Documentos históricos: descrevem o código **na data indicada**. Não são reescritos —
o que foi remediado depois está no `HANDOFF.md`.

| Arquivo | O que é | Status | Quando ler |
|---|---|---|---|
| [`audits/dados-acoes-2026-08.md`](audits/dados-acoes-2026-08.md) | Veracidade dos dados das 31 ações curadas: de onde vem cada número em cada tela e o que aparece quando a fonte falha. | Histórico (ago/2026) | Antes de confiar num indicador de ação, ou ao investigar "esse número é real?". |
| [`audits/seguranca-2026-07.md`](audits/seguranca-2026-07.md) | Passe de segurança nos proxies `api/*`/`lib/*`, schema Supabase e entitlement (SSRF, rate-limiting, segredos). | Histórico (jul/2026) — pendências em `plans/pendencias-manuais.md` | Antes de criar/alterar um proxy serverless ou mexer em RLS/entitlement. |
| [`audits/backend-enterprise-2026-07.md`](audits/backend-enterprise-2026-07.md) | Auditoria do backend contra padrão corporativo: 5 eixos que separam o app atual de uma fintech em produção (entitlement client-side, observabilidade, etc.). | Histórico (jul/2026) | Antes de escalar o backend ou revisar arquitetura de `api/*`, Supabase e coletor. |
| [`audits/lastro-2026-07-16.md`](audits/lastro-2026-07-16.md) | Auditoria completa multi-agente do projeto inteiro (frontend, backend, finanças, QA). Os 4 Críticos já foram remediados — ver a atualização no topo do próprio doc. | Histórico fechado (jul/2026) | Como panorama de dívida técnica e de decisões antigas; **não** como estado atual. |
