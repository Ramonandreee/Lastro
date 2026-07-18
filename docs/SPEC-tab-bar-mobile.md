# SPEC — Barra de navegação inferior (bottom tab bar) mobile

> Documento de handoff consolidado do **Estúdio de Design** (6 etapas) para
> implementação. Aprovado pela Auditoria de QA (Etapa 6). Decisões dos donos
> travadas. Detalhe visual completo em `docs/UI-SISTEMA-ETAPA5.md`.

---

## 1. Objetivo e decisões travadas (Etapa 1 — Discovery)

- **Objetivo nº1:** RETENÇÃO / hábito. Foco: equilíbrio carteira + mercado.
- **JTBD:** *"numa pausa curta, saber se está tudo bem com o que é meu e qual a próxima ação inteligente."*
- **Problema atacado:** hoje 100% da navegação está atrás do hambúrguer; telas
  Premium ficam escondidas → fricção alta e conversão sabotada.
- **Métrica-norte proposta:** profundidade de navegação por sessão (telas distintas/sessão).
- **Backlog (não é desta entrega):** doc `HANDOFF.md`/`README.md` ainda dizem marca
  esmeralda; código já é navy `#0B2E5E`. Resíduo esmeralda em `#authModal.auth-full`
  (`--brand-l` esverdeado). Limpar por higiene.

## 2. Arquitetura (Etapa 2)

**Uma bottom tab bar mobile (≤760px) como navegação primária. 5 abas:**

| Aba | Ícone | Destino |
|---|---|---|
| Início | `fa-house` | `nav('painel')` (viewPainel — já existe) |
| Mercado | `fa-chart-line` | `nav('mercado')` → **`viewMercado()` novo (hub)** |
| Carteira | `fa-wallet` | `nav('carteira')` |
| Notícias | `fa-newspaper` | `nav('noticias')` |
| Mais | `fa-bars`/`fa-ellipsis` | **abre painel curado** (não navega) |

- **Um só `nav()` continua a fonte de verdade.** A tab bar é mais uma superfície
  que chama `nav()`. Novo mapa `VIEW_TAB` + `syncTabBar(v)` chamado dentro de `nav()`
  (após `currentView=v`) acende a aba da seção. Largura de célula = 20% (100/5).
- **Estado ativo por seção:** classes de ativo + Score + Agenda → Mercado;
  Proventos/Aporte/IR/Acompanhar/Raio-X/Backtest/Stress/Detector → Carteira;
  órfãs (Simuladores/Comparador/Recomendadas/Planos/Assinatura) → Mais;
  `asset` herda a aba de `prevView`.
- **Desktop (>760px):** mantém o rail lateral. Tab bar `display:none`. Mesmo modelo,
  apresentação diferente — não são arquiteturas separadas.
- **Mobile:** hambúrguer e ícone de conta **saem** da topbar; a aba "Mais" é a única
  porta pro resto. Breakpoint da tab bar: **≤760px** (default aceito).
- **Voltar:** mantém `goBack()` atual (default aceito). No detalhe, "Voltar" = origem;
  a tab bar = troca de seção (papéis separados).

## 3. Fluxo crítico (Etapa 3) — loop de sessão curta

Abrir → **Painel** (aba Início) → toca **Carteira** → toca **Mercado** → toca **Notícias** → fecha.
**3 toques, zero varredura** (vs. hoje: 6 toques + 3 varreduras de menu). O ganho é
eliminar a busca visual repetida — vira memória muscular. Caminho "agir sobre ativo":
Hub → "vistos recentemente" leva ao detalhe em 1 toque (atalho do caso recorrente).

## 4. Wireframes (Etapa 4) — 3 superfícies novas

**A) Tab bar:** 5 itens = ícone + **rótulo sempre visível** (obrigatório); alvo ≥44×44
(célula 72×56 em 360px); safe-area iOS reservada com `env(safe-area-inset-bottom)`.

**B) Hub Mercado (`viewMercado`), enxuto — ordem:**
1. **Vistos recentemente** (topo, gancho de retenção) — carrossel de mini-cards → `quickView(tk)`.
   Fonte: gravar últimos N tickers em `localStorage` ao abrir um ativo. Vazio → colapsa e sobe as classes.
2. **Cards de classe** com contagem — Ações/FIIs/ETFs/Cripto + **1 card "Internacional"** (agrupa Stocks/BDRs/ETFs int → `nav('stocks')`). Reusa `ASSET_CFG`.
3. **Pulso resumido** — 1 faixa: Ibov + Dólar + contador "N em alta · M em baixa" (clicável). Reusa `heroIndices()`/`topMovers()` só para contar. **As listas completas de altas/baixas ficam SÓ no Início** (sem duplicar).
4. **Atalhos** Score Lastro (`nav('score')`) e Agenda de Dividendos (`nav('agenda')`).

**C) Painel "Mais" (curado, NÃO o menu completo):**
- Cabeçalho de conta (avatar + nome + chip de plano; ou "Entrar"). Reusa `acctMenuHTML()`.
- 4 telas órfãs: Simuladores · Comparador · Carteiras Recomendadas · Planos/Assinatura.
- Conta (Perfil · Suporte · Sair em `--down`) + Tema (claro/escuro/auto via `setThemePref`).

## 5. Sistema de UI (Etapa 5) — valores-chave (spec completa: `UI-SISTEMA-ETAPA5.md`)

- **Fundo da barra:** `--surface` (fallback sólido; `--glass`+blur é acabamento, nunca dependência).
- **Item ativo:** `--brand` (13.4:1 claro / 5.44:1 escuro sobre `--surface`) + rótulo peso 600 + pill.
  **3 sinais redundantes** (cor + peso + pill) — não depende só de cor (daltonismo).
- **Item inativo:** `--ink-2` (6.16:1 claro / 7.04:1 escuro). `--ink-4` rejeitado (2.64:1, reprova).
- **Altura:** 56px (concilia Material 56 + HIG). Base de espaçamento 4px. Rótulo Inter 11px (serifa proibida a 11px).
- **Ouro:** só Premium/Score. Texto de selo = `var(--ink)` sobre `--gold-l` (16.16:1); `--gold` puro
  só no ícone/coroa (3.28:1, ok como ícone). **Zero token CSS novo.**
- **Z-index:** conteúdo < tab bar (~z60) < drawer (~z70) < modais (~z260).
- **Teclado iOS:** esconder a barra no `focus` de input, reexibir no `blur`.

## 6. Parecer da Auditoria (Etapa 6)

**APROVADO** após 1 ciclo de reprovação/correção. Reprovações G–K (contraste do ouro
inflado, token `--gold-d` inexistente, abas reabertas por engano, sinal regular/solid
não entregável no FA free, riscos de z-index/teclado/voltar sem dono) — **todas corrigidas
e reverificadas** (contrastes recalculados por luminância WCAG). Sem inconsistência nova.
APROVADO: superfícies existem por função, alvo ≥44px, contraste AA claro/escuro,
mobile≠desktop sem porta dupla, aderência a tokens/CLAUDE.md.

## 7. Escopo de implementação (o que criar/alterar)

**Criar:** (1) componente tab bar (`position:fixed;bottom:0`, irmão de `#content`, 5 botões);
`VIEW_TAB` + `syncTabBar()` em `nav()`. (2) `viewMercado()` (hub enxuto). (3) painel "Mais"
curado. (4) store `localStorage` de vistos recentemente (grava em `quickView`/detalhe).
**Alterar:** `PAGES` (+`mercado`); `render()` (+`else if(v==='mercado')`); `nav()` (+`syncTabBar`);
CSS: `.content` `padding-bottom` += altura da barra + safe-area; esconder `menu-btn` e ícone de conta ≤760px.
**Pendências assumidas por escrito:** teclado iOS (esconder no focus); back atual mantido.

---

*Gerado pela esteira do Estúdio de Design (Estrategista → Arquiteto de UX → Fluxo →
Wireframe → UI → Auditoria QA). Pronto para handoff ao front-end.*
