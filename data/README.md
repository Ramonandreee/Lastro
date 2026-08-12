# `/data/carteiras.json` — composições publicadas por instituições

Arquivo **estático** (servido pela Vercel, não é Serverless Function) com a
**composição** das carteiras que instituições como BTG, XP etc. publicam
abertamente. É a única fonte externa da feature "Carteiras de instituições":
setor, cotação, DY, concentração e desempenho são **derivados** no app a partir
de dado real — nunca escritos aqui.

Spec completa: `docs/specs/carteiras-instituicoes.md` (§1).
Validador: `test/carteiras.test.mjs` → `node --test test/*.mjs` (roda no CI).

O arquivo nasce com `"carteiras": []`. **Só publique uma carteira depois do
sinal verde do dono** (direito de uso — §6 da spec).

## Schema

Raiz:

| Campo | Tipo | O que é |
|---|---|---|
| `version` | número | Versão do schema. Hoje `1`. |
| `updatedAt` | `YYYY-MM-DD` | Data da última edição do arquivo. Atualize a cada mês. |
| `carteiras` | array | Uma entrada por carteira **por competência** (o histórico fica no arquivo). |

Cada item de `carteiras`:

| Campo | Tipo / formato | Obrigatório | O que é |
|---|---|---|---|
| `id` | `<inst-slug>-<carteira-slug>-<YYYY-MM>` | sim | Identificador **único em todo o arquivo**. |
| `serieId` | `<inst-slug>-<carteira-slug>` | sim | Liga as competências da **mesma** carteira (alimenta o histórico de composição). |
| `inst` | texto | sim | Nome da instituição, como ela se escreve. |
| `instSlug` | slug minúsculo | sim | Agrupamento e cor do avatar na lista. |
| `nome` | texto | sim | Nome da carteira **como publicado**. |
| `tipo` | `acoes` \| `fiis` \| `dividendos` \| `small-caps` \| `bdrs` \| `mista` | sim | Filtro da lista. |
| `competencia` | `YYYY-MM` | sim | Mês de referência **declarado pela fonte**. |
| `publicadoEm` | `YYYY-MM-DD` | sim | Data de publicação. É o **t0** do cálculo de desempenho. Não pode ser futura. |
| `fonteUrl` | `https://…` | sim | Link para o relatório original, no domínio da própria instituição. |
| `fonteTitulo` | texto | sim | Título do relatório, como publicado. |
| `fonteTipo` | `pdf` \| `pagina` \| `video` | sim | Formato da fonte. |
| `acessoLivre` | booleano | sim | `false` quando exige login de cliente — a UI avisa. |
| `moeda` | `BRL` (ou outra ISO) | não | Moeda da carteira. Default `BRL`. |
| `pesoUniforme` | booleano | não | `true` quando a fonte publica "pesos iguais". |
| `ativos` | array de `{ tk, peso }` | sim | A composição. `tk` = ticker em maiúsculas (`<TICKER>`); `peso` = número em %, 1 casa decimal (`<PESO>`). |
| `obs` | texto | não | Atribuição/ressalva curta, exibida literal. **Não** é resumo da tese. |
| `coletadoPor` | texto | sim | Quem transcreveu. |
| `coletadoEm` | `YYYY-MM-DDTHH:mm:ssZ` | sim | Quando foi transcrito (UTC). |

Esqueleto para copiar (placeholders — troque tudo que estiver entre `<>`):

```jsonc
{
  "id": "<inst-slug>-<carteira-slug>-<YYYY-MM>",
  "serieId": "<inst-slug>-<carteira-slug>",
  "inst": "<Instituição>",
  "instSlug": "<inst-slug>",
  "nome": "<Nome da carteira, como publicado>",
  "tipo": "acoes",
  "competencia": "<YYYY-MM>",
  "publicadoEm": "<YYYY-MM-DD>",
  "fonteUrl": "https://<dominio-da-instituicao>/<caminho>",
  "fonteTitulo": "<Título do relatório>",
  "fonteTipo": "pdf",
  "acessoLivre": true,
  "moeda": "BRL",
  "pesoUniforme": false,
  "ativos": [
    { "tk": "<TICKER>", "peso": <PESO> }
  ],
  "obs": "",
  "coletadoPor": "<seu nome>",
  "coletadoEm": "<YYYY-MM-DDTHH:mm:ssZ>"
}
```

## As 4 regras de conteúdo (inegociáveis)

1. **Nenhum número de desempenho entra aqui.** Nada de `ret`, `retorno`, `rent`,
   `dy`, `yield`, `vol`, `volatilidade`, `risco`, `score`, `nota`,
   `recomendacao`, `alvo`, `preco` — em nenhum nível. O validador **falha o CI**.
   Foi exatamente isso (rentabilidade fabricada) que derrubou a feature anterior.
2. **Não transcreva o texto/análise do relatório.** `obs` serve para atribuição e
   ressalva ("a fonte publica pesos iguais", "houve troca em 12/mm"), não para
   resumir a tese da casa.
3. **Peso é como publicado.** Se a fonte diz "pesos iguais", escreva os pesos
   explícitos (`100/N` arredondado) **e** marque `pesoUniforme: true`.
4. **Nunca normalizar em silêncio.** Se a soma der 99,7%, guarde 99,7%. A UI
   mostra a soma real quando ela sai de 100%. (O validador tolera ±0,5 p.p. de
   arredondamento; fora disso, é erro de transcrição.)

## Fluxo mensal

1. Abrir o relatório da instituição.
2. Duplicar a última entrada da mesma carteira e trocar
   `id` / `competencia` / `publicadoEm` / `fonteUrl` / `fonteTitulo` / `coletadoEm`,
   e atualizar `ativos[]`. Atualizar `updatedAt` na raiz.
3. `node --test test/*.mjs` → tem de passar.
4. (Opcional, recomendado) `node backend/scripts/check-carteiras.mjs` — confere se
   cada ticker existe de verdade em `/api/quotes`. Requer token; rode local.
5. Rodar a validação obrigatória do projeto (`CSS chaves: 0 | JS: OK`) e
   `git push origin HEAD:main` (a Vercel publica sozinha).

Tempo por carteira: 3–5 min. **Mantenha as competências antigas** — elas alimentam
o histórico de composição. Podar só acima de 24 competências por `serieId`.
