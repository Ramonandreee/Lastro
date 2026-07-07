# Lastro · Inteligência de Investimentos

Plataforma de análise para o investidor brasileiro — FIIs, ações da B3, BDRs, ETFs, stocks e cripto — com indicadores fundamentalistas, **Score Lastro™** proprietário, simuladores, diagnóstico de carteira e **IA integrada**. Posicionamento: concorrente premium do Investidor10, com foco em **decisão**, não só em dados.

> **Para o colaborador:** este README é o guia completo para desenvolver o Lastro. Leia as seções **4 (rodar local)**, **6 (arquitetura do `index.html`)** e **8 (convenções)** antes de mexer no código.

---

## 1. Visão geral do produto

O app é um **SPA single-file**: quase tudo vive em `index.html` (~9.900 linhas, HTML + CSS + JS puro, sem framework). Abre em qualquer navegador e funciona **em modo demonstração** sem backend; com `config.js` preenchido, liga login, sincronização, IA e dados reais.

**Telas principais** (todas em `index.html`):

- **Mercado:** Início (painel), Ações, FIIs, BDRs, ETFs, Stocks (EUA), Criptomoedas, Notícias, Agenda de Dividendos, Score Lastro™.
- **Minha carteira:** Carteira, Proventos, Aporte Inteligente, Independência (FIRE), Imposto de Renda, Acompanhar (watchlist + alertas), Comparador.
- **Ferramentas Pro:** Raio-X da Carteira, Backtest, Stress Test, Radar de Barganhas, Consultor IA, Detector de Deterioração, Carteiras Recomendadas, Simuladores (renda, juros compostos, aposentadoria).
- **Conta / negócio:** Perfil (cadastro completo + captação de leads), Assinatura, Indique e Ganhe, Suporte, Planos, e um **Painel administrativo** (visão geral, clientes, leads, financeiro, ações) — visível só para o e‑mail do dono.

**Filtros fundamentalistas** (antigo "Rastreador") ficam embutidos em cada listagem de Ações/FIIs (botão **Filtros**, recurso Pro).

### Score Lastro™
Nota proprietária de 0–100 que resume a qualidade de um ativo combinando vários indicadores (valuation, rentabilidade, endividamento, pagamento de proventos). É explicada em qualquer lugar do app tocando no rótulo (padrão de "termo clicável", ver seção 6).

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Front | `index.html` — HTML + CSS + JS puro (sem build, sem framework) |
| Gráficos | Chart.js (CDN) |
| Ícones | Font Awesome 6.5 (CDN) · ícones de cripto via `cryptocurrency-icons` (jsDelivr) |
| Auth + sync + notícias | Supabase (Postgres + Auth + RLS) |
| IA | Proxy serverless `api/ai.js` (Vercel) protegendo a chave da Anthropic |
| Cotações | brapi.dev (B3) e coincap/coingecko (cripto) — hooks prontos |
| Coletor de notícias | Node em `backend/` (cron via GitHub Actions) |
| PWA | `manifest.webmanifest` + `sw.js` (notificações de alerta; **não** faz cache de HTML) |
| Deploy | Vercel (`vercel.json`) |

---

## 3. Estrutura do repositório

```
lastro/
├── index.html              # o app inteiro (HTML + CSS + JS)
├── config.js               # chaves (NÃO versionado — está no .gitignore)
├── config.example.js       # template do config — copie para config.js
├── api/                    # proxies serverless (Vercel) — token do brapi fica no servidor
│   ├── ai.js               # proxy da IA (Anthropic)
│   ├── config.js           # serve /config.js a partir das env vars
│   ├── quotes.js           # cotações reais (brapi B3 em lotes + CoinGecko p/ cripto)
│   ├── universe.js         # universo completo de ativos (lista brapi)
│   ├── fundamentals.js     # indicadores em lote (P/L, P/VP, DY, ROE…)
│   ├── asset.js            # ativo completo (histórico, proventos, DRE, balanço, perfil)
│   └── documents.js        # documentos oficiais da CVM (dataset IPE: ZIP → CSV)
├── backend/
│   ├── supabase/schema.sql       # schema do Postgres (tabelas + RLS)
│   ├── scripts/fetch-news.mjs    # coletor de notícias (RSS + CVM → Supabase)
│   ├── README-backend.md         # setup do backend
│   └── package.json
├── .github/workflows/            # cron do coletor de notícias (GitHub Actions)
├── sw.js, manifest.webmanifest   # PWA
├── icons / favicons
├── vercel.json                   # config de deploy
├── README.md                     # este arquivo
└── HANDOFF.md                    # estado atual / histórico
```

---

## 4. Rodar localmente

Não há build. É um site estático — precisa apenas ser **servido por HTTP** (abrir o `file://` direto quebra o `fetch` do `config.js` e da IA).

```bash
# 1. Configuração (opcional — sem isso, roda em modo demonstração)
cp config.example.js config.js
#    edite config.js com os valores reais (peça ao Ramon)

# 2. Sirva a pasta com qualquer servidor estático:
python3 -m http.server 5173
#    ou:  npx serve .

# 3. Abra http://localhost:5173
```

Para a **IA** funcionar localmente, use `vercel dev` (roda o proxy `api/ai.js`) em vez do servidor estático simples.

---

## 5. Configuração (`config.js`)

`config.js` é **gitignored** (contém chaves). Cada dev cria o seu a partir do `config.example.js`. Campos:

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — projeto Supabase. Use a chave **publishable/anon** (é pública por design; a escrita é protegida por RLS). Liga login, sincronização de carteira/perfil e o feed de notícias.
- `BRAPI_TOKEN` — cotações da B3 (grátis em brapi.dev).
- `AI_ENDPOINT` — normalmente `/api/ai`.

O objeto vira `window.LASTRO_CONFIG`, lido pela função `_sb()` no `index.html`.

---

## 6. Arquitetura do `index.html` (guia do desenvolvedor)

Tudo é organizado por convenções simples. Onde procurar:

### Sistema de design (CSS)
- Todas as cores/raios/sombras são **custom properties** (`--brand`, `--ink`, `--gold`, `--line`, `--surface`, `--r`, `--sh-*`, `--ease`) definidas em `:root`.
- **Dark mode** por `[data-theme="dark"]` (e `prefers-color-scheme`). Estilize sempre via tokens — nunca cores fixas dentro do dark.
- Números usam a fonte `--mono`.

### Navegação e telas
- `const PAGES = { chave: { t:'Título', s:'Subtítulo' } }` — registro de todas as telas.
- `nav(view, el)` — troca de tela: seta título, chama `render()`, `scrollToTop()`, fecha sidebar.
- `function render(v)` — um `switch` gigante que injeta `viewX()` em `#content`.
- Cada tela é uma função `viewAlgo()` que **retorna uma string de HTML** (template literals).
- `afterRender(v)` — roda depois do render para inicializar gráficos (Chart.js) e animações daquela tela.
- Barras de abas fixas (sticky) usam o componente `.stabs`/`.atabs`/`.ad-tabs` (busca "barra de abas" no CSS).

### Estado e persistência
- `localStorage` guarda tudo do usuário: `lastro_session`, `lastro_profile`, `lastro_carteira`, `lastro_watch`, `lastro_alerts`, `lastro_plan`, `lastro_sub`, `lastro_theme`, `lastro_priv`…
- `tableState[kind]` — estado das listagens de mercado (busca, segmento, ordenação, página, filtros fundamentalistas).
- **Perfil/carteira sincronizam na nuvem** (Supabase tabela `user_state`, coluna `data` jsonb): `saveCloudState()` (debounce), `flushCloudState()` (imediato, usado ao salvar/sair) e `loadCloudState()` (no login).

### Auth
- Supabase Auth. Sessão salva em `lastro_session`. `currentUser()`, `isAuthed()`, `authLogin/authSignup/authLogout`.
- Cadastro em etapas (dados + perfil de investidor + verificação) — captação de leads.
- Dono/admin: `isOwner()` (compara com `OWNER_EMAIL`), "Modo desenvolvedor" e "Painel administrativo".

### Helpers reutilizáveis (use em vez de reinventar)
- `assetLogo(tk, kind, size)` — logo do ativo (imagem + fallback monograma). Cripto tem tile circular colorido.
- `hlp(chave)` e `termLabel(chave, texto)` + os dicionários `TERMS`/`TERM_CARDS` — **explicação de termos**: qualquer jargão vira um rótulo clicável que abre uma ficha (o que é, como calcula, como interpretar). **Não** espalhe "?" — use esse padrão.
- `scrollToTop()`, `brl()/brl0()`, `pc()`, `esc()`, `toast()`, `showConfirm()`.
- Cotações: `refreshQuotes()`. IA: `callAI()` / `askAI()` via `AI_ENDPOINT`.

---

## 7. Backend

- **Schema:** `backend/supabase/schema.sql` — tabelas `news`, `meta`, `user_state` (com RLS: cada usuário só acessa a própria linha). Rode no SQL Editor do Supabase ao provisionar.
- **Notícias:** `backend/scripts/fetch-news.mjs` coleta RSS de portais BR + Fatos Relevantes da CVM, classifica e grava no Supabase. Agendado por GitHub Actions (`.github/workflows/`). Setup em `backend/README-backend.md`.
- **IA:** `api/ai.js` é um proxy Vercel que injeta a chave da Anthropic no servidor (nunca no cliente).

---

## 8. Convenções de desenvolvimento

- **Antes de cada commit, valide** (o `index.html` é um só arquivo — um erro de sintaxe quebra tudo):
  ```bash
  node -e 'const h=require("fs").readFileSync("index.html","utf8");
    const st=[...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join("\n");
    let b=0;for(const c of st){if(c=="{")b++;else if(c=="}")b--;}
    const js=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    let ok=true;js.forEach((s,i)=>{try{new Function(s)}catch(e){ok=false;console.log("JS erro",i,e.message)}});
    console.log("CSS chaves:",b,"| JS:",ok?"OK":"FALHA")'
  ```
  Espere `CSS chaves: 0` e `JS: OK`.
- **Mobile-first / iOS:** zoom por pinça e duplo-toque estão desativados; segurar não seleciona texto (só campos). Cuidado ao mexer em `viewport`, `touch-action`, `user-select` e `position: sticky` (não usar `overflow:hidden` no `html/body` para travar scroll — quebra o cabeçalho sticky; use scrim/`touch-action`).
- **Responsivo:** grids viram coluna única no mobile; tabelas rolam dentro do card; modais usam `100dvh`.
- **Tema:** sempre via tokens; teste claro e escuro.
- **Git:** trabalhe em branch; `main` é o que está no ar. Não commite `config.js`.

---

## 9. Deploy

Deploy na **Vercel** (`vercel.json`). O push para a branch de produção publica o site estático + a função `api/ai.js`. As chaves de servidor (Anthropic) ficam nas variáveis de ambiente da Vercel; as do cliente, no `config.js` injetado no build.

---

## 10. Roadmap curto (o que falta para "produção de verdade")

O produto está rico em UX; o próximo salto é **dado real** e confiança:
1. Cotações ao vivo (B3 + cripto) substituindo os dados de demonstração.
2. Import de carteira (B3/CEI ou nota/extrato da corretora).
3. Proventos e IR reais (data-com, DARF, informe).
4. 2FA real e rodapé institucional (CNPJ, termos, LGPD).

Ver o `HANDOFF.md` para o histórico completo.
