# Instruções para o Claude Code — Projeto Lastro

## Fluxo de git (IMPORTANTE)

**Sempre publique direto na branch `main`. NUNCA abra Pull Request.**

- Faça as alterações, valide (ver abaixo) e commite direto na `main`.
- Publique com push direto na `main` (ex.: `git push origin HEAD:main`).
- **Não** crie branch de trabalho e **não** abra Pull Request — o time trabalha
  direto na `main` e o deploy (Vercel) publica automaticamente a cada push.
- Antes de começar e antes de dar push, rode `git pull origin main` para pegar o
  que houver de novo e evitar conflito.

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
