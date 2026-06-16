# Lastro · Camada de Notícias (gratuita)

Coleta automática de notícias usando **GitHub Actions** (cron) + **Supabase** (banco e API), 100% no plano gratuito.

```
Portais RSS (InfoMoney, Money Times, Suno)        ┐
Fatos Relevantes oficiais — CVM (dados abertos)   ┘
                    │
                    ▼
        GitHub Actions (cron a cada 20 min)
        backend/scripts/fetch-news.mjs
          · busca, normaliza, deduplica
          · classifica tag + ticker
          · gera "Resumo IA do dia" (opcional)
                    │
                    ▼
            Supabase (Postgres + REST)
              tabela: news / meta
                    │
                    ▼
        Lastro (front) lê via REST  →  feed ao vivo
              (fallback: feed estático)
```

**Por que essa dupla:** o Supabase free pausa o projeto após 7 dias sem atividade e o GitHub Actions desativa o cron após 60 dias de inatividade do repositório. Como o cron roda a cada 20 min, ele mantém os dois vivos — um resolve o ponto fraco do outro. Tudo sem custo.

---

## Passo 1 — Criar o projeto no Supabase

1. Crie conta em [supabase.com](https://supabase.com) e um novo projeto (free).
2. No **SQL Editor**, cole e rode o conteúdo de `backend/supabase/schema.sql`.
3. Em **Project Settings → API**, anote:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → vai no `config.js` do front (leitura)
   - `service_role` key → vai nos secrets do GitHub (escrita; **nunca** no front)

## Passo 2 — Configurar o GitHub Actions

1. Suba o projeto para um repositório **público** no GitHub (minutos ilimitados de Actions).
2. Em **Settings → Secrets and variables → Actions**, crie:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`  (a service_role)
   - `ANTHROPIC_API_KEY`     (opcional — habilita o resumo do dia)
3. O workflow `.github/workflows/news.yml` já está pronto. Ele roda a cada 20 min e pode ser disparado manualmente em **Actions → Coletar notícias → Run workflow**.

> O `backend/package-lock.json` já está versionado (necessário para o cache do
> `setup-node` e para o `npm ci`). Se alterar dependências, rode
> `cd backend && npm install` e suba o lockfile atualizado.

## Passo 3 — Ligar o front ao feed

No `config.js`, preencha:
```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'sua-anon-key',
```
Pronto. A aba **Notícias** passa a ler do Supabase e se atualiza sozinha a cada
`NEWS_REFRESH_MS` (config.js) enquanto estiver aberta. O selo no topo do feed
mostra **"Atualizado há X min"** quando há dados ao vivo, **"Demonstração"** sem
as chaves (usa o feed estático) e **"Feed offline"** se a API falhar.

---

## Testar localmente (opcional)

```bash
cd backend
npm install
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ANTHROPIC_API_KEY=... npm run fetch
```

---

## Fontes e observações

| Fonte | O que traz | Custo |
|---|---|---|
| RSS InfoMoney / Money Times / Suno | Manchetes jornalísticas | Grátis |
| CVM — IPE (dados abertos) | Fatos Relevantes e Comunicados **oficiais** | Grátis |
| Anthropic (opcional) | Resumo do dia + (futuro) classificação avançada | Por uso |

- **CVM**: o arquivo `IPE_CIA_ABERTA_<ano>.csv` é atualizado diariamente em `dados.cvm.gov.br`. Confirme a URL no portal caso a estrutura mude.
- **RSS**: adicione/remova feeds editando `RSS_SOURCES` no `fetch-news.mjs`. Nem todo portal mantém o caminho `/feed/`.
- **Direitos autorais**: o feed exibe **título + link para a fonte** — não reproduz o texto integral. Sempre direcione o clique ao portal original.
- **Classificação**: hoje é heurística (rápida e sem custo). A função de IA pode ser estendida para classificar tag/ticker com mais precisão se desejar.

---

## Evoluções possíveis

- Limpeza automática (apagar notícias > 30 dias) via `pg_cron` no Supabase.
- Alertas: quando sair um Fato Relevante de um ativo da carteira do usuário, disparar push/e-mail.
- Classificação e deduplicação semântica usando `pgvector` (já incluso no Supabase free).
