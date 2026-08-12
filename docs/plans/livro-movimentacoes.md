# Plano — Livro de Movimentações (extrato tipo corretora)

> Arquiteto: plano faseado para executar com os especialistas. Não é código de produção.
> Base confirmada no `index.html` (jul/2026). Continuação da reconstrução real do patrimônio.

## 0. Resumo executivo

Hoje a carteira é só uma pilha de **lotes de compra** (`CARTEIRA=[{id,tk,cotas,pm,date}]`,
`index.html:3789-3826`). Não existe venda, provento-caixa, saldo em caixa nem evento
societário — então patrimônio e proventos são **estimados**, não reais centavo a centavo.
A recomendação é introduzir um **Livro de Movimentações** (`MOVS=[{id,date,tk,type,...}]`)
como **nova fonte de verdade de eventos**, e transformar `CARTEIRA` numa **camada derivada
(projeção read-only)** reconstruída de `MOVS` por um redutor puro `deriveState(MOVS, D)`.
Assim toda a matemática existente (`portfolioByTicker`/`portfolioStats`/`wealthSeries`)
continua funcionando sem reescrita — passa a consumir lotes derivados, agora com **caixa**.

**MVP recomendado (Fase 1):** `venda` + `provento` (dividendo/JCP/rendimento como caixa) +
`aporte`/`resgate` de caixa. Isso já muda o patrimônio de verdade (realiza lucro, some com
cotas vendidas, soma o caixa recebido) e destrava IR/Proventos reais. Eventos societários
(desdobramento/grupamento/bonificação) e IR realizado (livro fiscal) vêm nas Fases 2 e 3.

**Trade-off central:** manter `CARTEIRA` como projeção (não duplicar estado) evita
divergência, mas exige migração cuidadosa e versionamento do `user_state`. O sync reusa
exatamente o padrão do `carteira` (mesmo blob, mesma RPC `save_state`, last-write-wins) —
**sem novo endpoint** (respeita o limite 11/12 da Vercel). Risco sensível = dinheiro:
proventos automáticos **nunca** entram sozinhos; sempre são **sugestões que o usuário confirma**.

---

## 1. Modelo de dados dos movimentos

### 1.1 Estrutura base (client-side, em `localStorage['lastro_movs']`)

```
MOVS = [{ id, date, type, tk?, ... }]   // date = 'YYYY-MM-DD' local (padrão parseLotDate)
```

Campos comuns: `id` (via `uid()`, `index.html:3802`), `date` (ISO local, `todayISO()`
`:3959`), `type`, `note?` (texto livre), `cur?` (`'brl'|'usd'`, default derivado do ativo
via `ASSET_CLASS`/`a.usd`, ver `portfolioByTicker:3916`). **Tudo monetário em reais no
campo, convertido a centavos na hora do cálculo via `window.LastroMoney`** (`M.toCents`,
`M.positionCents`) — igual à convenção atual.

### 1.2 Tipos e campos

| type | campos específicos | efeito em posição | efeito em caixa |
|------|--------------------|-------------------|-----------------|
| `compra` | `tk, cotas, preco, taxa?` | + cotas (recalcula PM) | − (cotas·preco + taxa) |
| `venda` | `tk, cotas, preco, taxa?` | − cotas | + (cotas·preco − taxa); gera resultado realizado |
| `provento` | `tk, valor, sub('div'\|'jcp'\|'rend'), perCota?, comDate?` | nenhum | + valor (JCP: `valorLiquido` já com 15% IRRF) |
| `desdobramento` | `tk, fator` (ex.: 1→`fator=4`: 1 vira 4) | cotas·fator, PM÷fator | nenhum |
| `grupamento` | `tk, fator` (ex.: 10→1: `fator=10`) | cotas÷fator, PM·fator | nenhum |
| `bonificacao` | `tk, cotas, custoUnit?` | + cotas (recalcula PM pelo custo declarado) | nenhum |
| `aporte` | `valor` | nenhum | + valor (dinheiro entrou na conta) |
| `resgate` | `valor` | nenhum | − valor (dinheiro saiu da conta) |
| `transferencia` | `tk, cotas, preco(custo), sentido('in'\|'out')` | ± cotas | nenhum (custódia, não caixa) |

Notas de campo:
- `preco`/`perCota`/`valor`/`taxa` guardados como **número em unidades da moeda** (reais ou
  dólares), nunca centavos no armazenamento — conversão a centavos só no cálculo.
- `fator` sempre **razão ≥ 1** com o tipo dizendo a direção (evita ambiguidade `4:1` vs `1:4`).
- `venda` guarda `preco` bruto; corretagem em `taxa` (entra no custo/– no resultado).
- `provento` de ação isento (dividendo) vs JCP (tributado na fonte) distinguido por `sub`
  para a aba IR (código 09/10 vs 26 FIIs).

### 1.3 Relação com `CARTEIRA` atual — decisão

**`CARTEIRA` vira projeção derivada, não estado independente.** `MOVS` é a fonte de verdade.

- Redutor puro `rebuildLots(MOVS)` → produz o **mesmo formato** `[{id,tk,cotas,pm,date}]`
  que `portfolioByTicker`/`portfolioStats`/`wealthSeries` já consomem (`:3907,:4308,:8904`).
  Assim **nada dessas funções muda de assinatura** — só passam a receber lotes reconstruídos.
- `savePortfolio()` (`:3801`) deixa de ser a mutação primária; as mutações passam a ser
  `addMov/editMov/removeMov`, que gravam `lastro_movs`, chamam `rebuildLots()` para
  atualizar `CARTEIRA` em memória (compat) e disparam `recordPatSnapshot()`+`saveCloudState()`.
- **Camada de compatibilidade:** enquanto Fase 1 não cobrir 100%, `CARTEIRA` continua
  existindo e `rebuildLots` inclui as compras. `addPosition`/`editLot`/`removeLot`
  (`:3807-3826`) passam a ser *wrappers finos* que criam/editam movimentos `compra`.

---

## 2. Derivação de estado a partir dos movimentos

`deriveState(MOVS, D)` — redutor puro, ordena `MOVS` por `date` (empate: ordem de inserção
`id`), aplica evento a evento até `date<=D`. Tudo em **centavos** via `LastroMoney`.

Retorna:
```
{ posByTk: { [tk]: { cotas, custoCentsNat, pm, lots:[...] } },   // lots p/ compat wealthSeries
  caixaCents,                                                      // saldo em caixa (BRL)
  realizadoCents: { [ano]: {ganho, imposto} } }                  // p/ IR (Fase 3)
```

Regras por evento (posição e PM):
- **compra:** `cotas += q; custoNat += q·preco + taxa; pm = custoNat/cotas`.
- **venda:** baixa cotas pelo **PM vigente (média ponderada)** — padrão CVM/RFB no Brasil,
  não FIFO. `resultado = q·(preco) − q·pm − taxa`. `custoNat -= q·pm; cotas -= q`
  (PM **não muda** em venda). Se `cotas` chega a 0, zera `custoNat`.
- **provento:** posição intacta; PM intacto (dividendo **não** reduz PM na convenção
  brasileira de custo de aquisição). Só entra caixa.
- **desdobramento/grupamento:** `cotas·=fator` (ou `/fator`); `pm/=fator` (ou `·fator`);
  `custoNat` **inalterado** (evento não altera custo total, só o unitário).
- **bonificação:** `cotas += q`; `custoNat += q·custoUnit` (custo declarado no fato relevante,
  em geral baixo) → **reduz o PM**. PM = custoNat/cotas.
- **aporte/resgate:** só caixa.
- **transferência:** ajusta cotas e custoNat pelo custo informado; caixa intacto.

Regras de caixa (`caixaCents`, sempre BRL — converte USD por `usdBrlRate()`/`closeOn('USDBRL')`):
- entra: `provento`, `aporte`, `venda` (líquida de taxa).
- sai: `compra` (com taxa), `resgate`.
- **Saldo pode ficar negativo** e o app apenas sinaliza ("caixa negativo — faltou registrar
  um aporte?"), nunca bloqueia (honestidade > rigidez).

**Patrimônio(D):** estende `wealthSeries` (`:8904`) e `portfolioStats` (`:4308`):
```
patrimonio(D) = Σ posição(tk,D)·closeOn(tk,D)·fx(D)  +  caixaCents(D)
```
- Hoje `wealthSeries` já faz o Σ posições×fechamento por dia (`:8940-8945`). A mudança:
  (1) os lotes por dia passam a vir de `deriveState(MOVS,D).posByTk` (já ajustados por
  eventos societários e vendas — resolve o bug de "vendi e continua na série"); (2) soma
  `caixaCents(D)` ao valor do dia. Como caixa é dinheiro parado, **não precisa de fechamento
  real** → dias que hoje são descartados por falta de cotação (`:8946`) podem ainda plotar a
  parcela de caixa; manter a regra atual (descartar dia sem cotação de posição) na Fase 1
  para não misturar critérios, e reavaliar na Fase 2.
- `portfolioStats().atual` passa a somar `caixaCents`. **Cuidado:** hoje `atual` alimenta o
  snapshot (`recordPatSnapshot:8801`) e o card do Início — somar caixa muda o número exibido
  (correto, mas é mudança visível → validar com QA e comunicar no HANDOFF).
- Tudo permanece em centavos inteiros; nenhuma soma em float nova.

**Substituição/extensão da `wealthSeries`:** não reescrever — injetar `deriveState` como
fonte dos lotes achatados (`flat`, `:8912-8916`) e adicionar termo de caixa. Manter o
fallback `wealthEst` intacto. **Coordenar com os donos** (a nota em `:8968`/HANDOFF avisa que
`wealthSeries/wealthEst/initWealthSpark` são co-editadas).

---

## 3. Preço médio e IR

- **Venda → resultado realizado:** por operação, `resultado = q·preco − q·pm − taxas`.
  Acumular por **mês** e por **classe** (ação vs FII/day-trade) para a apuração:
  - Ações swing: isenção se **total vendido de ações no mês < R$ 20.000**; acima, 15% sobre o
    ganho, compensando prejuízo acumulado (carry-forward mês a mês).
  - FII: 20% sobre o ganho, **sem** isenção; prejuízo de FII só compensa lucro de FII.
  - Guardar o **prejuízo acumulado** por classe no próprio livro derivado (não persistir
    número solto — recalcular de `MOVS` garante consistência entre aparelhos).
- **Desdobramento/grupamento:** ajustam **quantidade e PM** mas **não** geram fato gerador de
  IR (custo total inalterado) — importante não contar como venda.
- **Bonificação:** entra como custo adicional (afeta PM), rendimento isento no ano do evento
  (informar na aba IR como "bonificação" quando aplicável).
- **Conexão com abas existentes:**
  - `viewIR()` (`:7733`): `irBensDireitos()` passa a usar `deriveState(...,'31/12')`
    (posição e custo na data-base, já líquidos de venda). A **Calculadora de DARF** (`runDarf`
    `:7780`) deixa de ser hipotética e ganha um modo "apurar do livro": lê as `venda`s reais do
    mês e mostra DARF devido, isenção 20k e prejuízo compensável. Fase 3.
  - `viewProventos()` (`:7522`) e `groupPayments`/`provPayments` (`:3836,:3856`): proventos
    **reais** (movimentos `provento`) substituem/complementam a projeção. Estratégia: mostrar
    "realizado" (de `MOVS`) como fonte primária e manter a projeção só como *previsão futura*
    rotulada. Yield-on-Cost real passa a bater centavo a centavo.

---

## 4. UX mínima e honesta

Princípio do dono: **menos cliques**. Um só ponto de entrada, formulário que muda por tipo.

- **Botão único "Registrar" / "+"** na Carteira (`viewCarteira:6523`) abre um **modal
  segmentado** por tipo (chips: Compra · Venda · Provento · Evento · Caixa). O form atual de
  Aporte (`viewCarteira` tem o form; `viewAporte:7605` é o *planejador*, não o cadastro) vira
  o caso "Compra" desse modal — reusar `maskBRL`/`parseBRL`/`posPreview`/`fillTickerList`
  (`:3945-3966`) e a validação `validDate` (`:3805`).
- **Campos por tipo** (mínimos, com defaults):
  - Compra/Venda: ativo (autocomplete `posSuggest`), quantidade, preço, data, taxa (opcional,
    recolhível). Venda mostra em tempo real o **resultado** vs PM atual e aviso de isenção 20k.
  - Provento: ativo, valor total (ou por cota × cotas na data-com), tipo (Dividendo/JCP/
    Rendimento), data. Prefill inteligente (ver automação).
  - Evento societário: ativo, subtipo (desdobramento/grupamento/bonificação), fator/cotas.
  - Caixa: valor, sentido (aporte/resgate), data.
- **Extrato (novo bloco na Carteira):** lista cronológica de `MOVS` com ícone/cor por tipo,
  valor, e swipe/menu para **editar/excluir** (reusa padrão de `removeLot`/`editLot`). Filtro
  por ativo e por tipo. Mostra **saldo em caixa** como um "ativo" no topo da carteira.
- **Automação segura (nunca lança sozinho):** para cada ativo com data-com detectada
  (`provRealInfo`/`nextProventoFor`, `:3866,:3879` — já cruzam data-com × lotes com direito),
  gerar **sugestões de provento** ("Recebeu ~R$ X de HGLG11 em 14/07? Confirmar") que o
  usuário aceita com 1 toque → cria o movimento `provento` real. **Regra de ouro: sugestão
  ≠ lançamento.** Nada entra no caixa/patrimônio sem confirmação explícita.
- **Compat da tela de Aporte:** `viewAporte` (planejador de próximo aporte) segue igual;
  quando o usuário confirmar "executei este plano", oferecer criar os movimentos `compra`
  correspondentes (1 clique) — fecha o loop planejar→registrar.

---

## 5. Migração

- **Versionamento do blob:** adicionar `schema: 2` ao `cloudPayload()` (`:5127`) e a
  `lastro_state_ts`. Ausência de `schema` (ou `<2`) = estado legado (só `carteira`).
- **Migração local (idempotente), roda 1x ao carregar:**
  `if(!localStorage.lastro_movs){ MOVS = CARTEIRA.map(lot => ({id:lot.id||uid(), type:'compra', tk:lot.tk, cotas:lot.cotas, preco:lot.pm, date:lot.date||todayISO()})); save('lastro_movs',MOVS); }`
  Preserva `id` dos lotes (estabilidade de sync). `CARTEIRA` continua sendo o derivado.
- **Migração na nuvem (entre aparelhos):** no `loadCloudState` (`:5072-5124`):
  - Se a nuvem trouxer `d.movs` → adota `MOVS` (mesma reconciliação por `ts` já existente).
  - Se a nuvem for **legada** (só `d.carteira`, sem `movs`) e o local **já migrou** → o local
    (mais rico) manda; empurra `movs` (mesma blindagem "vazio da nuvem não apaga", `:5085`).
  - Reaproveitar exatamente as PROTEÇÃO 1/2 e a lógica `wipes()` (`:5094-5095`) — `movs` vazio
    da nuvem **nunca** apaga `movs` local com eventos.
- **Sem perda de dados:** a migração é aditiva (deriva `MOVS` de `CARTEIRA`); um aparelho
  ainda não atualizado continua lendo `d.carteira` do blob (manter os dois campos no payload
  durante a transição — `carteira` = projeção, `movs` = fonte).

---

## 6. Sincronização e integridade

- **Reusa o padrão do `carteira`:** `MOVS` entra no `cloudPayload()` como `movs:MOVS`
  (`:5127`) e no `loadCloudState()` como mais um array reconciliado por `ts`
  (last-write-wins do servidor via `save_state`, `schema.sql:73`). **Nenhum endpoint novo,
  nenhuma tabela nova, nenhuma RPC nova** → respeita o limite 11/12 da Vercel.
- **Risco de merge (dois aparelhos lançando ao mesmo tempo):** hoje o blob é substituído
  inteiro (M2 do HANDOFF) — o último a gravar vence e pode descartar um movimento do peer.
  Mitigações em ordem de custo:
  1. (Fase 1, barato) manter last-write-wins e a blindagem `_dirty` — aceitar o trade-off,
     documentar. Como movimentos são **append-only** na prática, o risco é perder um evento
     recém-criado no outro aparelho, não corromper.
  2. (Fase 2/3, robusto) **merge por união de `id`**: `MOVS` é uma lista de eventos imutáveis
     com `id` estável → no `loadCloudState`, em vez de substituir, **unir por `id`**
     (dedupe), como já é feito com `patHist` (`:5117`). Edições/exclusões precisam de
     *tombstones* (`{id, deleted:true, ts}`) para propagar remoção sem "ressuscitar". Isso
     resolve o M2 **só para movimentos** sem tocar no resto do blob.
- **Integridade:** `deriveState` é puro e determinístico → mesmo `MOVS` gera o mesmo estado em
  qualquer aparelho. Nenhum número derivado (caixa, PM, realizado) é persistido — sempre
  recalculado. Isso elimina drift entre dispositivos.
- **PostgREST direto:** se algum dia precisar de leitura server-side de eventos (relatórios),
  vai direto ao PostgREST (não conta como função). Não é necessário no MVP.

---

## 7. Plano faseado

### Fase 1 — MVP "patrimônio real" (venda + provento-caixa + caixa)
Valor: patrimônio e proventos passam a refletir a realidade; destrava IR real.
- **finance:** especifica `deriveState`/`rebuildLots` (PM ponderado, venda, caixa); regras de
  arredondamento em centavos; casos de borda (zerar posição, caixa negativo).
- **frontend:** modal "Registrar" segmentado (Compra/Venda/Provento/Caixa) reusando
  `maskBRL`/`posSuggest`/`validDate`; bloco Extrato + saldo em caixa na `viewCarteira`;
  wrappers `addPosition`→`compra`.
- **backend:** `movs` + `schema:2` no `cloudPayload`/`loadCloudState`; migração local;
  reconciliação (Fase 1 = last-write-wins reusado).
- **review:** auditar mutação de PM/caixa, migração idempotente, sem segredo, iOS.
- **qa:** Playwright — registrar compra/venda/provento; conferir patrimônio, caixa, série;
  sync entre 2 sessões.
- **Risco/sensível (dinheiro):** venda que realiza lucro e caixa que soma provento mudam
  números visíveis — validar centavo a centavo antes de publicar.

### Fase 2 — Eventos societários + proventos sugeridos
- **finance:** desdobramento/grupamento/bonificação no PM e quantidade; ajuste retroativo da
  `wealthSeries` (posição por dia já ajustada).
- **frontend:** tipo "Evento" no modal; sugestões de provento por data-com (confirmar 1-toque).
- **backend:** **merge por união de `id` + tombstones** (resolve M2 para `movs`).
- **review/qa:** provar que um desdobramento antigo não distorce a série; sugestão nunca vira
  lançamento sozinho.

### Fase 3 — IR realizado (livro fiscal)
- **finance:** apuração mensal de ganho/prejuízo, carry-forward por classe, isenção 20k.
- **frontend:** `runDarf`→"apurar do livro"; export DARF/informe; Proventos com realizado real.
- **review/qa:** conferir alíquotas, compensação de prejuízo, meses isentos.

**Trade-offs globais:** manter `CARTEIRA` como projeção evita duplicação mas concentra risco
na migração (mitigado por idempotência + versionamento). Caixa no patrimônio é mais honesto,
porém muda o número do card (comunicar). Sync append-only é seguro para criação; exclusão
precisa de tombstone (Fase 2). Nada de IA, nada de RNG — só dados que o usuário confirma.

---

## Anexo — âncoras no código (jul/2026)

- Lotes/carteira: `:3789` seed, `:3796` `loadPortfolio`, `:3801` `savePortfolio`,
  `:3803` `normLots`, `:3807` `addPosition`, `:3820` `editLot`, `:3826-3827` remove.
- Derivação atual: `portfolioByTicker:3907`, `portfolioStats:4308`, `posWeight:4323`.
- Proventos projetados: `provPerCota:3829`, `groupPayments:3836`, `provPayments:3856`,
  `provRealInfo:3866`, `nextProventoFor:3879`.
- Patrimônio: `wealthSeries:8904`, `recordPatSnapshot:8798`, `patHistArr/Save:8796-8797`,
  `closeOn:8827`, `loadPortfolioHistory:8832`.
- Sync: `loadCloudState:5072`, `cloudPayload:5127`, `saveCloudState:5151`,
  `flushCloudState:5163`; RPC `save_state` em `backend/supabase/schema.sql:73`.
- Views: `viewCarteira:6523`, `viewProventos:7522`, `viewAporte:7605`, `viewIR:7733`,
  `runDarf:7780`, `render:5801`, `afterRender:8386`.
- Helpers reusáveis: `uid:3802`, `validDate:3805`, `todayISO:3959`, `maskBRL:3948`,
  `parseBRL:3957`, `parseLotDate:3858`, `posSuggest:3963`, `LastroMoney` (`vendor/money.js`).
