# Auditoria de VERACIDADE — dados das ações (31 tickers curados)

> **Escopo:** o que cada tela mostra para uma ação, de onde vem cada número, e o que
> aparece quando a fonte falha. Não é auditoria de layout.
> **Data:** ago/2026 · **Base:** `index.html` (14.933 linhas), `api/*`, `lib/*`.
> **Limite deste ambiente:** acesso externo bloqueado (brapi/FMP/BCB/CVM). **Nenhuma
> comparação com o preço real de mercado foi feita** — as conclusões vêm da leitura do
> código: o que é constante, o que é buscado, e o que sobra quando a busca falha.
> **Nenhum código de produto foi alterado.** Validação: `CSS chaves: 0 | JS: OK` ·
> `node --test test/*.mjs` → **174/174**.

---

## 0. Resumo executivo (o que Ramon precisa saber antes do beta)

Confirmado o ponto de partida: `const ACOES` (l. 4621-4653) tem **31 ações**, cada uma com
**9 campos chumbados** (`px, pl, pvp, dy, roe, mgl, var, consist, liq`). `const FUND`
(l. 4666-4691) cobre **10 das 31** ações (+ 12 FIIs).

A boa notícia: **a matemática da carteira é honesta**. `portfolioByTicker()` (l. 5028-5034)
tem a guarda `g.priceLive = !!(a.live && a.px>0)` — sem cotação ao vivo confirmada, a
posição é avaliada **ao custo**, nunca contra o preço-semente. Proventos recebidos vêm
**só** de `ASSET_LIVE[tk].dividends` (real), com estado "apurando…"/"indisponível" em vez
de estimativa. Isso está certo e deve ser preservado.

A má notícia, em ordem de gravidade:

| # | Achado | Gravidade |
|---|---|---|
| 1 | **O selo de origem do dado não existe no DOM.** `setDataStatus()` procura `#dataStatus`, que **não está no HTML** → sai na primeira linha. "Ao vivo", "Offline · em cache" e "Demonstração" são calculados e **nunca exibidos**. O usuário não tem como saber se o preço é de hoje ou de 2025. | **Crítico** |
| 2 | **Score Lastro™ congelado na semente.** `ACOES.forEach(a=>a.score=scoreLastro(a))` roda uma vez no boot, e `scoreOf()` retorna `a.score` antes de qualquer recálculo. Nenhuma função ao vivo (`applyQuotes`, `loadListFundamentals`, `applyAssetLive`) toca `a.score`. **O veredito do card de decisão nunca muda, mesmo com dados reais na tela.** | **Crítico** |
| 3 | **`consist` e `liq` são 100% inventados e nunca têm fonte.** Nenhum endpoint escreve neles. Mesmo assim aparecem como número: Checklist ("78% de consistência"), pilar "Consistência" do card de decisão, filtro "Liquidez mínima **X mi**", ordenação "Maior liquidez". | **Crítico** |
| 4 | **Derivados híbridos: preço AO VIVO ÷ múltiplo CHUMBADO.** `vpa=a.px/a.pvp`, `lpa=a.px/a.pl` (l. 13336) e o preço justo (Bazin/Graham, `fairValueHTML`) misturam duas épocas e produzem um número que nunca existiu. É apresentado como "margem de segurança". | **Crítico** |
| 5 | **`sanePrice()` ancora a guarda anti-outlier no preço-semente.** `a._base = a.px` captura a semente na 1ª cotação; qualquer preço real fora de **0,2× a 5×** da semente é **descartado em silêncio** (só `console.warn`) e a semente permanece. | **Alto** |
| 6 | **Cabeçalho do ativo, busca (⌘K), watchlist, tabela de pares e hub Mercado exibem `px`/`var` sem checar `a.live`.** O rótulo é "Cotação" e "% hoje", sem ressalva. | **Alto** |
| 7 | **Hub Mercado: "Ibovespa 168.619 +0,61%" é constante do código**, nunca atualizada (`loadMacroReal` só cobre SELIC/IPCA/Dólar/Bitcoin). E "No dia: N altas · M baixas" conta `a.var` das 31 sementes. | **Alto** |
| 8 | **`FUND_LOADED.add(tk)` antes do fetch:** uma falha transitória do `/api/fundamentals` marca o ticker como "já carregado" e **nunca mais tenta na sessão** — os múltiplos chumbados ficam na tela até o usuário dar reload. | **Alto** |
| 9 | **Min/Máx 52 semanas e "Variação 12m"** caem em `genSeries()` (série pseudoaleatória determinística) **sem rótulo** quando `/api/asset` não traz histórico. | **Alto** |
| 10 | Checklist converte **ausência de dado em meio ponto** (`pct=(pass+warn*0.5)/n`): uma ação sem `FUND` e sem API ganha ~20 pontos de "qualidade" só por não ter dado. | **Médio** |

**Código morto perigoso (não exibe hoje, mas está a um `#id` de voltar):**
`rxRecommendations()` (lista "Adicionar/Reduzir" ordenada pelo score congelado — além de
veracidade, é o mesmo problema regulatório que aposentou as Carteiras Recomendadas),
`lastroScores()` (Índice de Equilíbrio / Sono Tranquilo), `renderDiag()`/`scoreMed`
("fundamentos médios ponderados de X/100"), `topMovers()` (Maiores altas/baixas),
`heroIndices()`, `indexSeries()`/`ohlcFrom()` (candles sintéticos do índice). Nenhum tem
ponto de chamada ou elemento no DOM hoje — **verificado**.

---

## 1. Inventário por tela

Legenda de origem: **VIVO** = vem de endpoint · **SEMENTE** = constante em `ACOES`/`FUND` ·
**DERIVADO** = calculado · **HÍBRIDO** = mistura vivo com semente.

### 1.1 Listagem de Ações (`viewAssets('acoes')` → `renderAssets`, l. 7847-7900)

| Campo exibido | Origem | Função / linha | Se a fonte falhar |
|---|---|---|---|
| Ticker, Nome, Setor | SEMENTE (curados) / VIVO (`/api/universe`) | `mergeUniverse` l. 14808 | mantém curado |
| **Cotação** | VIVO `/api/quotes` → `applyQuotes` l. 14727 | `screenSymbols` case `'acoes'` busca **as 31 + universo** | **mostra `px` semente sem marcação** |
| **P/L, P/VP, DY, ROE** | VIVO `/api/fundamentals` → `loadListFundamentals` l. 7659-7667 | só as **30 linhas da página atual** | **mostra os múltiplos semente sem marcação; não retenta na sessão** (bug `FUND_LOADED`) |
| Badge "DY x%" sob o ticker | mesmo `a.dy` (arredondado a 0 casas) | l. 7885 | idem |
| **Var. hoje** | VIVO `applyQuotes` (`q.change`) | l. 14727 | **mostra `var` semente como "hoje"** |
| Filtro "Liquidez mínima X mi" | **SEMENTE pura** (`a.liq`, escala 34-50, sem unidade real) | l. 7621, 7858 | — (nunca teve fonte) |
| Filtros DY/P-VP/P-L/ROE | HÍBRIDO (filtram o que estiver em memória) | l. 7854-7857 | filtram por semente |
| Presets "Dividendos/Qualidade/Barganha" | DERIVADO dos filtros acima | l. 7639-7641 | idem |

> Nota: as colunas de ação **sempre imprimem número** (`pc(a.pl,1)+'x'`), diferente de
> Stocks EUA, que já usa `typeof a.pe==='number' ? … : '—'`. Para os itens do universo
> remoto (sem múltiplos), sai `—x` / `—%`.

### 1.2 Hub Mercado (`viewMercado`, l. 10595-10668)

| Campo | Origem | Linha | Se falhar |
|---|---|---|---|
| **"Ibovespa 168.619 · +0,61%"** | **SEMENTE PURA** (`MARKET[0]`, l. 5166) — nenhuma função atualiza | 10634 | sempre igual, para sempre |
| "Dólar R$ 5,18" | VIVO (BCB série 1) via `loadMacroReal` l. 11087 | 10635 | cai na semente 5,18 |
| **"No dia: N altas · M baixas"** | DERIVADO de `a.var` de todo `ACOES` | 10629-10630 | conta as **31 sementes** (29 positivas / 2 negativas) + universo |
| "Vistos recentemente" (chip %) | `x.a.var` | 10625 | semente |
| Contagem por classe | `ASSET_CFG[k].data().length` | 10608 | real |

> `usdBrlRate()` (l. 12259) lê o mesmo `MARKET['Dólar']`, com **fallback fixo 5,18**.
> Toda conversão de ativo dolarizado na carteira usa essa taxa.

### 1.3 Busca global ⌘K (`runSearch`, l. 12227-12237)

| Campo | Origem | Se falhar |
|---|---|---|
| Cotação + Var % de **todo** ativo listado | `searchPool()` → `a.px`/`a.var` crus | **semente sem qualquer marcação**. A busca abre sem disparar cotação: abrir ⌘K logo após o boot mostra `PETR4 R$ 41,84 +1,85%`. |

### 1.4 Watchlist (`viewWatchlist`, l. 8145-8171)

| Campo | Origem | Se falhar |
|---|---|---|
| Cotação, Var % | VIVO (`screenSymbols` case `'watchlist'` **busca** os tickers) | semente sem marcação |

### 1.5 Página do ativo — cabeçalho (`viewAssetDetail`, l. 14246-14277)

| Campo | Origem | Linha | Se falhar |
|---|---|---|---|
| Nome, Classe | SEMENTE / VIVO (`/api/asset` profile) | 14259 | curado |
| Setor/subsetor | `f.setor` → VIVO `applyAssetLive` l. 12846 | 14260 | **as 10 com FUND mostram o setor chumbado; as 21 mostram `a.seg`** |
| **Cotação (`fmtPx`)** | VIVO `/api/quotes` (`screenSymbols` case `'asset'`) | 14263 | **`px` semente, sem selo** |
| **"±x% hoje"** | VIVO `applyQuotes` | 14264 | **`var` semente rotulado "hoje"** |

### 1.6 Aba Visão Geral (`tabGeral`, l. 13715-13745)

| Bloco | Campo | Origem | Se falhar |
|---|---|---|---|
| `summaryCards` (l. 13484) | Valor de mercado | `f.mkt` VIVO (`/api/fundamentals` ou `/api/asset`) | `—` honesto |
| | P/L, DY, ROE, P/VP | VIVO ou **SEMENTE** | número semente, sem marcação |
| | Valor de firma | `f.ev` — VIVO; nas 10 com FUND, **chumbado** | `—` (21) / chumbado (10) |
| `decisionCard` (l. 13563) | **Veredito** ("Ativo de alta qualidade…") | **SEMENTE congelada** (`a.score`) | nunca muda |
| | Pilar Valuation | `a.pl` + `a.pvp` | semente |
| | Pilar Dividendos | `a.dy` | semente |
| | Pilar Rentabilidade | `a.roe` | semente |
| | Pilar Solidez | `f.dleb` VIVO; **fallback = `a.score` congelado** (l. 13512) | "Sólida/Ok/Frágil" da semente |
| Gráfico de cotação | VIVO `/api/asset` history → `PRICE_SERIES` | `genSeries` placeholder, **rotulado** "Série estimada" (l. 12957) ✔ |
| **Mín/Máx 52 semanas** | VIVO (`live.week52Low/High` ou série real) | **`genSeries` sem rótulo** (l. 13720) ✘ |
| **"Variação 12m"** | idem | **`genSeries` sem rótulo** ✘ |
| `keyStatsHTML` (l. 13655) | EV/EBITDA, ROIC, ROA, margens, dívida, payout, CAGR, LPA, VPA | `FUND[tk]` — VIVO ou chumbado (10) | **card some inteiro se `rows.length<3`** ✔ |
| `peersHTML` (l. 13398) | **Cotação, P/L, DY dos pares** | `ACOES` cru | **pares nunca são cotados nesta tela** (`screenSymbols` case `'asset'` só adiciona o ativo aberto) → **tabela de pares mostra preço-semente ao lado de um cabeçalho ao vivo** |
| `newsHTML` | VIVO (Supabase) | "Sem notícias recentes" ✔ |

### 1.7 Aba Indicadores (`tabIndicadores` → `valuationHTML` + `fundamentalsHTML`, l. 13329-13373)

| Grupo | Campos | Origem | 21 sem FUND, API fora |
|---|---|---|---|
| Valuation | P/L, P/VP, DY | `a.*` | **número semente** |
| | P/EBIT, EV/EBIT, EV/EBITDA, PSR, P/Ativo, Valor de firma | `f.*` | **`—` honesto** ✔ |
| | Valor de mercado | `f.mkt` \|\| `a.mkt` | `—` ✔ |
| Rentabilidade | ROE, Margem líq. | `a.roe`, `a.mgl` | **semente** |
| | ROA, ROIC, Marg. bruta, Marg. EBIT, Giro | `f.*` | `—` ✔ |
| Endividamento | Dív.Líq/EBITDA, Dív.Líq/PL, Liq. corrente | `f.*` | `—` ✔ |
| Cresc. & Div. | CAGR receita/lucro, Payout | `f.*` | `—` ✔ |
| **Por ação** | **VPA = `a.px/a.pvp`, LPA = `a.px/a.pl`** | **HÍBRIDO** | **número que mistura preço vivo com múltiplo velho** ✘ |
| `valuationHTML` | Preço-teto Bazin, Graham, margem % | **HÍBRIDO** (`a.px`×`a.dy`; √(22,5·LPA·VPA)) | ✘ |
| Selo de estado ("Saudável/Neutro/Atenção/Crítico") | `indState()` sobre o valor acima | herda a origem | rotula a semente como "Saudável" |

### 1.8 Aba Checklist (`checklistItems`, l. 13949-13977)

10 critérios fixos. Para uma ação **sem FUND e sem API**:

| Critério | Fonte | Resultado |
|---|---|---|
| Preço/Lucro razoável | `a.pl` | avalia **semente** |
| Perto do valor patrimonial | `a.pvp` | semente |
| Empresa rentável (ROE) | `a.roe` | semente |
| Margem líquida saudável | `a.mgl` | semente |
| Paga bons dividendos | `a.dy` | semente |
| **Histórico de resultados consistente** | **`a.consist` — inventado, sem fonte** | mostra **"78% de consistência"** |
| ROIC / EV-EBITDA / Dív.Líq-EBITDA / CAGR receita | `f.*` | "Dado indisponível" → **`warn`** |
| **Nota final** | `pct = (pass + warn×0,5)/10` | **4 "dado indisponível" = +20 pontos** |

### 1.9 Aba Proventos / Resultados / Sobre / Documentos

Estas estão **honestas** e servem de referência do padrão a seguir:

| Bloco | Comportamento |
|---|---|
| DY por ano | chip **"real"** (verde) quando `realDyByYear` tem dados; chip **"estimativa · 10 anos"** (dourado) quando cai em `indHistory` ✔ |
| Dividendos por ano / Rendimentos 12m | chip **"estimativa"** quando `ASSET_LIVE.dividends` não chegou ✔ |
| Histórico de proventos (tabela) | real com badge "futuro"; senão `illusNote('Agenda estimada…')` ✔ |
| Receitas e Lucros | "DRE oficial · CVM/brapi" vs `illusNote('Série histórica estimada')` ✔ |
| Balanço patrimonial | só aparece se real ✔ |
| Modal de histórico de indicador | **só abre para DY com série real** ✔ |
| Documentos (CVM) | real, com erro explícito ✔ |
| Sobre | descrição chumbada nas 10 com FUND; texto genérico "Indicadores detalhados em breve" nas 21 ✔ |

### 1.10 Comparador (`initComparador`, l. 9990-10100)

| Campo | Origem | Se falhar |
|---|---|---|
| Cotação, Var. hoje (zona "Referência") | `a.px`/`a.var` | **semente** |
| DY, P/L, P/VP, ROE, Margem líq. (zona com barra + "melhor") | dispara `loadAssetLive(tk)` ✔ | **compara sementes e elege um "vencedor" por indicador, sem avisar** |

### 1.11 Carteira / Início (posições)

| Campo | Origem | Nota |
|---|---|---|
| Valor da posição | **VIVO com guarda `a.live`** → senão **ao custo** | ✔ o modelo correto |
| Lucro / % | idem | ✔ |
| Variação do dia | só com `a.live`; senão **0** | ✔ (l. 11122) |
| Proventos recebidos | **só real** (`ASSET_LIVE.dividends` × cotas na data-com) | ✔ |
| **Renda mensal projetada (`g.mensal`)** | `a.dy`/12 × valor — **`a.dy` pode ser semente** | l. 5046 |
| **`dyMed` da carteira** | média ponderada de `a.dy` — idem | l. 5390 |
| Próximo provento (timeline) | usa o último provento **real** quando existe; senão DY/12, **rotulado "estimado"** | ✔ |

### 1.12 Agenda / Proventos de mercado (`agMarketCard`, l. 10412)

Datas e valores **reais** (chip "data real") ✔ — mas o **"DY 12m"** da linha é
`soma dos proventos reais ÷ a.px`, e `a.px` pode ser a semente. Sob um chip verde
"data real", o percentual pode não ser.

### 1.13 Raio-X (`viewRaioX`)

O que está no ar (`diversificationGrade`, exposição por ativo/setor/classe) usa **pesos
derivados do valor real das posições** — honesto ✔. Os consumidores do score congelado
(`lastroScores`, `rxRecommendations`) **não têm ponto de chamada** — ver §0.

---

## 2. As 31 ações — mapa de exposição

`FUND?` = tem entrada em `const FUND`. `Score` = valor **congelado no boot** a partir da
semente (`scoreOf`: DY 35% · P/VP 30% · ROE 20% · consist 15%) — é ele que decide o veredito
do card de decisão. `Banda `sanePrice`` = faixa de preço real que o app **aceita**; fora
dela a cotação verdadeira é descartada e a semente permanece.

| # | Ticker | FUND? | Score congelado | px semente | Banda aceita (0,2×–5×) | var semente | P/L | P/VP | DY | ROE | Marg. | consist | liq |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PETR4 | ✔ | **89** | 41,84 | 8,37 – 209,20 | +1,85% | 5,2 | 1,1 | 13,8 | 28,4 | 32,1 | 0,78 | 50 |
| 2 | BBAS3 | ✔ | **81** | 18,99 | 3,80 – 94,95 | +0,68% | 4,8 | 0,8 | 10,6 | 17,2 | 24,0 | 0,85 | 48 |
| 3 | VALE3 | ✔ | **83** | 77,58 | 15,52 – 387,90 | +1,07% | 6,3 | 1,0 | 11,2 | 18,7 | 28,5 | 0,80 | 50 |
| 4 | ITUB4 | ✔ | 52 | 39,33 | 7,87 – 196,65 | +0,08% | 8,1 | 1,8 | 9,4 | 20,1 | 26,8 | 0,93 | 50 |
| 5 | BBDC4 | ✔ | 72 | 15,06 | 3,01 – 75,30 | +0,73% | 9,2 | 1,0 | 8,9 | 11,4 | 18,2 | 0,81 | 46 |
| 6 | ABEV3 | ✔ | 42 | 16,25 | 3,25 – 81,25 | +0,06% | 15,2 | 2,3 | 6,8 | 16,1 | 21,4 | 0,88 | 44 |
| 7 | WEGE3 | ✔ | 39 | 42,11 | 8,42 – 210,55 | +2,75% | 32,4 | 11,2 | 2,1 | 35,8 | 17,9 | 0,96 | 42 |
| 8 | PRIO3 | ✔ | 30 | 63,06 | 12,61 – 315,30 | +2,04% | 9,7 | 2,1 | 0,0 | 24,3 | 48,2 | 0,72 | 40 |
| 9 | BPAC11 | ✔ | 39 | 49,14 | 9,83 – 245,70 | **+3,42%** | 10,8 | 1,7 | 4,2 | 19,4 | 33,0 | 0,89 | 38 |
| 10 | RDOR3 | ✔ | 23 | 31,80 | 6,36 – 159,00 | −0,31% | 22,1 | 2,6 | 1,1 | 12,3 | 14,0 | 0,70 | 34 |
| 11 | ITSA4 | ✘ | 71 | 10,20 | 2,04 – 51,00 | +0,49% | 6,5 | 1,1 | 7,8 | 17,5 | **90,0** | 0,90 | 44 |
| 12 | B3SA3 | ✘ | 42 | 12,80 | 2,56 – 64,00 | +0,92% | 14,0 | 3,0 | 4,5 | 22,0 | 55,0 | 0,90 | 46 |
| 13 | SANB11 | ✘ | 59 | 28,50 | 5,70 – 142,50 | +0,34% | 8,0 | 1,2 | 6,5 | 14,0 | 22,0 | 0,82 | 38 |
| 14 | RENT3 | ✘ | 27 | 42,00 | 8,40 – 210,00 | +1,21% | 18,0 | 2,4 | 1,5 | 14,0 | 18,0 | 0,85 | 42 |
| 15 | RADL3 | ✘ | 29 | 24,50 | 4,90 – 122,50 | +0,42% | 26,0 | 4,5 | 1,0 | 17,0 | 5,0 | 0,90 | 40 |
| 16 | RAIL3 | ✘ | 23 | 19,80 | 3,96 – 99,00 | +0,83% | 22,0 | 2,1 | 1,2 | 10,0 | 20,0 | 0,78 | 38 |
| 17 | SUZB3 | ✘ | 34 | 58,00 | 11,60 – 290,00 | +1,05% | 7,0 | 1,6 | 2,5 | 20,0 | 28,0 | 0,80 | 42 |
| 18 | KLBN11 | ✘ | 38 | 21,50 | 4,30 – 107,50 | +0,58% | 9,0 | 1,8 | 5,0 | 18,0 | 22,0 | 0,82 | 36 |
| 19 | GGBR4 | ✘ | 65 | 18,20 | 3,64 – 91,00 | +0,71% | 7,5 | 0,9 | 6,0 | 12,0 | 14,0 | 0,78 | 40 |
| 20 | CSNA3 | ✘ | 62 | 12,10 | 2,42 – 60,50 | +1,12% | 8,0 | 0,8 | 5,5 | 11,0 | 16,0 | 0,70 | 38 |
| 21 | ELET3 | ✘ | 52 | 42,30 | 8,46 – 211,50 | +0,54% | 9,0 | 0,7 | 2,0 | 8,0 | 25,0 | 0,72 | 44 |
| 22 | TAEE11 | ✘ | 56 | 36,50 | 7,30 – 182,50 | +0,21% | 8,5 | 2,2 | 9,5 | 26,0 | 60,0 | 0,90 | 36 |
| 23 | EGIE3 | ✘ | 50 | 41,00 | 8,20 – 205,00 | +0,33% | 9,5 | 2,8 | 7,0 | 30,0 | 35,0 | 0,90 | 34 |
| 24 | SBSP3 | ✘ | 29 | 92,00 | 18,40 – 460,00 | +1,34% | 12,0 | 1,8 | 2,0 | 15,0 | 22,0 | 0,82 | 42 |
| 25 | EQTL3 | ✘ | 30 | 33,80 | 6,76 – 169,00 | +0,74% | 11,0 | 1,9 | 1,5 | 17,0 | 20,0 | 0,85 | 40 |
| 26 | VIVT3 | ✘ | 48 | 52,00 | 10,40 – 260,00 | +0,22% | 15,0 | 1,3 | 5,5 | 9,0 | 14,0 | 0,85 | 36 |
| 27 | MGLU3 | ✘ | 17 | 9,50 | **1,90** – 47,50 | +2,51% | 30,0 | 1,5 | 0,0 | 5,0 | 2,0 | 0,55 | 44 |
| 28 | LREN3 | ✘ | 29 | 16,80 | 3,36 – 84,00 | +0,91% | 14,0 | 2,0 | 2,5 | 14,0 | 9,0 | 0,80 | 40 |
| 29 | JBSS3 | ✘ | 32 | 32,00 | 6,40 – 160,00 | +0,63% | 9,0 | 1,7 | 3,5 | 16,0 | 5,0 | 0,72 | 40 |
| 30 | HAPV3 | ✘ | 37 | 4,20 | **0,84** – 21,00 | +1,52% | 28,0 | 1,1 | 0,0 | 4,0 | 6,0 | 0,60 | 42 |
| 31 | TOTS3 | ✘ | 34 | 32,50 | 6,50 – 162,50 | −0,52% | 28,0 | 6,0 | 1,5 | 22,0 | 14,0 | 0,85 | 38 |

**Todas as 31 estão expostas** ao mesmo risco de preço/variação (nenhuma tem tratamento
diferente). O que muda entre elas:

- **10 com FUND** — a página do ativo fica *cheia* mesmo com a API fora, mas o que a
  preenche são **valores chumbados** (EV/EBITDA, ROIC, dívida, payout, CAGR, descrição da
  empresa, nº de ações, governança, tag along, free float, série de dividendos 2021-2025).
  **Pior cenário do que as 21**: parece dado, não é.
- **21 sem FUND** — a grade de Indicadores mostra `—` honesto nos campos profundos e o
  card "Estatísticas do ativo" **some** (`rows.length<3`). O que resta chumbado é o núcleo
  `pl/pvp/dy/roe/mgl` (que a listagem/`applyAssetLive` podem sobrescrever) + `consist`/`liq`
  (que **nunca** são sobrescritos).
- **Nenhum lugar transforma ausência em zero.** As médias de setor
  (`sectorAvg`/`marketAvg`, l. 13148-13149) filtram `isFinite` antes de somar ✔ — porém
  **misturam** tickers já atualizados ao vivo com tickers ainda na semente, sem declarar
  cobertura. O texto de `indAnalysis` ("está **acima** da média do setor (Bancos: 7,5x)")
  é apresentado como análise.
- **Bandas críticas do `sanePrice`:** MGLU3 (rejeita real < R$ 1,90) e HAPV3 (rejeita real
  < R$ 0,84) são as mais estreitas por baixo; papéis de baixo valor unitário são os que
  correm risco de a cotação verdadeira ser descartada.

---

## 3. Coerência entre telas — divergências possíveis

Como listagem e página do ativo compartilham **o mesmo objeto** de `ACOES`, não há dois
valores simultâneos do mesmo campo. As divergências reais são estas:

| # | Divergência | Causa |
|---|---|---|
| 1 | **Mesma tela, duas épocas:** na página de PETR4, o cabeçalho mostra preço ao vivo e a tabela "Comparação no mesmo setor" mostra PRIO3 com o preço-semente. | `screenSymbols` case `'asset'` cota **só o ativo aberto** (l. 14697-14701) |
| 2 | **DY muda de valor ao navegar.** A listagem escreve `a.dy` com `summaryDetail.dividendYield` (`/api/fundamentals`); a página do ativo escreve `a.dy` com `fund.dy` (`/api/asset`). São endpoints diferentes; **o último a responder vence** e o novo valor volta para a listagem. | `loadListFundamentals` l. 7665 vs `applyAssetLive` l. 12831 |
| 3 | **Ibovespa em dois lugares, duas fontes.** Hub Mercado: `168.619 +0,61%` (constante). Início → Performance Diária: variação do **BOVA11 ao vivo**. Vão discordar todo dia. | l. 10634 vs l. 11136 |
| 4 | **Preço no ⌘K ≠ preço na listagem.** A busca não dispara cotação; a listagem sim. Abrir a busca antes de visitar Ações mostra a semente; depois, o valor vivo. | `runSearch` l. 12227 |
| 5 | **"P/L" da listagem vs "P/L" do Comparador.** O Comparador chama `loadAssetLive`; a listagem chama `/api/fundamentals`. Se um responder e o outro não, o mesmo ticker tem múltiplo diferente conforme por onde você entrou. | l. 10004 vs l. 7655 |
| 6 | **Carteira × resto do app.** A Carteira avalia ao custo sem `a.live`; a listagem exibe a semente. O mesmo ativo aparece com preço A na Carteira (custo) e preço B (semente) na tela de Ações. | intencional na Carteira (correto), inconsistente fora dela |

---

## 4. Contas que consomem campo chumbado

| Conta apresentada como análise | Fórmula | Insumo chumbado | Onde |
|---|---|---|---|
| **Score Lastro™ (congelado)** | `min(35·min(DY/15,1) + 30·f(P/VP) + 20·min(ROE/25,1) + 15·consist, 100)` | **todos**, e nunca recalcula | `scoreOf` l. 4573; congelado em l. 4654 |
| **Veredito do card de decisão** | faixas do score (≥80 / ≥65 / ≥50) | idem | `assetInsights` l. 13533 |
| **Pilar Solidez** (sem `f.dleb`) | score ≥70 → "Sólida"; <50 → "Frágil" | score congelado | l. 13512 |
| Pilares Valuation / Dividendos / Rentabilidade | faixas de `a.pl`, `a.pvp`, `a.dy`, `a.roe` | semente até a API responder | `dimRatings` l. 13493-13508 |
| **Preço-teto Bazin** | `px × (DY/100) ÷ (alvo/100)` | HÍBRIDO px vivo × DY velho | `fairValueHTML` l. 13545 |
| **Preço justo Graham** | `√(22,5 × LPA × VPA)`, com `LPA=px/P-L` e `VPA=px/P-VP` | HÍBRIDO | l. 13548-13549 |
| **"% de margem de segurança"** | `(justo − px)/px` | HÍBRIDO ao quadrado | l. 13553 |
| **VPA e LPA (aba Indicadores)** | `px/pvp`, `px/pl` | HÍBRIDO | l. 13336, `indVal` l. 13141 |
| **Nota do Checklist (0-100%)** | `(pass + warn×0,5)/10` | `consist` inventado + ausência valendo 0,5 | l. 13981 |
| **"% de consistência" (Checklist)** | `a.consist × 100` | **inventado, sem fonte** | l. 13974 |
| **Média do setor / percentil** | média de `indVal` dos pares do setor | mistura vivo + semente, sem declarar cobertura | `sectorAvg` l. 13148, `indAnalysis` l. 13159, `indInsights` l. 13264 |
| **"Melhor" de cada indicador (Comparador)** | max/min entre os selecionados | semente se `/api/asset` falhar | l. 10068 |
| **Filtro "Liquidez mínima X mi"** | `a.liq >= X` | **inventado** | l. 7858 |
| **"N altas · M baixas" (hub)** | contagem de `a.var` | semente | l. 10630 |
| **Renda mensal / `dyMed` da carteira** | `val × dy/100 ÷ 12` | `a.dy` semente | l. 5046, 5390 |
| **DY 12m em "Proventos do mercado"** | `Σ proventos reais ÷ a.px` | `a.px` semente, sob chip "data real" | l. 10423 |

---

## 5. Lista priorizada de correção

### A. "Mostra número errado" — grave, corrigir antes do beta

| P | Item | Correção sugerida (mínima) |
|---|---|---|
| **P0** | Selo de origem não existe no DOM | Reinserir `#dataStatus` (ou equivalente por tela). `setDataStatus` já está pronto — falta só o elemento. **Zero risco.** |
| **P0** | `px`/`var` semente exibidos como "Cotação" e "% hoje" | Onde `!a.live`: cabeçalho do ativo, listagem, ⌘K, watchlist, pares, hub. Ou mostrar `—` + "aguardando cotação", ou pintar em cinza com legenda "última referência". |
| **P0** | Score congelado alimenta o veredito | Ou recalcular (`delete a.score` antes de `scoreOf`, ou não gravar `a.score` no boot), ou **não emitir veredito** enquanto `f._live !== true`. |
| **P0** | `consist` (e `liq`) sem fonte, exibidos como % / "mi" | Remover de tela (Checklist, pilar Consistência, filtro de liquidez) até haver fonte. Alternativa: `liq` real vem do `regularMarketVolume` do brapi; `consist` não tem fonte — é candidato a **exclusão**. |
| **P0** | Derivados híbridos (VPA/LPA, Bazin, Graham) | Só calcular quando **px e o múltiplo vierem da mesma resposta** (`FUND[tk]._live===true` e `a.live===true`). Senão, ocultar o bloco de preço justo. |
| **P1** | `sanePrice` ancorado na semente | Ancorar `_base` no **último preço vivo** (não na semente) e, na 1ª cotação, **aceitar sempre**. Manter a guarda só entre ticks ao vivo. |
| **P1** | `FUND_LOADED` marca antes do fetch | Mover o `add` para depois do `res.forEach`, ou remover do set no `catch`/`!r.ok` com backoff. |
| **P1** | Hub Mercado: Ibovespa constante | Trocar por BOVA11 ao vivo (já existe `assetDayVar('BOVA11')`) ou remover a célula. |
| **P1** | "N altas · M baixas" das sementes | Contar só `a.live` (ou só itens do universo com `var` real) e declarar a amostra. |
| **P1** | Comparador elege "melhor" sobre sementes | Se algum comparado não tiver `_live`, esconder as barras de ranking (manter os números com aviso). |
| **P2** | Mín/Máx 52s e Var. 12m sem rótulo | Ocultar quando não houver série real (o gráfico já tem o rótulo "Série estimada"; a barra e o "Variação 12m" não). |
| **P2** | Média do setor mistura épocas | Declarar cobertura ("média de 6 de 9 pares com dado atual") ou só calcular sobre `_live`. |
| **P2** | DY 12m do card "Proventos do mercado" sob chip "data real" | Separar: chip cobre a data; o DY carrega ressalva se `!a.live`. |
| **P2** | `usdBrlRate()` fallback fixo 5,18 | Se o BCB falhar, marcar a conversão como indisponível em vez de usar 5,18 silenciosamente. |

### B. "Não mostra nada" — aceitável se rotulado (nenhuma ação urgente)

- As 21 sem FUND mostram `—` nos campos profundos ✔
- `keyStatsHTML` some com <3 linhas reais ✔
- Aba Proventos/Resultados com chips "real"/"estimativa" ✔ — **é o padrão a replicar**
- `aboutHTML` com texto "Indicadores fundamentalistas detalhados em breve" ✔
- Proventos recebidos em "apurando…"/"indisponível" ✔

### C. Dívida latente (não exibe hoje, remover ou blindar)

`rxRecommendations`, `lastroScores`, `renderDiag`/`scoreMed`, `topMovers`/`moverRow`,
`heroIndices`, `indexSeries`/`ohlcFrom`. Todos consomem semente/RNG e produziriam números
de aparência analítica se reconectados. **Recomendação: apagar** (ou marcar com comentário
`// NÃO REATIVAR: consome dado chumbado`) — o `rxRecommendations` é o mais sensível, pois
recria a recomendação de valores mobiliários já aposentada por decisão regulatória.

### D. Recomendação direta para o beta

Se houver tempo para **uma só** coisa: **P0 do selo + P0 do preço**. Um selo visível
("Ao vivo · 14:32" / "Sem cotação — última referência") resolve simultaneamente os itens
2, 6, 7 e boa parte do 4, porque transforma "número mentiroso" em "número rotulado". É a
menor mudança com o maior ganho de honestidade.

Se houver tempo para **duas**: adicionar o P0 do Score/veredito — porque é a única tela
onde o Lastro **opina**, e opinar sobre número congelado é o pior caso possível.

---

## 6. O que verificar no navegador (produção) — este ambiente não alcança as APIs

1. `https://lastro-dun.vercel.app/api/quotes?symbols=PETR4,MGLU3,HAPV3` → confere se
   `price` chega e se **cai fora da banda** de `sanePrice` (MGLU3 < R$ 1,90, HAPV3 < R$ 0,84).
   Se cair, o app está mostrando a semente. Sinal no console: `[Lastro] cotação ignorada (outlier)`.
2. `.../api/fundamentals?symbols=PETR4,ITSA4,TOTS3` → confere se `pl/pvp/dy/roe/mgl` vêm
   não-nulos. Se vierem `null`, a listagem fica na semente **sem aviso**.
3. `.../api/asset?ticker=TOTS3` → confere `fund`, `history`, `dividends`, `statements`.
   Sem `history`, a barra "Mín/Máx 52 semanas" da Visão Geral é sintética.
4. Abrir o app **em aba anônima** e, **sem passar pela tela de Ações**, apertar ⌘K e digitar
   `PETR4`. Se aparecer `R$ 41,84 · +1,85%`, o achado nº 6 está confirmado em produção.
5. Abrir **Mercado** (hub) e ler a célula Ibovespa. Se disser `168.619 · +0,61%` em qualquer
   dia, o achado nº 7 está confirmado.
6. Abrir a página de **PETR4** e comparar o preço do cabeçalho com o de PRIO3 na tabela
   "Comparação no mesmo setor". Se PRIO3 disser `R$ 63,06`, o achado nº 1 da §3 está confirmado.
7. Abrir **PETR4 → Checklist**. Se a linha "Histórico de resultados consistente" disser
   `78% de consistência`, o achado nº 3 está confirmado (esse número não existe em fonte alguma).

---

## 7. Verificação de integridade desta auditoria

```
CSS chaves: 0 | JS: OK
# tests 174 · # pass 174 · # fail 0
```

`git status` limpo em `index.html`, `api/*` e `lib/*` — **nada de produto foi tocado**.
