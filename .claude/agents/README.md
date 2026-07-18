# Equipe de agentes — Lastro

Subagentes especializados do Claude Code para o projeto Lastro. Cada arquivo `*.md`
define um papel (frontmatter: `name`, `description`, `tools`, `model`) + as instruções
(o corpo). Todos rodam em **Opus**.

## Time

| Agente | Papel | Quando acionar |
|---|---|---|
| **lastro-architect** | Arquiteto / planejador | Início de feature grande/ambígua: mapear código, decompor, escolher trade-offs, manter docs |
| **lastro-frontend** | Front-end / UI-UX | Telas, CSS/JS de interface, mobile-first iOS, dark/light, gráficos, onboarding |
| **lastro-backend** | Backend / dados | `api/*` serverless, Supabase/RLS, coletor de notícias, dados reais (brapi, BCB, CoinGecko, CVM) |
| **lastro-finance** | Especialista financeiro | Indicadores, Score Lastro™, matemática de carteira, benchmarks, veracidade dos números |
| **lastro-qa** | QA / testes | Provar que funciona num navegador real (Playwright): screenshots, medições, estados |
| **lastro-review** | Revisor de código | Antes de publicar: caçar bugs/regressões, validação obrigatória, iOS, segredos |

## Estúdio de design (orquestrador + 6 especialistas)

Desenho de feature/tela do zero ou reformulação de UX com rigor. O orquestrador comanda os 6 especialistas em sequência, faz o gate entre etapas e consolida a spec final.

| Agente | Etapa | Função |
|---|---|---|
| **lastro-design-studio** | Orquestrador | Comanda os 6 na ordem, controla o gate, trata reprovações da QA, consolida a spec para handoff |
| **lastro-ds-estrategista** | 1 · Discovery | Objetivo de negócio, usuário-alvo, JTBD, métrica de sucesso, restrições |
| **lastro-ds-arquiteto-ux** | 2 · Arquitetura | Telas necessárias ao JTBD + modelo de navegação (justificado por uso) |
| **lastro-ds-fluxo** | 3 · Fluxo | Fluxo crítico numerado (tela → ação → tela); atalhos p/ >3 passos |
| **lastro-ds-wireframe** | 4 · Wireframe | Hierarquia visual + componentes (obrigatório/opcional) por tela |
| **lastro-ds-ui** | 5 · Sistema de UI | Paleta, tipografia, espaçamento, componentes (contraste/AA, Material/HIG) |
| **lastro-ds-qa** | 6 · Auditoria | Audita 1–5 sem complacência; reprova e devolve à etapa responsável |

## Como usar
- **Orquestração:** quem coordena delega tarefas independentes a vários agentes em paralelo
  (ex.: `frontend` implementa + `finance` confere a conta → `review` audita → `qa` prova no navegador).
- **Fluxo sugerido para feature média:** architect (plano) → frontend/backend/finance (execução)
  → review (auditoria) → qa (evidência) → orquestrador valida, commita e publica na `main`.
- Os agentes **editam arquivos** no workspace, mas **não fazem commit/push** — quem orquestra
  valida (`CSS chaves: 0 | JS: OK`) e publica direto na `main` (sem PR), conforme o `CLAUDE.md`.

## Regras que todos seguem
Single-file `index.html`; validação obrigatória antes de publicar; mobile-first/iOS; tema por
tokens CSS (claro **e** escuro); jargão via termo clicável (`termLabel`/`TERM_CARDS`); nenhum
segredo no código; dados reais só quando o dono autorizar. Detalhes em `CLAUDE.md`, `README.md`, `HANDOFF.md`.
