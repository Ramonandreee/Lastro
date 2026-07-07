# ONBOARDING — Desenvolver o Lastro com Claude Code

> Guia rápido para um novo colaborador começar a mexer no app. O projeto é
> **single-file** (`index.html`, sem build, sem framework): você edita, atualiza
> a página e vê o resultado. Para o guia técnico completo, veja o **README.md**.

---

## Pré-requisitos (instalar uma vez)

- **Git**
- **VS Code** (ou outro editor)
- **Claude Code** (você já tem)
- **Python 3** (ou Node) — só para servir o site localmente

## Passo a passo

1. **Clonar o repositório** (se ainda não estiver na sua máquina):
   ```bash
   git clone https://github.com/Ramonandreee/lastro.git
   cd lastro
   ```

2. **Criar o `config.js`** a partir do template:
   ```bash
   cp config.example.js config.js
   ```
   Depois preencha os valores reais no `config.js`. **Peça as chaves ao Ramon**
   (Supabase URL/anon key, token brapi). Elas **nunca** vão para o GitHub —
   `config.js` está no `.gitignore`.

   > Sem as chaves o app ainda **abre em modo demonstração** (dados de exemplo);
   > dá para desenvolver quase tudo assim.

3. **Rodar localmente** (tem que ser por HTTP — abrir o arquivo com duplo-clique
   quebra login e IA):
   ```bash
   python3 -m http.server 5173
   ```
   Abra **http://localhost:5173**.

4. **Editar** — quase tudo está em `index.html`. Salve e dê F5 para ver a mudança.
   O **README.md** (seções 4, 6 e 8) mostra onde fica cada coisa.

## Fluxo de trabalho: direto na `main`

Combinado com o Ramon: **commit direto na `main`** (sem branch de trabalho).
Regras para não dar conflito, já que os dois mexem no mesmo arquivo:

1. **Sempre** `git pull origin main` antes de começar e antes de dar push.
2. **Combinem quem mexe em quê** (ex.: "hoje eu mexo na tela X, você na Y").
3. **Valide antes de todo push** (comando no README §8) — um erro de sintaxe
   derruba o app inteiro, e indo direto na `main` isso vai pro ar na hora.

Ciclo do dia a dia:
```bash
git pull origin main        # pega o que há de novo
# ...edita o index.html...
# ...valida (README §8)...
git add -A
git commit -m "descreve a mudança"
git push origin main
```

Se o push for **rejeitado** ("updates were rejected"), é porque o outro subiu
algo antes. Resolva com:
```bash
git pull origin main
git push origin main
```

## O que só o Ramon fornece

- As **chaves reais** do `config.js` (Supabase, brapi) — por canal privado.
- Acesso de colaborador com permissão de push (já configurado).

---

Dúvida sobre o código? Peça ao seu Claude Code:
*"Leia o README.md e o HANDOFF.md e me explique a arquitetura do projeto e onde
ficam as coisas no index.html."*
