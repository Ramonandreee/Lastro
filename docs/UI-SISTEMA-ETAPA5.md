# Lastro — Sistema de UI · ETAPA 5 (Designer de UI)

Especificação visual das **3 superfícies novas**: (A) Tab bar mobile, (B) Hub
Mercado, (C) Painel "Mais". **Reaproveita e estende os tokens existentes** do
`:root` / `[data-theme="dark"]` do `index.html`. NÃO cria sistema paralelo.
Toda decisão de cor/tipo é justificada por **contraste/função**, testada em claro
E escuro. Isto é spec — não é código de produção.

> Convenção herdada: cards = `.card` (surface + `--line` + `--r-lg` + `--sh-sm`);
> chips = `.chip` (radius 20px, 11px/500); estados de botão já têm `:focus-visible`
> = `0 0 0 3px var(--brand-l)`. As superfícies novas seguem esses mesmos padrões.

---

## 0. Regras de ouro (não-negociáveis)

1. **Verde/vermelho (`--up`/`--down`) só para alta/baixa.** Nunca como cor de
   estado de navegação, seleção ou foco.
2. **Ouro (`--gold`) só sinaliza Premium/Score.** Proibido na tab ativa, em hover
   genérico ou em contagens. Aparece só no atalho Score (Hub) e no selo Premium
   (Mais).
3. **Marca = navy.** Estado ativo/seleção usa `--brand` (navy no claro, azul no
   escuro), que é o próprio token de marca — sem inventar cor de destaque.
4. **Alvo de toque ≥ 44×44px** (HIG). Nenhum destino de navegação abaixo disso.
5. Contraste mínimo: **texto ≥ 4.5:1**, **ícone/limite de UI ≥ 3:1** — nos dois temas.

---

## 1. Paleta aplicada às 3 superfícies (justificada por contraste)

Contraste calculado por luminância relativa WCAG. Fundo de referência de cada
superfície indicado. Valores arredondados.

### 1.1 TAB BAR — estado ATIVO vs INATIVO (o par crítico)

Fundo da barra = **`--surface`** (não `--canvas`): a barra é uma camada elevada
sobre o conteúdo, e `--surface` (#FFF claro / #101827 escuro) dá o contraste mais
alto tanto para o item aceso quanto para o apagado. Sobre ela roda `--glass` +
blur como acabamento, mas a **cor sólida de fallback é `--surface`** para nunca
depender de blur (iOS pode desligar).

| Elemento | Token (claro) | Token (escuro) | Fundo | Contraste claro | Contraste escuro | Veredito |
|---|---|---|---|---|---|---|
| **Ativo** (ícone+rótulo) | `--brand` #0B2E5E | `--brand` #4F8FE8 | `--surface` | **≈13:1** | **≈5.4:1** | AA texto ✅ (claro AAA) |
| **Inativo** (ícone+rótulo) | `--ink-2` #586273 | `--ink-2` #9AA4B1 | `--surface` | **≈6.2:1** | **≈7.0:1** | AA texto ✅ |
| Borda superior da barra | `--line` | `--line` | — | separador, não-texto | — | ok |
| Indicador ativo (pill atrás do ícone) | `--brand-l` | `--brand-l` | `--surface` | fundo do ícone, ícone já 13:1 | ícone já 5.4:1 | ✅ |

**Racional do ativo = `--brand`:** é o token de marca e o de maior contraste
disponível sobre a barra nos dois temas. No escuro `--brand` clareia para
#4F8FE8 justamente para manter ≥4.5:1 sobre superfície escura (o navy #0B2E5E
daria ~1.4:1 no escuro e seria ilegível — por isso o token já troca sozinho).

**Racional do inativo = `--ink-2` (e NÃO `--ink-4`):** o inativo precisa ser
perceptivelmente mais fraco que o ativo, mas ainda legível. `--ink-4` (#98A0AC)
sobre branco dá **≈2.7:1** — reprova até para ícone (mín. 3:1). `--ink-2` passa
com folga nos dois temas e mantém hierarquia clara ativo↔inativo (13:1 vs 6.2:1
no claro; 5.4:1 vs 7.0:1 no escuro — no escuro o inativo é numericamente maior,
mas a distinção vem de COR/peso, ver §5, não só de contraste).

**Distinção ativo/inativo não pode depender só de cor** (daltonismo): o item
ativo carrega **3 sinais redundantes garantidos** — cor de marca + peso 600 no
rótulo + pill `--brand-l` atrás do ícone. Inativo = `--ink-2` + peso 500 + sem
pill. A troca de glifo regular(inativo)/solid(ativo) **não** entra nessa conta:
o Font Awesome free é build local e a maioria dos glifos das abas não tem
variante "regular" no free — vira reforço só quando o glifo tiver as duas
variantes; senão, não conta (ver §4.1).

### 1.2 HUB MERCADO

| Elemento | Cor | Fundo | Contraste | Nota |
|---|---|---|---|---|
| Fundo da página | `--canvas` | — | — | igual ao resto do app |
| Card de classe / chip recente | `.card` surface + `--line` | `--canvas` | borda `--line-2` no press | reusa componente |
| Título de card de classe | `--ink` | `--surface` | claro ≈16:1 / escuro ≈13:1 | ✅ |
| Contagem ("42 ativos") | `--ink-2` | `--surface` | ≥6:1 | secundário, cor neutra — **não** ouro |
| Ícone da classe (moldura) | `--brand` sobre `--brand-l` | — | reusa `.card-h .ico` | navy de marca |
| Atalho **Score** | ícone `--gold`; texto `--ink` — ambos sobre `--gold-l` | `--surface` | ouro puro = 3.28:1 (só ícone/large text); texto usa `--ink`. Ver §1.4 | **única exceção de ouro** — é Premium |
| Atalho **Agenda** | `--brand` sobre `--brand-l` | `--surface` | navy | não-premium → navy, não ouro |
| Pulso ↑/↓ (só aqui) | `--up` / `--down` | `--surface` | up ≈4.9:1 / down ≈4.6:1 (claro) | única superfície onde verde/vermelho aparece |

### 1.3 PAINEL "MAIS"

| Elemento | Cor | Fundo | Contraste | Nota |
|---|---|---|---|---|
| Fundo do painel | `--canvas` | — | — | consistente |
| Cabeçalho da conta (nome) | `--ink` | `--canvas` | ≥14:1 | título |
| E-mail / plano | `--ink-2` | `--canvas` | ≥6:1 | secundário |
| Linha de item (`more-row`) | texto `--ink`, ícone `--ink-2`, chevron `--ink-4` | `--surface` | texto ≥14:1; ícone ≥6:1; chevron ≈2.7:1 | chevron é decorativo/redundante, aceitável <3:1 |
| Selo **Premium** | ícone `--gold`; texto `--ink` — ambos sobre `--gold-l` | `--surface` | ouro puro = 3.28:1 (só ícone/large text); texto usa `--ink`. Ver §1.4 | Premium legítimo |
| Toggle de Tema (trilho ativo) | `--brand` | `--surface` | ≥5:1 | usa `accent-color: var(--brand)` já global |
| Linha destrutiva (Sair) | `--down` | `--surface` | ≈4.6:1 claro | **exceção consciente**: `--down` aqui = ação destrutiva, não "baixa de mercado". Ver §Divergências. |

### 1.4 Verificação do OURO (Score / Premium)

`--gold` #A87C2A sobre `--gold-l` #F6EFDF (claro) = **3.28:1** (medido) — abaixo
de 4.5:1 para texto pequeno e abaixo até do piso "large text" quando o texto não
é grande o bastante. 3.28:1 só habilita **large text** (≥18px normal OU ≥14px
bold, piso 3:1). Logo, o selo Score/Premium com `--gold` puro no texto exige
**SIMULTANEAMENTE peso ≥600 E ≥14px**; abaixo disso, **não usar `--gold` no
texto**.

**Regra fixada (sem token novo — só `--gold` e `--gold-l` existem no `:root`; ver
§6 "zero token novo"):** o **texto do selo = `var(--ink)` sobre `--gold-l`**
(contraste alto, seguro para qualquer tamanho). O **`--gold` puro fica reservado
só para o ícone/coroa** — como elemento de UI/ícone o piso é 3:1 e 3.28:1 passa,
ok como ícone. Nunca aplicar `--gold` puro em texto de corpo pequeno.

No escuro `--gold` #D6AC5C sobre `--gold-l` translúcido dá ≈6:1 → o texto do selo
pode voltar a usar o próprio dourado no tema escuro; no claro, mantém `--ink`.
Registrado na Etapa 6 (auditoria): `--gold` puro nunca como texto de corpo
pequeno no claro.

---

## 2. Escala tipográfica (5 níveis, mapeada aos tokens)

`--serif` (Source Serif 4) = títulos-display. `--sans` (Inter) = todo o resto de
UI. Números sempre `.mono`/`.tnum` (tabular). Tamanhos em px seguindo a base do
app (corpo 14px).

| Nível | Uso | Família | Tam / Peso / Tracking | Justificativa |
|---|---|---|---|---|
| **D — Display** | Título do Hub ("Mercado"), nome da conta no Mais | `--serif` 500 | 22px / 500 / -.01em | serif marca hierarquia de página; segue `.page-title` existente |
| **T1 — Título de seção/card** | Título de card de classe, título de bloco no Hub | `--sans` 600 | 15px / 600 / -.01em | igual a `.card-h` (14–15/600); sans para densidade |
| **T2 — Item de lista** | Linha do painel Mais (`more-row`) | `--sans` 500 | 15px / 500 / 0 | 15px garante alvo confortável e leitura mobile |
| **N — Numérico/contagem** | Contagem de ativos no card de classe, valores do pulso | `--sans`/`.mono` 600 | 13px / 600 / -.01em, tabular-nums | tabular alinha dígitos; peso destaca o dado |
| **L — Rótulo/legenda** | **Rótulo da tab bar**, sub-rótulo, e-mail no Mais | `--sans` 500→600 | **11px / 500 (inativo) · 600 (ativo)** / +.005em | 11px é o padrão Material/HIG p/ bottom nav; peso sobe no ativo (2º sinal além da cor) |

**Rótulo da tab bar em detalhe:** 11px é o piso legível para caption. Tracking
levemente positivo (+.005em) compensa o tamanho pequeno. Nunca `--serif` na tab
bar (serif em 11px perde legibilidade em tela). Rótulo **sempre visível** nos 5
destinos (HIG/Material), nunca só-ícone.

---

## 3. Escala de espaçamento (base 4px)

Grade base **4px** (o app já usa múltiplos: 4/8/12/16/22/24). Valores das 3
superfícies:

| Medida | Valor | Base 4 | Racional |
|---|---|---|---|
| **Altura da tab bar** (conteúdo, sem safe-area) | **56px** | 14×4 | Material spec (56); HIG ~49–56 → 56 concilia os dois |
| Padding vertical do item da tab | 8px | 2×4 | centra ícone(24)+gap(2)+rótulo(11) em 56 |
| Gap ícone↔rótulo (tab) | 2px | — | agrupa como uma unidade (lei de proximidade) |
| Pill do ícone ativo | 32×24px, radius 16px | 8/6×4 | alvo visual; toque real = célula inteira ≥44px |
| **Gap da grade de classes (Hub)** | 12px | 3×4 | respiro entre cards sem quebrar densidade |
| Padding interno do card de classe | 16px | 4×4 | = `.card-pad` mobile (16px) já existente |
| Padding lateral do Hub | 16px | 4×4 | = `.content` mobile |
| Altura da linha do painel Mais | **56px** | 14×4 | alvo ≥44 + respiro; consistente com a tab bar |
| Padding H da linha do Mais | 16px | 4×4 | — |
| Gap ícone↔texto (more-row) | 12px | 3×4 | = `.nav-item` gap existente |
| Recent-chip: padding | 8px 12px | 2/3×4 | pílula compacta, alvo ≥44 pela altura total |

---

## 4. Biblioteca de componentes (5) — Material + HIG

Padrão de **bottom navigation**: altura ~56px, **3–5 destinos**, **rótulo sempre
visível**, **exatamente 1 ativo**, sem badges numéricos gigantes. Onde divergimos,
está marcado **⚠ DIVERGÊNCIA**.

### 4.1 `tab-item` (destino da tab bar)
- **Estrutura:** célula flex-column, `align-items:center`, `justify-content:center`,
  ícone 24px + rótulo 11px, gap 2px. Célula inteira é o alvo (largura = 100/5%,
  altura 56px) → alvo ≥44px garantido.
- **Ícone:** Font Awesome (já carregado), 24px. O build free é **local** e a
  maioria dos glifos das abas **não tem variante "regular"** no free — então a
  troca regular(inativo)/solid(ativo) **só é aplicável quando o glifo tiver as
  duas variantes no free**; quando não tiver, **não conta como sinal de estado**.
  Não vender como garantido: o estado ativo já é garantido pelos 3 sinais
  redundantes abaixo (cor `--brand` + peso 600 do rótulo + pill).
- **Ativo:** ícone+rótulo `--brand`; rótulo peso 600; pill `--brand-l` atrás do
  ícone (radius 16px). **Só 1 ativo por vez.** Esses **3 sinais** (cor + peso +
  pill) são a garantia de estado; a troca regular/solid é um 4º reforço
  **oportunista**, não garantido.
- **Inativo:** ícone+rótulo `--ink-2`; rótulo peso 500; sem pill.
- **Conformidade:** ✅ Material (56px, rótulo visível) + HIG (tab bar inferior).
- ⚠ **DIVERGÊNCIA controlada:** Material 3 usa "pill" horizontal largo atrás do
  ícone (indicador de 64px). Usamos pill mais estreito (32px) para caber 5
  destinos em telas de 360px sem apertar rótulo. Mantém a semântica do indicador.

### 4.2 `class-card` (card de classe de ativo no Hub)
- **Base:** herda `.card` (surface, `--line`, `--r-lg`, `--sh-sm`).
- **Conteúdo:** moldura de ícone `.card-h .ico` (`--brand`/`--brand-l`) + título
  T1 (`--ink`) + contagem N (`--ink-2`, tabular). Sem verde/vermelho.
- **Grade:** 2 colunas no mobile, gap 12px.
- **Press:** `border-color:--line-2` + `translateY(1px)` (ver §5). Sem sombra
  crescente no mobile (economia de repaint).
- **Conformidade:** cartão padrão Material; toque na área inteira.

### 4.3 `recent-chip` (visto recentemente)
- **Estrutura:** pílula horizontal rolável (scroll-x), ticker + micro-seta
  opcional. Padding 8×12, radius 20px (= `.chip`), fundo `--surface` + `--line`.
- **Cor:** texto `--ink`; se exibir variação, aí sim `--up`/`--down` (é dado de
  mercado). Ticker em `.mono`.
- ⚠ **DIVERGÊNCIA:** não é padrão Material/HIG nomeado — é um "carrossel de chips"
  (padrão de fato em apps financeiros). Justificado: acesso rápido ao histórico
  sem ocupar altura vertical. Scroll horizontal com `scroll-snap`.

### 4.4 `pulse-strip` (pulso resumido do mercado)
- **Estrutura:** faixa horizontal compacta, 2–4 indicadores (ex.: IFIX, IBOV),
  cada um: rótulo L (`--ink-2`) + valor N (`.mono`) + delta `--up`/`--down`.
- **Única superfície nova** onde verde/vermelho é legítimo (é alta/baixa real).
- **Fundo:** `--surface` dentro de `.card` ou faixa `--surface-2`.
- **Conformidade:** equivalente a "supporting content"/data row; não é navegação.

### 4.5 `more-row` (linha do painel Mais)
- **Estrutura:** linha 56px, `display:flex; align-items:center; gap:12px`,
  ícone 20px (`--ink-2`) + texto T2 (`--ink`) + chevron `--ink-4` à direita.
  Reusa a gramática de `.nav-item`.
- **Selo Premium** (quando aplicável): chip fundo `--gold-l` à direita (antes do
  chevron), **texto `var(--ink)`** e ícone/coroa `--gold` (ver §1.4). Toggle de
  Tema: trilho `--brand`.
- **Press:** fundo `--surface-3` (= `.nav-item:hover`).
- **Conformidade:** ✅ HIG "grouped list" / Material list item. Separadores `--line`.
- ⚠ **DIVERGÊNCIA:** linha "Sair" usa `--down` como cor de texto. `--down` é
  reservado a baixa de mercado, mas HIG/Material pedem cor destrutiva
  (vermelho) para ações irreversíveis. **Decisão:** reaproveitar `--down` como
  vermelho semântico de "destrutivo" APENAS nesta linha, com rótulo explícito
  ("Sair"). Alternativa se os donos preferirem pureza do token: manter `--ink`
  neutro. **← ponto que precisa de decisão dos donos (ver §7).**

---

## 5. Estados (ativo, hover/press) e safe-area

### 5.1 Estados
- **Tab ativa:** cor `--brand` + peso 600 + pill `--brand-l` (+ ícone "solid"
  quando o glifo tiver a variante no free — reforço opcional, não garantido).
  Transição de cor `.18s var(--ease)` (padrão do app). Sem animação de layout.
- **Hover (só cursor/desktop, `@media (hover:hover)`):** tab inativa → `--ink`;
  more-row → fundo `--surface-3`. Nunca aplicar hover em `hover:none` (mobile).
- **Press/`:active` (mobile):** feedback tátil imediato — `transform:scale(.96)`
  no tab-item; `translateY(1px)` no class-card; fundo `--surface-3` no more-row.
  Duração curta (~.12s). Respeitar `prefers-reduced-motion` (o app já trata).
- **Foco (teclado):** `:focus-visible` = `0 0 0 3px var(--brand-l)` (herdado dos
  botões). Aplicar a tab-item e more-row.
- **Disabled:** `opacity:.5` (padrão herdado).

### 5.2 Comportamento no safe-area (iOS notch/home indicator)
- A tab bar é `position: fixed; left/right:0; bottom:0`.
- **Altura total** = `56px + env(safe-area-inset-bottom, 0px)`.
- **Padding-bottom** = `env(safe-area-inset-bottom, 0px)` para empurrar o
  conteúdo acima da faixa do home indicator.
- **A cor de fundo (`--surface`/`--glass`) DEVE cobrir a inset inteira** — o
  fundo pinta até `bottom:0`, e só o padding reserva o espaço. Nunca deixar a
  inset transparente (apareceria o `--canvas` ou faixa branca embaixo, bug já
  conhecido no projeto — ver `html.booting` no CSS atual).
- O `theme-color`/status bar não muda; a barra inferior é responsabilidade do CSS.
- **Empurrar o conteúdo:** o container principal ganha
  `padding-bottom: calc(56px + env(safe-area-inset-bottom,0px))` no mobile
  (≤760px) para nada ficar escondido atrás da tab bar.
- **Só ≤760px:** acima disso a tab bar some e volta o `.sidebar` (a topbar perde
  ícone de conta e hambúrguer no mobile, conforme Etapa 1–4).

### 5.3 Riscos de implementação (com dono/regra explícita)

1. **Z-INDEX (empilhamento).** A tab bar fica **ACIMA do conteúdo** e **ABAIXO do
   drawer e dos modais**. Usando os z-index reais do projeto (drawer ~`z70`,
   modais ~`z260`), a tab bar fica em **~`z60`**. Consequência desejada: o drawer
   aberto pela aba "Mais" e qualquer modal **cobrem** a barra (não ficam por baixo
   dela). Ordem: conteúdo < tab bar (~z60) < drawer (~z70) < modais (~z260).
2. **TECLADO iOS.** Barra `position:fixed; bottom:0` **flutua junto com o teclado**
   no Safari iOS (o teclado empurra o viewport e a barra sobe grudada nele).
   **Regra:** **esconder a tab bar quando um input recebe foco** (telas de busca /
   simulador) e **reexibir no blur**. Declarado como comportamento — pendência
   assumida por escrito (implementar via listeners de `focus`/`blur` nos campos ou
   classe no container).
3. **VOLTAR × TAB BAR no detalhe do ativo.** Com a tab bar **sempre visível**, os
   dois controles têm **papéis separados, nunca o mesmo**: o botão **"Voltar"** do
   detalhe retorna à **ORIGEM** de onde o ativo foi aberto (Hub / lista / carteira);
   a **tab bar** troca de **SEÇÃO** (raiz de navegação). Voltar ≠ trocar de aba —
   documentado para não colapsarem no mesmo gesto.

---

## 6. Resumo de tokens usados (nada novo inventado)

Ativo nav = `--brand`/`--brand-l` · Inativo/secundário = `--ink-2` · Terciário/
chevron = `--ink-4` · Título = `--ink` (+ `--serif` no display) · Superfícies =
`--surface`/`--surface-2`/`--surface-3`/`--canvas` · Bordas = `--line`/`--line-2`
· Premium/Score = `--gold`/`--gold-l` (só ali) · Alta/baixa = `--up`/`--down` (só
pulso e recent-chip) · Radius = `--r-sm`/`--r`/`--r-lg` · Sombra = `--sh-sm` ·
Foco = `--brand-l` · Easing = `--ease`. **Zero variáveis CSS novas necessárias.**

---

## 7. Decisões que faltam (NÃO supus — perguntar aos donos)

### 7.1 Destinos da tab bar — TRAVADO (não é mais pendência)

As **5 abas foram travadas na Etapa 2** e não estão em aberto. São exatamente
estes **5 destinos** (nesta ordem):

| # | Destino | Ícone (Font Awesome) |
|---|---|---|
| 1 | **Início** | `fa-house` |
| 2 | **Mercado** | `fa-chart-line` |
| 3 | **Carteira** | `fa-wallet` |
| 4 | **Notícias** | `fa-newspaper` |
| 5 | **Mais** | `fa-bars` (ou `fa-ellipsis`) |

- **Largura de célula:** 100 / 5 = **20% cada** (5 células iguais).
- **Score** e **Agenda** **NÃO** são abas — são **atalhos DENTRO do Hub Mercado**
  (Etapa 4), não destinos da tab bar. Removidos como candidatos a aba.
- Largura de célula e ícones estão **fechados** — deixaram de ser pendência.

### 7.2 Decisões ainda em aberto

1. **Linha "Sair" no Mais:** usar `--down` (vermelho destrutivo, diverge da regra
   do token) ou `--ink` neutro? (§4.5)
2. **Recent-chip mostra variação (%)?** Se sim, entra `--up`/`--down`; se for só
   atalho de navegação, fica neutro (`--ink`).

Enquanto não houver resposta, o default assumido e sinalizado é: **Sair em
`--down`**, **recent-chip neutro sem %**. Trocar quando decidido. (As 5 abas
não têm default assumido — já estão travadas em §7.1.)
