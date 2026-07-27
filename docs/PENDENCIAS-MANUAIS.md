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
      queimarem a cota **paga** da brapi/FMP. Recomendo um **Edge middleware** (não conta no
      limite de 12 funções da Vercel) ou **Upstash/KV**. Preciso do seu OK (e, se for Upstash,
      da conta/variáveis) para implementar com review/teste. Detalhes em
      `docs/auditoria-seguranca-2026-07.md`.

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
