# Pendências manuais — Lastro (fazer de uma vez)

> Lista viva de tudo que **só você (Ramon/Mikael)** consegue fazer — coisas fora do código
> (Supabase, Vercel, painel do GitHub, dados da sua conta). O Claude atualiza este arquivo a
> cada mudança que exigir uma ação sua. **Marque `[x]` conforme for concluindo.**

Última atualização: 2026-07 (sessão back-end/segurança).

---

## 🔴 Obrigatório para ativar o que já foi publicado

- [ ] **Supabase — rodar o `backend/supabase/schema.sql` atualizado** (SQL Editor → colar tudo → Run).
      É **idempotente** (pode rodar por cima do que já existe). Cria:
      - tabela **`user_entitlement`** (plano/assinatura server-side, só leitura pelo dono);
      - RPC **`grant_entitlement`** (checkout simulado provisório).
      **Por quê:** ativa a *persistência do Premium* (não some mais no relogin) e fecha a brecha de
      o plano ser forjável no `localStorage`. **Enquanto não rodar, o app funciona como antes**
      (cai no cache local) — não quebra nada, só não persiste o plano ainda.

## 🔴 `FMP_KEY` na Vercel — Stocks (EUA) e ETFs internacionais estão degradados

- [ ] **Configurar `FMP_KEY`** (Vercel → Environment Variables, Production + Preview) e redeploy.
      **Sintoma:** o hub Mercado mostra **Stocks (EUA) 16** e **ETFs internacionais 12** — exatamente
      o tamanho das listas curadas. O universo remoto (~300 ações + ~250 ETFs) não chega porque
      `lib/usuniverse.js` responde `{stocks:[],etfs:[],note:'FMP_KEY ausente'}` (HTTP 200, falha
      silenciosa) quando a chave não existe.
      **A mesma chave alimenta:** `/api/us` (P/L e valor de mercado), `lib/usdetail.js` (página do
      ativo dos EUA) e `lib/history.js` (histórico EUA + **câmbio USDBRL** do backtest) — tudo isso
      está degradado hoje.
      **Como conferir (no navegador, sem segredo exposto):**
      `https://lastro-dun.vercel.app/api/market?fn=health` → esperar `upstreams.fmp: true`.
      Depois: `…/api/market?fn=usuniverse` → deve vir com arrays cheios, não com `note`.

- [ ] **Fonte oficial da lista de ETFs da B3** (decisão): para completar os ~90-100 ETFs listados,
      escolher a fonte (arquivo de ETFs listados da B3 ou cadastro CVM) — o time preenche a partir
      dela. Hoje há 47 candidatos B3 no código; ETFs não confirmados pela brapi ficam invisíveis
      (nunca aparece ativo inexistente).

## 🟠 Carteiras Recomendadas — aposentada; o que decidir antes de retomar

> **Situação em ago/2026:** o agregador que a substitui **já está construído e no ar**
> (telas + validador). O que segura a publicação é o **`data/carteiras.json` estar vazio** —
> preencher o arquivo publica a feature. Portanto as decisões abaixo continuam valendo, só
> que agora o portão é o arquivo de dados, não o código.

A tela antiga foi **removida do app (ago/2026)** por dois motivos: era recomendação de valores
mobiliários sem CNPI (atividade privativa de analista, CVM) e exibia rentabilidade
**fabricada** (`ret`/`dy`/`vol` chumbados no código). A retomada desejada é um **agregador
de carteiras públicas de instituições** (BTG, XP, etc.). Antes de construir, três coisas
precisam estar resolvidas — nenhuma é técnica:

- [ ] **Fonte de dados.** Não existe API pública dessas carteiras. Saem em **PDF/relatório
      mensal**, boa parte só para clientes logados. Definir de onde vem (e se é acessível
      sem login).
- [ ] **Direito de uso.** A composição (ativos + pesos) é o miolo do relatório de análise
      da instituição. Republicar costuma ferir os termos de uso. O caminho defensável é
      **nome da instituição + data de publicação + LINK para o relatório original**, sem
      reproduzir a análise. Vale checar programas de parceria/afiliados, que já resolvem
      a permissão. **Recomendo validar com o jurídico antes de publicar.**
- [ ] **Expectativa de atualização.** A composição muda **mensalmente**, não em tempo real.
      O que dá para atualizar ao vivo é a **cotação dos ativos** que compõem cada carteira —
      e aí o desempenho passa a ser calculado de dado real, nunca chumbado.
      **Definir quem alimenta** `/data/carteiras.json` todo mês (fluxo de 3–5 min por carteira
      descrito na spec).

> **A spec técnica já existe:** `docs/SPEC-carteiras-instituicoes.md` (ago/2026) — modelo de
> dados, derivações função por função, telas, textos de disclaimer, gate e plano faseado.
> Ela mostra a **composição** (ativos + pesos), então depende da validação de **direito de uso**
> acima. **Não construir/publicar antes do jurídico.** Fase 0 do plano = as decisões desta lista.

## 🟡 Limpeza recomendada (não urgente)

- [ ] **Vercel — remover a variável de ambiente `ANTHROPIC_API_KEY`** (Project Settings →
      Environment Variables). A IA foi removida do projeto; a chave não é mais usada.
- [ ] **Supabase — conferir se existem tabelas órfãs** `rate_limits` / `subscriptions` de
      experimentos antigos e, se existirem e estiverem sem uso, **dropar**. (Os SQLs que as criavam
      foram removidos do repo; provavelmente nem chegaram a ser criadas.)

## 🟢 Conferências rápidas (provável que já esteja OK)

- [ ] **Vercel — Production Branch = `main`** (Settings → Git). Se já estiver, não mexa.
- [ ] **GitHub — só a branch `main`** deve existir (as `claude/*` antigas foram apagadas).
- [ ] **Vercel — variáveis de ambiente ativas:** `BRAPI_TOKEN` (B3, obrigatória),
      `FMP_KEY` (EUA + câmbio USDBRL histórico), `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## 🟣 Decisão de infra (quando puder, para eu implementar)

- [ ] **Rate-limiting nos proxies** (`/api/*`): hoje não há limite por IP → risco de terceiros
      queimarem a cota **paga** da brapi/FMP. **Rascunho pronto** em `middleware.example.js`
      (inerte — a Vercel só ativa `middleware.js`). Para ligar: (1) criar Redis grátis no
      **Upstash**; (2) setar `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` na Vercel;
      (3) renomear o arquivo para `middleware.js`. **Antes de ativar**, passar a `lastro-review`
      (não foi testado ao vivo). É *fail-open* (se o Upstash falhar, não derruba o app).

## 🟤 Antes de plugar pagamento REAL (travas de segurança do entitlement)

> A auditoria aprovou o entitlement para a fase atual (checkout **simulado**). Estes itens
> precisam ser feitos **antes** de existir cobrança de verdade — senão, no dia do pagamento,
> qualquer um vira Pro de graça. (Detalhe no parecer da review.)

- [ ] **Revogar a RPC provisória:** `REVOKE EXECUTE ON FUNCTION public.grant_entitlement FROM authenticated;`
      (ou dropar a função). Fecha o auto-serviço (hoje qualquer logado poderia se conceder Pro).
- [ ] **Webhook do gateway** (Stripe/Mercado Pago/etc.) rodando com **`service_role`** como a
      ÚNICA fonte de escrita em `user_entitlement`.
- [ ] (Opcional) Restringir o **modo desenvolvedor** (`lastro_testmode`) para não liberar plano
      via cache quando houver cobrança — hoje é só UX client-side, sem acesso a recurso de custo.

## 🔵 Dado da sua conta (dentro do app)

- [ ] **Corrigir a posição antiga do `VALE3`** salva com preço **R$ 312,50** (era o bug do
      pré-preenchimento, já corrigido). Carteira → VALE3 → **editar** o preço para o valor real
      que você pagou, **ou** excluir e lançar de novo. Aportes **novos** já entram certos.

---

## Referência — variáveis de ambiente esperadas

| Onde | Variável | Para quê |
|---|---|---|
| Vercel | `BRAPI_TOKEN` | Cotações/fundamentos B3 (brapi Pro) — obrigatória |
| Vercel | `FMP_KEY` | Stocks EUA + câmbio USDBRL histórico (FMP) |
| Vercel | `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Config pública do front (`/config.js`) |
| GitHub Actions | `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Coletor de notícias (escrita) |
| ~~Vercel~~ | ~~`ANTHROPIC_API_KEY`~~ | **remover** — IA descontinuada |
