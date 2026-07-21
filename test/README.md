# Testes — Lastro

Suíte de testes de unidade do **backend**, sem dependências externas (runner nativo
`node:test` + `node:assert`). Requer **Node ≥ 20** (auto-detecção de ESM).

```bash
node --test test/*.mjs
```

> Use `test/*.mjs` (o glob do shell) — `node --test test/` (só o diretório) pode
> não descobrir os arquivos em algumas versões.

## O que é coberto (foco: correção de dado financeiro)

| Arquivo | Função testada | Por que importa |
|---|---|---|
| `fundinfo.test.mjs` | `normalize`, `parseNum`, `tokens`, `matchOne` | Um match errado aplica patrimônio/taxa da CVM ao **ativo errado**; `parseNum` errado = patrimônio errado |
| `history.test.mjs` | `isoDay`, `dedupeAsc` | Base da reconstrução dia-a-dia do patrimônio — data errada = ponto do gráfico no dia errado |
| `market-map.test.mjs` | `pct` (fração→%), `mapOne` (CoinGecko) | `pct` já teve risco de dupla conversão (auditoria); mapeamento com fallback de variação 24h |

Roda também em CI a cada push/PR (`.github/workflows/test.yml`) junto de `node --check`
nas Serverless Functions.

## Lacuna conhecida (próximo passo)

A **matemática de carteira** (patrimônio, resultado, variação do dia, reconstrução)
vive embutida no `index.html` (não importável). Para cobri-la, extrair essas funções
para um módulo puro (idealmente com **dinheiro em centavos inteiros**) e então testá-las
— ver `docs/auditoria-backend-enterprise-2026-07.md` (C2/C3).
