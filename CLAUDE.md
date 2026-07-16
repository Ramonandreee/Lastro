# Instruções para o Claude Code — Projeto Lastro

## Governança e fluxo de git (IMPORTANTE)

**Donos do projeto:** Ramon e Mikael. Ambos têm autoridade total e igual — não
existe etapa de aprovação entre eles. Qualquer alteração pedida por qualquer um
dos dois vai **direto para a `main`**.

**Sempre publique direto na branch `main`. NUNCA abra Pull Request.**

- Faça as alterações, valide (ver abaixo) e commite direto na `main`.
- **Salve automaticamente no GitHub**: depois de validar, faça commit e push
  direto na `main` (ex.: `git push origin HEAD:main`) sem pedir confirmação.
- **Não** crie branch de trabalho e **não** abra Pull Request — o time trabalha
  direto na `main` e o deploy (Vercel) publica automaticamente a cada push.
- Antes de começar e antes de dar push, rode `git pull origin main` para pegar o
  que houver de novo e evitar conflito.

## Trabalho em equipe (multi-agentes) — modo padrão

Somos **um time**. Para toda solicitação de qualquer um dos donos (**Ramon ou
Mikael**), o **especialista da área entra em cena** — não trabalhe sozinho em algo
que tem dono. Os agentes vivem em `.claude/agents/`:

- **lastro-architect** — planejamento/arquitetura de features grandes ou ambíguas; mantém docs.
- **lastro-frontend** — UI/UX, CSS/JS de interface no `index.html`, mobile-first iOS, dark/light, gráficos.
- **lastro-backend** — `api/*` serverless, Supabase/RLS, coletor de notícias, dados reais (brapi, BCB, CoinGecko, CVM).
- **lastro-finance** — indicadores, Score Lastro™, matemática de carteira, benchmarks, veracidade dos números.
- **lastro-qa** — prova no navegador real (Playwright): screenshots, medições, estados.
- **lastro-review** — auditoria do diff antes de publicar: bugs, iOS, segredos, validação.

**Como orquestrar:** delegue ao(s) especialista(s) certo(s) (em paralelo quando as
tarefas são independentes). Fluxo típico de uma feature: *architect* (plano) →
*frontend/backend/finance* (execução) → *review* (auditoria) → *qa* (evidência).
Os agentes **editam arquivos, mas não commitam** — **quem orquestra valida
(`CSS chaves: 0 | JS: OK`), commita e publica direto na `main`** (sem PR). Pedidos
triviais/conversa não precisam de delegação; trabalho de produto, sim.

## Consulte a documentação ANTES de qualquer alteração

A documentação é atualizada constantemente pelos dois donos (Ramon e Mikael).
**Antes de mexer em qualquer coisa**, leia sempre o estado atual em:
`README.md`, `HANDOFF.md` e este `CLAUDE.md`. Nunca confie só na memória — o que
mudou desde a última sessão está nesses arquivos. Depois de mudanças relevantes,
**atualize a documentação** para o próximo (pessoa ou IA) ter o contexto certo.

## Validação obrigatória antes de todo push

O app é single-file (`index.html`); um erro de sintaxe derruba tudo e vai direto
pro ar. Valide CSS (chaves balanceadas) e JS (sintaxe) antes de cada push:

```bash
node -e 'const h=require("fs").readFileSync("index.html","utf8");
  const st=[...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join("\n");
  let b=0;for(const c of st){if(c=="{")b++;else if(c=="}")b--;}
  const js=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  let ok=true;js.forEach((s,i)=>{try{new Function(s)}catch(e){ok=false;console.log("JS erro",i,e.message)}});
  console.log("CSS chaves:",b,"| JS:",ok?"OK":"FALHA")'
```

Espere `CSS chaves: 0` e `JS: OK`. Se não, corrija antes de publicar.

## Onde está o quê

- Todo o app vive em **`index.html`** (HTML + CSS + JS puro, sem build/framework).
- Guia de arquitetura: **`README.md`** (seções 4, 6 e 8).
- Estado atual / histórico: **`HANDOFF.md`**.
- Onboarding do colaborador: **`ONBOARDING.md`**.
- Site no ar: **https://lastro-dun.vercel.app/** (publica a cada push na `main`).

## Convenções

- Não commite `config.js` (está no `.gitignore` — contém configuração local).
- Mobile-first / iOS: cuidado com `viewport`, `touch-action`, `user-select` e
  `position: sticky` (não usar `overflow:hidden` no `html/body`).
- Explicar jargão sempre com o padrão de termo clicável (`termLabel`/`TERM_CARDS`),
  nunca espalhando "?".
- Tema: sempre via tokens CSS (`--brand`, `--ink`, etc.); teste claro e escuro.
