# Auditoria de segurança — back-end (jul/2026)

> Passe de segurança nos proxies serverless (`api/*`, `lib/*`), no schema Supabase e no
> entitlement. Feito no loop principal (subagentes indisponíveis por limite semanal). Onde há
> ação sua, o item aponta para `docs/plans/pendencias-manuais.md`.

## Resumo
Os proxies estão **bem endurecidos** no básico. O ponto aberto de maior impacto é a **falta de
rate-limiting** (abuso de cota paga da brapi/FMP). O entitlement passou a ser server-side, mas a
RPC provisória ainda é forjável (esperado até haver gateway). Nada de segredo vaza ao cliente.

## O que está OK (verificado)
- **SSRF:** `api/document.js` só aceita `https://www.rad.cvm.gov.br/…` (regex ancorada exige a
  barra após `br` → rejeita `…br.evil.com`). CVM sem token.
- **Sem vazamento de segredo:** `BRAPI_TOKEN`/`FMP_KEY` entram só em URLs upstream, sempre com
  `encodeURIComponent`; **nunca** são retornados ao cliente nem logados. Erros ao cliente são
  genéricos (`erro interno`, arrays vazios); o detalhe (`e.message`) vai só para `console`/logger.
- **Caps de entrada:** todos os proxies limitam o lote (`slice(0,50/60)`) → sem batch gigante.
- **Injeção de parâmetro:** `range`/`interval`/`fn` por whitelist; símbolos escapados.
- **`config.js`** expõe só valores públicos (SUPABASE_URL/ANON_KEY, endpoints) — sem segredo.
- **RLS Supabase:** `user_state` e `user_entitlement` só a própria linha; `news`/`meta` leitura
  pública; `user_entitlement` **sem** policy de escrita para `authenticated`.

## Achados (por severidade)

### 🟠 Média — sem rate-limiting nos proxies (abuso de cota)
`/api/quotes|market|us|...` não têm limite por IP/sessão. Um terceiro pode disparar chamadas e
**queimar a cota paga** da brapi Pro/FMP (custo real) ou degradar o serviço. Mitigado em parte
pelo cache de borda (`s-maxage`) para chaves repetidas, mas não para chaves variadas.
**Correção recomendada (infra, precisa de você):** rate-limit por IP no Edge (Vercel) ou via
Upstash/KV. Como estamos em **11/12 funções**, um middleware de Edge (`middleware.ts`, não conta
no limite de funções) é o caminho — a implementar com review/teste. → anota em `docs/plans/pendencias-manuais.md`.

### 🟡 Baixa — entitlement provisório é forjável pela RPC
`grant_entitlement` é `security definer` chamável por qualquer autenticado (checkout **simulado**).
A **verdade já mora no servidor** e sobrevive ao logout — o objetivo desta fase. **Fecha quando**
entrar o gateway real: remover a RPC e deixar a escrita só para o **webhook** (`service_role`).
Já documentado no `schema.sql`.

### 🟡 Baixa — `document.js` segue redirects do upstream
`fetch(u)` segue redirects (default). CVM é confiável, mas um redirect para outro host seria
seguido. Baixíssimo risco. **Opcional:** validar o host do destino final. Não alterado (evitar
quebrar o download legítimo da CVM sem poder testar).

### 🟢 Informativo — CORS
Os proxies não setam `Access-Control-Allow-Origin` → o navegador bloqueia uso cross-origin (só o
próprio app consome). Server-to-server não é bloqueado (aceitável para dados públicos).

## Próximos passos sugeridos (quando a review voltar — 25/jul)
1. `lastro-review` audita o **entitlement** (mudança de auth publicada sem review dedicada).
2. Implementar **rate-limit** por Edge middleware + teste.
3. (Opcional) headers de segurança (`X-Content-Type-Options: nosniff`) nas respostas dos proxies.
