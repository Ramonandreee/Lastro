# SPEC — Carteiras de instituições (agregador)

> **Status:** especificação pronta para build. Nenhum código de produto foi alterado por este documento.
> **Autor:** lastro-architect · **Data:** ago/2026
> **Substitui:** a antiga "Carteiras Recomendadas" (aposentada — ver `HANDOFF.md` e
> `docs/plans/pendencias-manuais.md` §"Carteiras Recomendadas").

---

## 0. Resumo executivo

O Lastro passa a **agregar carteiras públicas de instituições** (BTG, XP, etc.) em vez de
recomendar carteiras próprias. O único dado importado de fora é a **composição publicada**
(instituição, nome, competência, data de publicação, URL da fonte e a lista `{ticker, peso}`);
**todo o resto é derivado** da infraestrutura de dado real que o app já opera: setor por
`a.seg`/`segOf`, cotação e variação por `/api/quotes` + `applyQuotes`, fundamentos por
`loadAssetLive`, desempenho desde a publicação por `HIST_CLOSE`/`closeOn` +
`/api/market?fn=history` (a mesma base do backtest real) e IBOV por **BOVA11**.
Zero campos `ret`/`dy`/`vol` chumbados — foi o que derrubou a versão anterior.
A composição vive em **`/data/carteiras.json`** (arquivo estático versionado, sem custo de
Serverless Function, validado por teste no CI), atualizado mensalmente à mão a partir do PDF.
Duas telas novas (`carteirasinst` lista, `carteirainst` detalhe), reusando `donutChart`/
`donutLegend` (órfãos desde a aposentadoria) e o padrão de linha do backtest.
Gate: **composição e setor são free** (gancho de aquisição, é conteúdo público);
**desempenho vs IBOV, indicadores ponderados e histórico de composição são Premium**.
Bloqueadores fora da engenharia: **direito de uso da composição** (validação jurídica) e
**quem alimenta o JSON todo mês**.

---

## 1. Modelo de dados da carteira publicada

### 1.1 Onde guardar — decisão e trade-offs

**Recomendado (Fase 1): arquivo estático `/data/carteiras.json` na raiz do repositório.**

| Opção | A favor | Contra | Veredito |
|---|---|---|---|
| **Array inline no `index.html`** | zero fetch, funciona offline | engorda o arquivo mais crítico do projeto (hoje ~1,18 MB / 14.5k linhas); **toda atualização mensal vira diff no arquivo que derruba o app se quebrar a sintaxe**; conteúdo misturado com código | ❌ |
| **`/data/carteiras.json` (estático)** | Vercel serve estático (**não conta no limite de 12 funções**); edição isolada do código; diff legível; validável por `node:test` no CI já existente (`.github/workflows/test.yml`); `sw.js` não faz cache de fetch → publica na hora | precisa de 1 fetch + fallback; atualizar exige commit/push (deploy automático) | ✅ **Fase 1** |
| **Tabela Supabase `public.carteiras`** | dono edita sem deploy; padrão de leitura pública já existe (`news`, RLS `for select using (true)`) | exige schema + RLS + tela de edição (ou SQL Editor na unha, pior que editar JSON); mais superfície para errar | 🕐 **Fase 3**, só se a cadência mensal doer |
| **Arquivo em `backend/`** | — | **`backend/` está no `.vercelignore`** → nunca chega ao deploy | ❌ inviável |

Notas de implementação do arquivo estático:
- Caminho: `/data/carteiras.json`. Fetch no front com `fetch('/data/carteiras.json?v='+BUILD)`
  ou simplesmente sem cache-buster (a Vercel invalida no deploy).
- **Fallback obrigatório:** se o fetch falhar, a tela mostra `emptyState(...)`
  ("Não foi possível carregar as carteiras agora") — nunca dado inventado.
- Adicionar em `vercel.json` → `headers`: `{"source":"/data/carteiras.json","headers":[{"key":"Cache-Control","value":"public, max-age=0, must-revalidate"}]}`
  (mesmo tratamento do `index.html`).

### 1.2 Schema

```jsonc
{
  "version": 1,
  "updatedAt": "<YYYY-MM-DD>",          // última edição do arquivo
  "carteiras": [
    {
      // ── identidade ──────────────────────────────────────────────
      "id":          "<inst-slug>-<carteira-slug>-<YYYY-MM>",  // OBRIGATÓRIO, único
      "serieId":     "<inst-slug>-<carteira-slug>",            // OBRIGATÓRIO, liga as competências da MESMA carteira
      "inst":        "<Nome da instituição>",                  // OBRIGATÓRIO
      "instSlug":    "<slug>",                                 // OBRIGATÓRIO (agrupamento e logo)
      "nome":        "<Nome da carteira, como publicado>",      // OBRIGATÓRIO
      "tipo":        "acoes|fiis|dividendos|small-caps|bdrs|mista",  // OBRIGATÓRIO (filtro da lista)

      // ── procedência (o que torna a feature defensável) ───────────
      "competencia": "<YYYY-MM>",        // OBRIGATÓRIO — mês de referência declarado pela fonte
      "publicadoEm": "<YYYY-MM-DD>",     // OBRIGATÓRIO — data de publicação; é o t0 do desempenho
      "fonteUrl":    "https://<...>",    // OBRIGATÓRIO — https, domínio da própria instituição
      "fonteTitulo": "<Título do relatório, como publicado>",   // OBRIGATÓRIO
      "fonteTipo":   "pdf|pagina|video", // OBRIGATÓRIO
      "acessoLivre": true,               // OBRIGATÓRIO — false = exige login na instituição (rotular na UI)

      // ── composição (ÚNICO dado numérico importado) ───────────────
      "moeda":       "BRL",
      "pesoUniforme": false,             // true quando a fonte publica "pesos iguais"
      "ativos": [
        { "tk": "<TICKER>", "peso": <PESO> }   // peso em % (número), 1 casa decimal
      ],

      // ── atribuição e rastreabilidade ─────────────────────────────
      "obs":         "<observação/atribuição livre>",  // opcional, exibido literal
      "coletadoPor": "<nome de quem transcreveu>",     // OBRIGATÓRIO
      "coletadoEm":  "<YYYY-MM-DDTHH:mm:ssZ>"          // OBRIGATÓRIO
    }
  ]
}
```

**Campos mínimos obrigatórios** (a carteira é rejeitada pelo validador sem eles):
`id`, `serieId`, `inst`, `instSlug`, `nome`, `tipo`, `competencia`, `publicadoEm`,
`fonteUrl`, `fonteTitulo`, `fonteTipo`, `acessoLivre`, `ativos[].tk`, `ativos[].peso`,
`coletadoPor`, `coletadoEm`.

**Regras de conteúdo (inegociáveis):**
1. **Nenhum campo de retorno, DY, volatilidade ou risco entra no JSON.** Se alguém tentar
   adicionar `ret`, `dy`, `vol`, `risco`, `score` ou `nota`, o validador **falha o CI**
   (lista negra explícita — ver 1.3).
2. Não transcrever o **texto/análise** do relatório. `obs` é para atribuição e ressalvas
   ("a fonte publica pesos iguais", "carteira sofreu troca em 12/mm"), não para resumo da tese.
3. Peso é **como publicado**. Se a fonte publica "pesos iguais", escreva os pesos explícitos
   (`100/N` arredondado) **e** marque `pesoUniforme: true` — a UI rotula "pesos iguais conforme a fonte".
4. **Nunca normalizar silenciosamente.** Se a soma der 99,7%, guarda-se 99,7%; a UI mostra a
   soma real quando ela sai de 100%.

### 1.3 Validação — `test/carteiras.mjs` (roda no CI existente)

Novo teste `node:test` em `test/carteiras.mjs` (o workflow `.github/workflows/test.yml` já roda
`node --test test/*.mjs`). O que ele checa, por carteira:

| Checagem | Regra | Falha se |
|---|---|---|
| Campos obrigatórios | presentes e não vazios | faltar qualquer um |
| `id` único | `Set(ids).size === carteiras.length` | duplicado |
| **Soma dos pesos** | `Math.abs(Σpeso − 100) <= 0.5` | fora da tolerância (arredondamento de PDF) |
| Peso individual | `0 < peso <= 100` | zero, negativo ou > 100 |
| Ticker duplicado | tickers únicos dentro da carteira | repetido |
| **Formato do ticker** | B3: `/^[A-Z]{4}\d{1,2}$/` · EUA: `/^[A-Z.]{1,5}$/` · cripto: lista `COINGECKO_IDS` de `lib/history.js` | fora do padrão |
| Datas | `competencia` = `YYYY-MM`; `publicadoEm` = `YYYY-MM-DD` válida e **não futura** | inválida/futura |
| Coerência data × competência | `publicadoEm` dentro de `[1º dia da competência − 15d, +75d]` | fora (provável erro de digitação) |
| `fonteUrl` | começa com `https://`, host não vazio | http ou vazio |
| **Lista negra de campos** | nenhuma chave em `{ret,retorno,rent,dy,yield,vol,volatilidade,risco,score,nota,recomendacao,alvo,preco}` em qualquer nível | presente → **erro explícito citando esta spec** |

**Tickers inexistentes** (o teste não consegue provar existência offline — o CI não tem `BRAPI_TOKEN`):
1. **Barreira 1 — formato** (acima), pega 90% dos erros de digitação.
2. **Barreira 2 — script manual opcional** `backend/scripts/check-carteiras.mjs`: roda local/
   com token e bate cada ticker em `https://lastro-dun.vercel.app/api/quotes?symbols=...`,
   imprimindo os que não voltaram. **Rodar antes de publicar o mês.**
3. **Barreira 3 — runtime honesto:** no front, ticker que `assetLookup(tk)` (l.11993) não
   resolver **aparece na composição** (o peso publicado é fato) mas com o rótulo
   `Ativo não localizado na base` e **fica FORA de toda derivação** (setor, DY, desempenho),
   com o peso renormalizado e a cobertura declarada na tela (ver §2.6).

### 1.4 Fluxo mensal do dono (o "menor atrito" na prática)

1. Abrir o relatório da instituição.
2. Duplicar a última entrada em `/data/carteiras.json`, trocar `id`/`competencia`/
   `publicadoEm`/`fonteUrl`/`fonteTitulo`, atualizar `ativos[]`.
3. `node --test test/carteiras.mjs` → tem de passar.
4. (Opcional, recomendado) `node backend/scripts/check-carteiras.mjs`.
5. Rodar a validação obrigatória do projeto (`CSS chaves: 0 | JS: OK`) e `git push origin HEAD:main`.

Tempo estimado por carteira: **3–5 min**. Manter as competências antigas no arquivo
(elas alimentam o histórico de composição, §3.2.6) — poda só acima de 24 competências por `serieId`.

---

## 2. O que dá para DERIVAR com o que já existe (função por função)

> Convenção desta seção: `c` = objeto carteira do JSON; `w_i` = `c.ativos[i].peso`;
> `t0` = `c.publicadoEm`.

### 2.1 Setor / classe de cada ativo — **já existe, reuso direto**

| Precisa | Usa | Onde |
|---|---|---|
| resolver ticker → ativo | `assetLookup(tk)` → `{a, k}` | l.11993 |
| classe legível | `ASSET_CLASS[k].label` ('Ação','FII','BDR','ETF','Stock','Cripto') | l.11985 |
| setor/segmento | `segOf(tk)` (cacheado; devolve `a.seg || a.sub || ''`) | l.12030 |
| rótulo de setor para não-ação/FII | espelhar `rxSetorOf`/`rxClasseOf` do Raio-X (ETF/cripto/exterior viram a própria classe) | l.11531–11532 |
| moeda | `curOf(tk)` / `fmtCur(v,cur)` | l.12004–12005 |
| logo | `assetLogo(tk, k, 'sm')` | l.12078 |

Função nova sugerida: **`cartSetorOf(tk)`** — 3 linhas, envolve `assetLookup` + `segOf` +
fallback `rxClasseOf(k)`; devolve `'Não classificado'` quando não resolve.

### 2.2 Cotação e variação atuais — **já existe, 1 linha de plugue**

- `refreshQuotes()` (l.14353) é chamado por `afterRender` (l.10550) e busca só os símbolos
  da tela via **`screenSymbols()` (l.14269)**.
- **Mudança necessária (única no pipeline de cotação):** adicionar dois `case` no switch de
  `screenSymbols()`:
  ```js
  case 'carteirasinst': /* tickers das carteiras em destaque na lista */ break;
  case 'carteirainst':  /* tickers da carteira aberta + 'BOVA11' */ break;
  ```
  separando B3 (`b3.add`) de cripto (`crypto.add`) com `assetLookup(tk).k` e excluindo
  `isUsAsset(lk)` (l.12670), exatamente como o `case 'carteira'` (l.14279) faz.
- `applyQuotes` (l.14307) já grava `a.px`/`a.var`/`a.live`, e `softRefreshView()` redesenha.
- **Ativos dos EUA** (carteiras de BDR/stocks): `loadUsQuotes(tickers)` (l.7505) no
  `afterRender` da view, igual ao que Home/Carteira fazem (l.10552–10554).
- **Cripto** já entra pelo mesmo `/api/quotes` (parâmetro `crypto=`).

### 2.3 Fundamentos por ativo (DY, P/VP, P/L) — **já existe**

- `loadAssetLive(tk)` (l.12649) → `/api/asset?ticker=` → `applyAssetLive` (l.12601) grava
  `a.dy`, `a.pvp`, `a.pl`, `a.roe` e `FUND[tk]`; cache de 5 min em `ASSET_LIVE`.
- **Cuidado de custo:** é 1 requisição por ativo. Carregar **só na tela de detalhe**, com
  concorrência limitada (3 em paralelo, no molde do `mapLimit` de `lib/history.js`), e só
  para `LIVE_ASSET_KINDS`. Para EUA, `loadUsDetail(tk)` (l.12703) — opcional, Fase 3.

**Agregação ponderada (cálculo real, não estimativa):**

- **DY médio ponderado** (média aritmética ponderada é a agregação correta para *yield*):
  ```
  DY_carteira = Σ( w_i · dy_i ) / Σ( w_i )      // i restrito aos ativos com dy_i conhecido
  cobertura_dy = Σ( w_i com dy ) / Σ( w_i )     // exibida SEMPRE ao lado do número
  ```
- **P/L e P/VP ponderados** — usar **média harmônica ponderada** (é a matemática correta
  para razões preço/valor: a carteira paga `Σw·P` por `Σw·E`):
  ```
  PL_carteira = 1 / Σ( w'_i / PL_i )     com w'_i = w_i / Σ w_i (só i com PL_i > 0)
  ```
  Descartar `PL_i <= 0` (prejuízo) e declarar quantos ficaram de fora. **Nunca** média simples.
- Regra de exibição: se `cobertura < 0.7`, **não exibir o indicador** (mostra "—" e a razão).
  Entre 0,7 e 0,9, exibir com o rótulo de cobertura em destaque.
- Rotular com `termLabel('dyMed', ...)` — o card já existe em `TERM_CARDS` (l.13000).

### 2.4 Desempenho desde a publicação vs IBOV — **a peça central, 100% derivada**

**Insumos já prontos:**
- `HIST_CLOSE` (l.10982) — mapa `{ticker: {'YYYY-MM-DD': fechamento}}`, persistido em
  `localStorage['lastro_hist_close']`, alimentado por `/api/market?fn=history`.
- `closeOn(tk, dayStr)` (l.10986) — último fechamento **em ou antes** do dia. Resolve
  publicação em fim de semana/feriado sem gambiarra.
- `loadPortfolioHistory` (l.10991) + `WHIST_RANGE` (l.10990) — o molde do fetch.
- `lib/history.js` — brapi (B3), FMP (EUA + câmbio `USDBRL`), CoinGecko (cripto).

**Função nova: `loadCarteiraHistory(c)`** — cópia enxuta de `loadPortfolioHistory`, trocando
`CARTEIRA` por `c.ativos` e adicionando **`BOVA11`** ao lote B3. Janela pela idade da publicação:

```js
const meses = mesesDesde(c.publicadoEm);
const cfg = meses<=3  ? {range:'3mo', days:95}
          : meses<=6  ? {range:'6mo', days:190}
          : meses<=12 ? {range:'1y',  days:370}
          : meses<=24 ? {range:'2y',  days:740}
          :             {range:'5y',  days:800};
```
Cache por `(tickers + range)` com TTL de 1 h, igual ao `_histKey`/`_histAt` (l.11001–11003).

**Fórmula do retorno da carteira (base 100, pesos fixos da publicação):**

```
Elegíveis E = { i : closeOn(tk_i, t0) > 0 }          // tem fechamento em/antes da publicação
w'_i = w_i / Σ_{j∈E} w_j                             // renormaliza SÓ entre os elegíveis
P_i(t) = closeOn(tk_i, t)                            // carry-forward do último fechamento
R_cart(t) = Σ_{i∈E} w'_i · ( P_i(t) / P_i(t0) − 1 )   // retorno acumulado, em fração
Índice(t) = 100 · (1 + R_cart(t))
```

- **Grade de datas:** os dias em que **BOVA11** tem fechamento (garante calendário da B3,
  sem inventar pregão). Para cada dia da grade, cada ativo entra por `closeOn` — isto é
  carry-forward de fechamento real, **não interpolação**.
- **Benchmark:** `R_ibov(t) = closeOn('BOVA11', t) / closeOn('BOVA11', t0) − 1`.
  Rotular sempre **"IBOV (via BOVA11)"** — é o mesmo proxy do backtest.
- **Ponto final:** se o mercado estiver aberto, o último ponto pode usar `a.px` ao vivo
  (`assetLookup(tk).a.px`) em vez do fechamento — **marcar o ponto como "parcial"** no tooltip.
  Se preferir simplicidade, ficar só em fechamentos (recomendado para a Fase 1).
- **Rebalanceamento:** a fórmula acima é **buy-and-hold com pesos da publicação** (o que a
  instituição publicou; não há rebalanceamento anunciado). Deixar isso explícito na UI
  (§4, texto do rodapé). Não simular rebalanceamento — seria hipótese nossa.

**Degradação honesta (regras, não improviso):**

| Situação | Comportamento |
|---|---|
| `closeOn(tk, t0)` nulo para um ativo | ativo sai de `E`; peso renormalizado; conta na cobertura |
| **cobertura ≥ 90%** do peso | exibe o número normalmente + nota "cobre X% do peso" |
| **cobertura 70–90%** | exibe com chip de atenção "cálculo cobre X% do peso (N de M ativos)" |
| **cobertura < 70%** | **não exibe retorno nem o gráfico**; mostra só composição + a razão |
| histórico não alcança `t0` (publicação > 5 anos ou brapi sem dado) | ancorar no **primeiro dia com fechamento** e rotular **"desde <dd/mm/aaaa>"** — jamais dizer "desde a publicação" |
| `/api/market?fn=history` falha | placeholder "Desempenho indisponível agora" + botão "tentar de novo"; a composição continua na tela |
| carteira publicada **hoje** (0 pregões) | "Publicada hoje — sem período para medir ainda" |
| ativos em USD na carteira | converter pelo `USDBRL` histórico (`qs.set('fx','USDBRL')`, já suportado por `lib/history.js`); sem `FMP_KEY`, o ativo sai de `E` |

**Riscos conhecidos a declarar no doc de entrega:**
- **Proventos não entram.** O cálculo é **variação de cotação**, não retorno total. O BOVA11
  distribui dividendos desde 2023, então a comparação favorece levemente o benchmark quando
  medida só por preço. **Rotular explicitamente** (§4) e tratar total return como Fase 3
  (fonte já existe: `lib/dividends.js` + `api/asset.js` `dividends[]`).
- **Split/bonificação.** `lib/history.js` l.63 usa `h.close ?? h.adjustedClose` — prefere o
  **não ajustado**. Um desdobramento no período distorce o retorno do ativo. Recomendação:
  inverter para `h.adjustedClose ?? h.close`. **Trade-off:** isso também muda o backtest e a
  evolução de patrimônio → exige regressão (lastro-finance + lastro-qa) antes de mexer.
  Enquanto não mudar, o desempenho fica sujeito a esse viés — declarar como limitação.

### 2.5 Concentração — **matemática do Raio-X, sem a nota**

Função nova pura `carteiraConc(c)` (não tocar em `diversificationGrade`, l.11533, que opera
sobre `CARTEIRA` e devolve *grade* — aqui **não queremos nota**):

```
top1 = maior w_i                                     // "maior posição"
top5 = Σ dos 5 maiores w_i
HHI  = Σ (w_i/100)²  × 10.000                        // 0–10.000; <1500 pulverizado, >2500 concentrado
nSetores = |{ cartSetorOf(tk_i) }|
maiorSetor = { nome, peso } do setor de maior soma de pesos
```
Exibir os números **descritivamente** ("maior posição: X%", "5 maiores: Y%", "HHI: Z"),
com `termLabel('hhi', 'HHI')` → **novo card em `TERM_CARDS`** (l.12981):

```js
hhi:{ nome:'Índice HHI (concentração)', icon:'fa-compress',
      descricao:'Mede o quanto a carteira está concentrada em poucos ativos.',
      formula:'Soma dos quadrados dos pesos (em %) — de 0 a 10.000',
      interpretacao:'Abaixo de 1.500 é pulverizada; acima de 2.500, concentrada.',
      faixaIdeal:'É uma medida descritiva, não um julgamento da carteira.' }
```

**Proibido aqui:** transformar isso em nota/grade/semáforo da carteira da instituição (§3.3).

### 2.6 Cobertura — o número que mantém a feature honesta

Toda derivação carrega um par `{valor, cobertura}`. Helper único:

```js
function cobertura(c, temDado){          // temDado: (tk)=>boolean
  const tot = c.ativos.reduce((s,x)=>s+x.peso,0) || 1;
  const ok  = c.ativos.filter(x=>temDado(x.tk)).reduce((s,x)=>s+x.peso,0);
  return { pct: ok/tot*100, n: c.ativos.filter(x=>temDado(x.tk)).length, m: c.ativos.length };
}
```
Renderizar sempre como `<small class="faint">cobre 94% do peso (14 de 15 ativos)</small>`.

---

## 3. Telas

### 3.0 Encaixe na arquitetura

| Ponto | O que fazer | Onde |
|---|---|---|
| `PAGES` | `carteirasinst: { t:'Carteiras de instituições', s:'Composições publicadas por casas de análise, com indicadores calculados de dado real' }` e `carteirainst: { t:'Carteira publicada', s:'Composição, setores e desempenho desde a publicação' }` | l.5344 |
| `render(v)` | 2 ramos: `viewCarteirasInst()` e `viewCarteiraInst(currentCartId)` | l.7018 |
| `afterRender(v)` | `if(v==='carteirasinst'){ loadCarteirasIndex(); }` · `if(v==='carteirainst'){ initCarteiraInstCharts(); if(!soft){ loadCarteiraHistory(cartAtual()); loadCarteiraFund(cartAtual()); } }` | l.10526 |
| `VIEW_TAB` | `carteirasinst:'mercado', carteirainst:'mercado'` | l.7002 |
| Estado da tela | `let currentCartId = null, prevCartView = 'carteirasinst';` — mesmo padrão de `currentAssetTk`/`prevView` (l.12743) | — |
| Voltar | `goBack()` (l.14148) já usa `navStack`; a lista→detalhe funciona sem alteração | — |
| Deep-link | `nav('carteirainst')` sem `currentCartId` → redireciona para `carteirasinst` (guarda no `nav`, l.6936, no estilo do `if(v==='fire')`) | — |

### 3.1 Lista — `viewCarteirasInst()`

```
[ sec-title ]  Carteiras de instituições
[ sec-desc  ]  Composições publicadas por casas de análise. O Lastro apresenta o que é
               público e calcula os indicadores a partir de cotações reais.

[ chips .stabs ]  Todas · <Instituição A> · <Instituição B> …      (filtro por instituição)
[ chips        ]  Todos os tipos · Ações · FIIs · Dividendos …     (filtro por tipo)

[ card por carteira ]
  ┌───────────────────────────────────────────────────────────────┐
  │ (avatar da instituição)  <Instituição> · <Nome da carteira>    │
  │  chip "Referência <mês/AAAA>"   ·   <N> ativos   ·  tipo       │
  │  Publicada em <dd/mm/aaaa>                                     │
  │  Fonte: <dominio-da-fonte>                       [ chevron ]   │
  └───────────────────────────────────────────────────────────────┘
```
- Ordenação padrão: `publicadoEm` desc; agrupar por instituição quando o filtro for "Todas".
- Avatar da instituição: reusar `avatarColor(instSlug)` + `avatarInitials` (l.12026–12028) —
  **não** hospedar logo de terceiro sem permissão.
- Vazio / erro de fetch: `emptyState('fa-building-columns', ...)` (l.7714).
- Cada card → `openCarteiraInst(id)` → seta `currentCartId` e `nav('carteirainst')`.

### 3.2 Detalhe — `viewCarteiraInst(id)`

**3.2.1 Cabeçalho (procedência antes de tudo)**
```
<Instituição> · <Nome da carteira>
chip: Referência <mês/AAAA>   |   Publicada em <dd/mm/aaaa>   |   <N> ativos
[ botão primário ]  Ver relatório original na <Instituição>   ↗
  → target="_blank" rel="noopener noreferrer nofollow"
  → se acessoLivre === false: subtexto "Pode exigir login de cliente da instituição."
```
O botão da fonte fica **acima da dobra**, não escondido no rodapé.

**3.2.2 Faixa de indicadores derivados** (`.mstrip`, mesmo componente do backtest, l.11486)

| Célula | Valor | Sublinha (`dl faint`) |
|---|---|---|
| Desde a publicação | `R_cart` % | "cotação, sem proventos · cobre X% do peso" |
| IBOV no período | `R_ibov` % | "via BOVA11, mesma janela" |
| Diferença | `(R_cart − R_ibov)` p.p. | "carteira − IBOV" |
| DY médio ponderado | % | "pelos pesos publicados · cobre X%" — `termLabel('dyMed', …)` |
| Maior posição | `top1` % | "`<TICKER>`" |

Bloqueada para free (ver §5): renderizar `premiumPresentation('carteirasinst')` no lugar.

**3.2.3 Composição** — lista no padrão `.rx-asset` (l.11591), item clicável `quickView(tk)`:
`logo · TICKER · nome · setor · barra de peso · peso% · cotação (fmtCur) · var% do dia`.
Rodapé da lista: "Soma dos pesos: 100,0%" (ou o valor real, quando difere) e, se `pesoUniforme`,
"A fonte publica pesos iguais entre os ativos."
Ativo não resolvido: linha cinza com `Ativo não localizado na base` e sem números derivados.

**3.2.4 Divisão por setor (rosca)** — **reusa os órfãos** `donutChart(id, items)` (l.13887) e
`donutLegend(items)` (l.13748), que ficaram sem uso após a aposentadoria:
```js
// items: { n:<setor>, v:<peso em fração>, c:<cor>, p:'<peso formatado>', s:'<N ativos>' }
const items = setores.map((s,i)=>({ n:s.nome, v:s.peso/100, c:CHART_PALETTE[i%CHART_PALETTE.length],
                                    p:pc(s.peso,1)+'%', s:`${s.n} ativo${s.n>1?'s':''}` }));
donutChart('cartSetorChart', items);           // v é multiplicado por 100 internamente
$('#cartSetorLeg').innerHTML = donutLegend(items);
```
`CHART_PALETTE` em l.11601. Setores com peso < 3% viram "Outros" (evita rosca poluída) —
a legenda diz quantos ativos entraram em "Outros".

**3.2.5 Desempenho desde a publicação vs IBOV (linha)** — `initCarteiraInstChart()` no molde
exato de `initBacktest()` (l.11510): `charts.cartInst`, guarda `if(!HAS_CHART)`, cores via
`cssVar('--brand')` / `cssVar('--accent')`, `pointRadius:0`, `interaction:{mode:'index'}`,
eixo Y em **base 100** (`callback:v=>v.toFixed(0)`) e tooltip em `%`. Dois datasets:
"`<Instituição> · <Nome>`" (sólido, `--brand`) e "IBOV (BOVA11)" (tracejado, `--accent`).
Chip do card: `fechamentos reais` (verde) quando `d.real`, no padrão da l.11501.

**3.2.6 Histórico de composição** (só se houver ≥2 competências com o mesmo `serieId`)
Tabela mês a mês do que **a fonte publicou**: `Entrou` / `Saiu` / `Peso alterado (de X% para Y%)`.
É dado publicado, não derivado — não precisa de disclaimer de cálculo, só de atribuição.

**3.2.7 Bloco de atribuição/disclaimer** — sempre visível, nunca colapsado (textos em §4).

### 3.3 O que NÃO colocar (lista de veto)

- ❌ Nota, score, grade, estrelas ou semáforo **da carteira da instituição** (não avaliamos o
  trabalho alheio nem sugerimos qualidade).
- ❌ "Risco: baixo/médio/alto", "perfil indicado: conservador/moderado/arrojado" — arbitrário.
- ❌ "Carteira recomendada", "sugerida", "escolha da Lastro", "top do mês", ranking entre
  instituições, "melhor carteira".
- ❌ Botão "replicar esta carteira" / "aplicar na minha carteira" / "comprar" — vira ordem
  de investimento. (Sobreposição descritiva com a carteira do usuário: só Fase 3, rótulo
  neutro "Sobreposição com a sua carteira", sem CTA de compra.)
- ❌ Projeção futura, preço-alvo, "potencial de alta", simulação "se você tivesse investido
  R$ X" (transforma composição em promessa).
- ❌ Reprodução do **texto/análise/tese** do relatório, tabelas copiadas ou **hospedagem do PDF**.
  Só link para a origem.
- ❌ Qualquer número não derivado de dado real — em especial `ret`/`dy`/`vol` no JSON.
- ❌ Notificação/alerta do tipo "a carteira X mudou, ajuste a sua".

---

## 4. Rótulos e textos exatos

**Título e subtítulo da lista** (`PAGES.carteirasinst`)
> **Carteiras de instituições**
> Composições publicadas por casas de análise, com indicadores calculados a partir de dados reais.

**Chapéu da lista (`sec-desc`)**
> Estas carteiras são publicadas pelas próprias instituições. O Lastro apenas **apresenta a
> composição divulgada** e calcula indicadores a partir de cotações públicas. Não são
> recomendações da Lastro.

**Cabeçalho do detalhe**
> Carteira **{nome}**, de **{instituição}**.
> Referência **{mês/ano}** · publicada em **{dd/mm/aaaa}**.

**Botão da fonte**
> `Ver relatório original na {instituição}`
> (subtexto quando `acessoLivre === false`) `O acesso pode exigir login de cliente da instituição.`

**Rótulo do desempenho**
> **Desde a publicação ({dd/mm/aaaa})**
> Variação das cotações dos ativos, ponderada pelos pesos publicados. **Não inclui proventos.**

**Rótulo do benchmark**
> **IBOV no mesmo período** — medido pelo ETF **BOVA11**, na mesma janela e na mesma base.

**Nota de método (rodapé do card de desempenho)**
> Cálculo do Lastro a partir de **fechamentos reais** dos ativos, mantendo fixos os pesos
> publicados (sem rebalanceamento). Onde falta o fechamento de um ativo, ele fica **fora do
> cálculo** e o peso é redistribuído entre os demais — a cobertura é sempre informada.
> Resultados passados não garantem retornos futuros.

**Chip de cobertura parcial**
> `Cálculo cobre {X}% do peso ({n} de {m} ativos)`

**Quando a cobertura é insuficiente (< 70%)**
> Não há fechamentos suficientes para medir o desempenho desta carteira com honestidade.
> Exibimos apenas a composição publicada.

**Bloco de atribuição/disclaimer (fixo no detalhe)**
> **Sobre esta carteira**
> A composição acima foi **publicada por {instituição}** em **{dd/mm/aaaa}**, com referência
> a **{mês/ano}**, e está disponível publicamente em **{domínio da fonte}**. Os direitos sobre
> o conteúdo original são da instituição.
> O **Lastro não elabora, não endossa e não recomenda** esta carteira: apenas a apresenta e
> calcula indicadores (setores, peso, DY médio, desempenho) a partir de **cotações e
> fundamentos públicos**. Nada aqui é recomendação de investimento, análise de valores
> mobiliários ou consultoria personalizada — não considera seu perfil, seus objetivos nem
> sua situação financeira. Antes de investir, **consulte o relatório original** e, se
> precisar, um profissional certificado.

**Rodapé da composição**
> Pesos exatamente como publicados pela fonte. Soma: **{soma}%**.
> *(quando `pesoUniforme`)* A fonte publica **pesos iguais** entre os ativos.

**Estado vazio da lista**
> **Nenhuma carteira disponível ainda** — assim que novas composições públicas forem
> publicadas, elas aparecem aqui.

**Rótulo de ativo não resolvido**
> `Ativo não localizado na base — fora dos cálculos`

---

## 5. Navegação e gate

**Entradas (o menu Mais perdeu o item quando a feature foi aposentada):**
1. **Menu "Mais" → nova seção "Conteúdo"** (antes de "Conta"), em `viewMais()` (l.10312),
   no array `GROUPS`:
   ```js
   {t:'Conteúdo', items:[
     ['carteirasinst','fa-building-columns','Carteiras de instituições',0,
      'Composições públicas de BTG, XP e outras casas'],
   ]}
   ```
   (`prem = 0` → sem pílula PRO no menu: a **entrada** é gratuita; o gate é interno.)
   A busca `filterMais` (l.10359) já indexa por `textContent` — funciona sem alteração.
2. **Hub Mercado** (`viewMercado`, l.10368): card de destaque "Carteiras de instituições",
   que é onde o usuário procura conteúdo de mercado. `VIEW_TAB` mapeia as duas views para a
   aba **Mercado** (coerente com esse posicionamento).
3. **Busca global (⌘K):** Fase 2 — `searchPool()` hoje só indexa ativos; incluir carteiras
   exige generalizar o pool. Não é bloqueante.

**Gate (free × Pro) — recomendação:**

| Bloco | Free | Premium |
|---|---|---|
| Lista de carteiras (instituição, nome, competência, data, nº de ativos) | ✅ | ✅ |
| **Link para a fonte** | ✅ (sempre — é a atribuição; nunca pagar para ver a origem) | ✅ |
| Composição (ticker, nome, peso, cotação, variação) | ✅ | ✅ |
| Rosca por setor | ✅ | ✅ |
| **Desempenho desde a publicação vs IBOV** (faixa + gráfico) | 🔒 `premiumPresentation('carteirasinst')` | ✅ |
| DY/P-L/P-VP médios ponderados, HHI/concentração | 🔒 | ✅ |
| Histórico de composição (mês a mês) | 🔒 | ✅ |

Racional: o que é **público** (composição, fonte) fica público — é o gancho de aquisição e
evita a leitura de "pedágio sobre conteúdo de terceiro". O que é **trabalho de cálculo do
Lastro** (desempenho real vs IBOV, indicadores ponderados, série histórica) é Premium.
Tier **Premium**, não Pro: a feature é de descoberta/mercado, não de carteira própria
(`isPro()`, l.5413, e não `isProTier()`).

Implementar com **`PREMIUM_FEATURES.carteirasinst`** (l.5417):
```js
carteirasinst:{ name:'Desempenho das carteiras públicas', icon:'fa-building-columns',
  desc:'Veja como cada carteira publicada por BTG, XP e outras casas se comportou desde a publicação, comparada ao IBOV — calculado de fechamentos reais.',
  why:'A composição é pública; o cálculo honesto do desempenho é do Lastro.' }
```
Gate por bloco (não pela view inteira): não entra em `PREMIUM_VIEWS` (l.5466) — a view é
gratuita e só os cards derivados chamam `isPro()`/`premiumPresentation`.

---

## 6. Plano faseado

| # | Entrega | Especialista | Esforço | Risco | Verificar |
|---|---|---|---|---|---|
| **0** | **Decisões do dono:** direito de uso validado; 2–3 instituições-piloto escolhidas; quem alimenta o JSON | **Ramon/Mikael** | — | 🔴 **bloqueante** | jurídico OK por escrito antes de qualquer publicação |
| **1** | `/data/carteiras.json` (schema §1.2) + `test/carteiras.mjs` (§1.3) + entrada em `vercel.json` headers | backend | S | 🟢 | `node --test test/*.mjs` verde; JSON acessível em `/data/carteiras.json` |
| **2** | Loader + resolução: `loadCarteirasIndex()`, `cartSetorOf`, `cobertura()`, `carteiraConc()` | frontend + finance | S | 🟢 | HHI/top5 conferidos à mão numa carteira de teste |
| **3** | **Lista** `viewCarteirasInst()` + `PAGES` + `render`/`afterRender`/`VIEW_TAB` + entradas no Mais e no hub Mercado | frontend | M | 🟢 | claro/escuro, iOS, `CSS chaves: 0 \| JS: OK` |
| **4** | **Detalhe** — cabeçalho + composição + rosca (`donutChart`/`donutLegend`) + `screenSymbols` cases + `loadUsQuotes` | frontend | M | 🟡 cotações não chegarem à tela nova | cotação e variação vivas na composição; soma dos pesos correta |
| **5** | **Desempenho vs IBOV**: `loadCarteiraHistory`, fórmula §2.4, `initCarteiraInstChart`, todas as degradações | finance + frontend | **L** | 🟠 maior risco técnico (cobertura, split, janela) | conferir 1 carteira à mão contra planilha; forçar cobertura baixa e ver o app **recusar** o número |
| **6** | Indicadores ponderados (DY/P-L/P-VP) + `loadAssetLive` com concorrência limitada + `TERM_CARDS.hhi` | finance + frontend | M | 🟡 volume de requisições a `/api/asset` | DY ponderado bate com cálculo manual; cobertura exibida |
| **7** | Gate Premium (§5) + `PREMIUM_FEATURES.carteirasinst` | frontend | S | 🟢 | free vê composição, não vê desempenho; Premium vê tudo |
| **8** | Textos, atribuição e disclaimer (§4) + `docs`/`HANDOFF` | architect + review | S | 🟢 | textos idênticos aos da §4 |
| **9** | Auditoria + evidência | review → qa | M | 🟢 | diff sem segredo; screenshots claro/escuro, iOS 390px; estados: vazio, erro de fetch, cobertura baixa, ativo inexistente |
| **10** | *(Fase 3, opcional)* histórico de composição; total return com proventos; sobreposição com a carteira do usuário; migração para Supabase | — | L | 🟡 | — |

**Limpeza que cabe junto (dívida da aposentadoria):** o modal órfão `#carModal`
(`index.html` l.1191–1196, com `carTitle`/`carBody`) não tem mais `openCarteira()`; só sobra
a chamada defensiva `typeof closeCarteira==='function' && closeCarteira()` na l.14218.
Ou **remover** o bloco, ou **reaproveitar** como modal de "ver composição rápida" a partir da
lista. Decidir na Fase 3/4 — não deixar código morto.

**Exige ação do dono (não é engenharia):**
1. **Direito de uso** — republicar a composição (ativos + pesos) é o miolo do relatório.
   O caminho defensável descrito em `docs/plans/pendencias-manuais.md` é *instituição + data +
   link*. Esta spec vai além (mostra a composição) — **precisa de validação jurídica** ou de
   um programa de parceria/afiliado que autorize. **Não publicar sem isso.**
2. **Fonte** — indicar 2–3 instituições cujo relatório seja **acessível sem login**.
3. **Cadência** — assumir a atualização mensal (§1.4) e quem faz.
4. **Textos** — aprovar os disclaimers da §4 (é o que protege o produto).

**Fora de escopo desta spec:** ingestão automática/parsing de PDF; qualquer ranking entre
instituições; notificação de mudança de carteira; execução/replicação de ordens; total return
com proventos (Fase 3); tradução do relatório.

---

## 7. Referências rápidas de código (`/home/user/lastro/index.html`)

| Símbolo | Linha | Uso nesta feature |
|---|---|---|
| `PAGES` | 5344 | registrar as 2 views |
| `PREMIUM_FEATURES` / `premiumPresentation` / `proGate` / `isPro` | 5417 / 5435 / 5461 / 5413 | gate por bloco |
| `nav` / `render` / `goView` | 6936 / 7018 / 7090 | roteamento |
| `VIEW_TAB` / `syncTabBar` | 7002 / 7009 | aba Mercado |
| `emptyState` | 7714 | estados vazios |
| `loadUsQuotes` | 7505 | cotação de ativos EUA |
| `viewMais` (`GROUPS`) | 10312 | entrada no menu |
| `viewMercado` | 10368 | card no hub |
| `afterRender` | 10526 | hooks de chart/fetch |
| `HIST_CLOSE` / `histSaveClose` / `closeOn` | 10982 / 10984 / 10986 | fechamentos reais |
| `WHIST_RANGE` / `loadPortfolioHistory` | 10990 / 10991 | molde do `loadCarteiraHistory` |
| `viewBacktest` / `initBacktest` | 11478 / 11510 | molde do gráfico de linha |
| `rxClasseOf` / `rxSetorOf` / `diversificationGrade` | 11531 / 11532 / 11533 | setor e concentração (sem a nota) |
| `.rx-asset` (markup) / `CHART_PALETTE` | 11591 / 11601 | lista de composição e paleta |
| `ASSET_CLASS` / `assetLookup` / `curOf` / `fmtCur` / `assetLogo` / `segOf` | 11985 / 11993 / 12004 / 12005 / 12078 / 12030 | resolução de ativo |
| `avatarColor` / `avatarInitials` | 12027 / 12028 | avatar da instituição |
| `applyAssetLive` / `loadAssetLive` / `isUsAsset` / `loadUsDetail` | 12601 / 12649 / 12670 / 12703 | fundamentos |
| `currentAssetTk` / `prevView` | 12743 | padrão de estado de detalhe |
| `TERM_CARDS` / `termLabel` | 12981 / 13008 | termo clicável (`dyMed`, novo `hhi`) |
| `donutLegend` / `donutChart` | 13748 / 13887 | **rosca de setores (órfãos reaproveitados)** |
| `quickView` / `goBack` | 14141 / 14148 | navegação para o ativo e volta |
| `screenSymbols` / `applyQuotes` / `refreshQuotes` | 14269 / 14307 / 14353 | **2 cases novos** e cotação ao vivo |
| `#carModal` (HTML órfão) | 1191–1196 | remover ou reaproveitar |
| `lib/history.js` (`close ?? adjustedClose`) | l.63 | risco de split — decidir |

> Linhas conferidas em ago/2026; usar `Grep` pelo nome da função antes de editar.
