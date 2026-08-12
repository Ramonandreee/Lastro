# PLANO — Sincronização confiável e (quase) em tempo real

> **Pedido do Ramon (ago/2026):** *"por prioridade não quero perder dados. Percebi que no meu
> celular e no meu computador estão com dados diferentes, a carteira não bate, e gostaria que
> isso estivesse tudo sincronizado em tempo real."*
>
> Documento de **desenho + plano faseado**. Nenhum código de produto foi alterado ao escrevê-lo.
> Bugs pontuais do sync atual vêm da auditoria paralela (`lastro-review`) — aqui está o **desenho**
> que remove a classe inteira do problema.

---

## 0. Diagnóstico em uma página

### 0.1 O que existe hoje (confirmado no código)

| Peça | Onde | Comportamento |
|---|---|---|
| Leitura da nuvem | `index.html` l. 6337 `loadCloudState()` | `GET /rest/v1/user_state?select=data` — **puxa o blob inteiro** |
| Escrita | l. 6432 `saveCloudState()` | debounce 700 ms → `_postCloud` |
| Escrita imediata | l. 6444 `flushCloudState(keepalive, force)` | `pagehide` / `visibilitychange` (l. 6451-6452) |
| Transporte | l. 6416 `_postCloud` | RPC `save_state` → fallback upsert direto (l. 6410) |
| Payload | l. 6408 `cloudPayload()` | `{ts, schema:2, carteira, movs, watch, alerts, theme, profile, patHist, prefs}` |
| Reconciliação | l. 6355-6357 | **last-write-wins do blob inteiro** por `ts` (carimbado pelo servidor na RPC) |
| "Tempo real" | l. 6461-6468 | `setInterval(15 s)` só com a aba visível |
| Estado de sync | l. 6313-6321 `SYNC` / `syncLabel()` / `syncNow()` | ver 0.3 |
| Banco | `backend/supabase/schema.sql` | `user_state(user_id pk, data jsonb, updated_at)`, RLS por dono, RPC `save_state(p_data)` → `bigint` |

### 0.2 Por que "a carteira não bate" — a causa estrutural

O estado viaja como **um blob só** e o vencedor leva **tudo**. Cenário real do Ramon:

```
10:00  celular  adiciona compra de PETR4     → sobe blob {PETR4}                (ts=10:00)
10:05  PC       adiciona compra de HGLG11    → sobe blob {HGLG11}  (base: 09:00) (ts=10:05)
10:06  celular  puxa: nuvem é mais nova      → adota {HGLG11}      →  PETR4 SUMIU
```

Nada disso é bug de implementação: é o **modelo de dados**. LWW de blob só é correto quando
existe um único escritor. Com dois aparelhos, **toda edição concorrente destrói a outra** — e a
destruição é *silenciosa*, que é exatamente o que o Ramon não quer.

As blindagens atuais (nuvem vazia não apaga; `_dirty` empurra o local) reduzem o dano do caso
"wipe total", mas cobram dois preços já documentados no `HANDOFF.md`:

- **(M1)** não é possível **esvaziar** a carteira de forma sincronizada (os ativos "voltam");
- **(M2)** um aparelho `_dirty` **vence sem comparar `ts`** — a edição do outro é descartada.

### 0.3 Achado grave e barato de corrigir: o estado do sync é INVISÍVEL

`syncLabel()` (l. 6315) e `syncNow()` (l. 6322) **não têm nenhum ponto de chamada**. Grep no
`index.html` inteiro: só as definições. `acctMenuHTML()` (l. 5560-5591) **não renderiza** a linha
de sync — ela existiu e foi perdida em alguma refatoração do menu.

Consequência: hoje, se uma gravação falha (token expirado sem refresh, offline, RLS, 500 do
Supabase), **o usuário não vê absolutamente nada**. `SYNC.state='error'` só aparece no diálogo de
logout (l. 6275). O `HANDOFF.md` afirma que "há status de sync visível no menu da conta" — **a
documentação está desatualizada** e precisa ser corrigida junto com o código.

### 0.4 Outros pontos de desenho relevantes

- **`MOVS` já é a fonte de verdade** (`vendor/movs.js`, redutor puro `deriveState`/`rebuildLots`;
  `CARTEIRA` é projeção via `rebuildCarteira()`, l. 4739). Cada evento tem `id` (`uid()`, l. 4705).
  **Isso é 90% do caminho para merge por união** — falta só o merge e os tombstones.
- O poll de 15 s baixa **o blob inteiro** toda vez (`select=data`). Reduzir o intervalo para
  "tempo real" sem trocar isso multiplica egress e latência à toa.
- Não existe **device id**. Sem ele não há desempate determinístico nem diagnóstico ("quem
  sobrescreveu?").
- `movsSave()` faz `slice(-5000)` (l. 4724) — corte por **ordem de inserção**, não por data.
- `watchlist()` é `string[]` (l. 12263); `alerts` é lista de objetos com `status` (l. 12278).
- **Vercel:** nada aqui precisa de endpoint novo. Tudo fala direto com o Supabase (REST + WS).
  Continuamos em **11/12 funções**.

---

## 1. Tempo real: o que dá e o que não dá

### 1.1 Supabase Realtime é viável? **Sim — com uma ressalva importante de desenho.**

Respostas diretas às perguntas:

- **Dá para usar com a chave anon e a RLS atual?** Sim. O socket abre com
  `wss://<projeto>.supabase.co/realtime/v1/websocket?apikey=<ANON>&vsn=1.0.0` e, no `phx_join`,
  manda o **JWT do usuário** (`config.private`/`access_token`). O Realtime aplica a **mesma RLS**
  de `user_state` (`auth.uid() = user_id`), então o usuário só recebe as próprias linhas.
  **Armadilha:** o JWT expira em ~1 h; é obrigatório enviar o evento `access_token` no canal a cada
  renovação (`refreshSession()`, l. 6159), senão o canal **para de entregar em silêncio**.
- **Precisa de `REPLICA IDENTITY` / publicação?** Para `postgres_changes`: **sim** —
  `alter publication supabase_realtime add table public.user_state;` e, para receber a linha
  antiga em UPDATE/DELETE, `alter table public.user_state replica identity full`. Para o caminho
  **recomendado** (broadcast a partir do banco), **não precisa de nenhum dos dois**.
- **Custa quanto no plano free?** O Realtime está incluso; os limites relevantes do free tier são
  **conexões concorrentes de pico (ordem de 200)** e **mensagens/mês (ordem de 2 milhões)**.
  *Confirmar os números atuais na página de pricing antes de prometer* — mas para um beta com
  amigos (dezenas de abas, poucas mensagens por edição) sobra folga de duas ordens de grandeza.
  Cada **aba aberta** conta como 1 conexão (o app é PWA/single-page: 1 conexão por aba).
- **Como degrada se o WebSocket cair?** Por desenho: o Realtime é **acelerador, não fonte**.
  Quem lê o estado continua sendo `loadCloudState()`. Se o socket não abrir/cair, o cliente
  volta ao **poll** (adaptativo, ver 1.3) e nada quebra — o usuário no máximo espera alguns
  segundos a mais.

### 1.2 A ressalva: **não** coloque o blob no fio

`postgres_changes` entrega **a linha inteira** (`data` jsonb) para cada assinante. Problemas:

1. Blobs grandes (carteira longa + `patHist` 400 pontos + MOVS) podem **estourar o limite de
   payload do Realtime** — e a mensagem é **descartada em silêncio**. Sync intermitente e
   inexplicável é pior que sync lento.
2. Custa banda e checagem de RLS por mensagem.

**Desenho recomendado — canal de NOTIFICAÇÃO ("cutucada"), não de dados:**

```
save_state_v2 / trigger  →  realtime.send({rev, ts, dev}, 'state', 'user:<uuid>', private := true)
cliente recebe {rev}  →  se rev > revLocal  →  loadCloudState()  (REST, o caminho já testado)
```

Payload de ~60 bytes, um único caminho de leitura (o REST), e **zero mudança** no que já funciona.
`realtime.send` a partir de um **trigger** cobre todos os caminhos de escrita (RPC v1, RPC v2,
upsert direto do fallback).

**Plano B (se `realtime.send`/canal privado der trabalho):** `postgres_changes` numa tabela
**magra** `user_state_rev(user_id pk, rev bigint, updated_at)` mantida pelo mesmo trigger — mesma
ideia (payload minúsculo), ao custo de uma tabela e de publicação/replica identity.

**Custo honesto do Realtime neste projeto:** o app **não usa `supabase-js`**. Assinar um canal
exige um cliente **Phoenix Channels escrito à mão** (~80-120 linhas: connect, `phx_join`,
heartbeat de 30 s, reconnect com backoff, re-`access_token` no refresh) em `vendor/rt.js`, ou
auto-hospedar o `supabase-js` (~50 KB) em `vendor/`. **Por isso o tempo real é a Fase 2, não a
Fase 1** — ele deixa a experiência melhor, mas **não é o que faz a carteira bater**.

### 1.3 O que entregar em "tempo real" já na Fase 0 (sem WebSocket)

Poll **adaptativo e barato** — o que hoje custa caro é baixar o blob a cada 15 s:

```js
// hoje:  select=data                 (blob inteiro, ~10-200 KB)
// novo:  select=rev,updated_at       (~40 bytes)  →  só baixa `data` se rev > _rev
```

Cadência: **3 s** nos ~2 min após qualquer atividade local ou foco de aba; **15 s** em ociosidade;
**60 s** após 10 min sem interação; **pausa** com a aba oculta (já é assim) + pull imediato no
`visibilitychange→visible`, no `focus` e no evento `online`. Backoff exponencial em erro.

**Percepção:** 3 s é "tempo real" para o caso de uso (o usuário troca de aparelho, não digita a
quatro mãos). Custo: ~1 200 requisições/hora/aba de ~40 bytes ≈ 50 KB/h — irrelevante no free tier
e **mais barato do que hoje**. Se a Fase 2 não sair antes do beta, **isto já entrega o pedido** de
forma honesta (rotulamos "sincroniza em segundos", não "tempo real instantâneo").

---

## 2. Fim do last-write-wins de blob: granularidade correta

### 2.1 Regra por tipo de dado

| Dado | Estratégia | Justificativa |
|---|---|---|
| **`movs`** | **União por `id`** (append-only) + LWW **por evento** para edição + **tombstone** para exclusão | É um log de eventos imutáveis; união é a operação natural e nunca perde um aporte |
| `carteira` | **Derivada** (`rebuildLots(MOVS)`) — deixa de ser sincronizada como verdade | Duas fontes de verdade = duas chances de divergir. Mantida no payload **só para leitura de cliente legado** |
| `watch` | União com tombstone (LWW-element-set) | Conjunto pequeno; adicionar em A e remover em B precisa convergir |
| `alerts` | União por `id` com tombstone + LWW por campo `status` | Idem; `status` muda sozinho quando dispara |
| `patHist` | União por data (já é hoje, l. 6397) | Série append-only; mantém-se |
| `profile` | **LWW por campo** | Conflito aqui é irrelevante e por-campo evita perder telefone ao editar nome no outro aparelho |
| `prefs`, `theme` | **LWW por campo** | Idem |
| `plan`/`sub` | **Fora do blob** (já é: `user_entitlement`) | Não regride |

### 2.2 Formato dos registros (wire format `schema: 3`)

```jsonc
// MOVS — evento vivo
{ "id":"m9x2k1", "type":"compra", "tk":"PETR4", "cotas":100, "preco":38.5,
  "date":"2026-08-01", "cur":"brl",
  "upd": 1754400000000,      // epoch ms da última edição (relógio do aparelho que editou)
  "dev": "a1b2c3d4" }        // id do aparelho (desempate determinístico + diagnóstico)

// MOVS — tombstone (registro apagado; payload descartado para economizar bytes)
{ "id":"m9x2k1", "del": 1754400500000, "dev":"e5f6a7b8" }

// watch (deixa de ser string[])
{ "tk":"HGLG11", "upd":1754400000000, "dev":"a1b2c3d4" }          // vivo
{ "tk":"HGLG11", "del":1754400900000, "dev":"a1b2c3d4" }          // removido

// prefs / profile com LWW por campo (mapa paralelo de carimbos)
"prefs":  { "chartType":"linha", "despesa":4200 },
"prefsT": { "chartType":1754400000000, "despesa":1754399000000 }
```

**Regra de merge (LWW-Element-Set — CRDT):** para cada `id`,
`mtime(r) = max(r.upd||0, r.del||0)`; vence o maior `mtime`; empate → maior `dev`
(comparação lexicográfica); empate total → registros são equivalentes.
Isso torna o merge **comutativo, associativo e idempotente** ⇒ **convergência garantida** sem
coordenação: os dois aparelhos chegam ao mesmo estado, na ordem que for.

> **Trade-off honesto:** `upd` vem do **relógio do cliente**. Um aparelho com hora muito adiantada
> ainda "ganha" numa edição do MESMO registro. O que muda — e é o ponto — é que ele **não leva
> mais os registros dos outros junto**. Perder uma *edição* de um evento é recuperável (o evento
> continua lá, dá para reeditar); perder *o evento* é o que não pode acontecer. Mitigação parcial:
> `upd` monotônico por aparelho, como já se faz em `touchState()` (l. 6335).

**Tombstones — política:** ficam no array e são **coletados após 180 dias** (`gcTombstones`). Um
aparelho que ficar mais de 180 dias offline e voltar **pode ressuscitar** um evento apagado.
É aceitável e documentado; a alternativa (guardar para sempre) incha o blob.

### 2.3 Escrita sem clobber: compare-and-swap no servidor

Merge no cliente não basta se dois aparelhos gravarem ao mesmo tempo (o segundo `UPSERT`
sobrescreve o primeiro, que ele nunca leu). Solução mínima: **`rev` + CAS**.

```sql
-- 1) coluna de revisão + trigger que a incrementa em QUALQUER caminho de escrita
alter table public.user_state add column if not exists rev bigint not null default 0;

create or replace function public.user_state_bump_rev() returns trigger
language plpgsql as $$
begin
  new.rev := coalesce(old.rev, 0) + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists user_state_rev_bump on public.user_state;
create trigger user_state_rev_bump before insert or update on public.user_state
  for each row execute function public.user_state_bump_rev();

-- 2) gravação com CAS. NOVA função (overload por nº de args) — a save_state(jsonb) de 1 arg
--    continua existindo e retornando bigint, então cliente ANTIGO não quebra.
create or replace function public.save_state_v2(p_data jsonb, p_base_rev bigint)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_ts   bigint;
  v_cur  public.user_state%rowtype;
  v_data jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_cur from public.user_state where user_id = auth.uid();

  -- conflito: alguém gravou entre o meu load e o meu save → devolvo o estado atual
  if v_cur.user_id is not null and p_base_rev is not null and v_cur.rev <> p_base_rev then
    return jsonb_build_object('ok', false, 'rev', v_cur.rev, 'data', v_cur.data);
  end if;

  v_ts   := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_data := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('ts', v_ts);
  insert into public.user_state (user_id, data, updated_at) values (auth.uid(), v_data, now())
    on conflict (user_id) do update set data = v_data, updated_at = now()
    returning rev into v_cur.rev;
  return jsonb_build_object('ok', true, 'rev', v_cur.rev, 'ts', v_ts);
end $$;

grant execute on function public.save_state_v2(jsonb, bigint) to authenticated;

-- 3) (Fase 2) notificação em tempo real, payload minúsculo, de QUALQUER caminho de escrita
create or replace function public.user_state_notify() returns trigger
language plpgsql security definer as $$
begin
  perform realtime.send(
    jsonb_build_object('rev', new.rev, 'ts', (new.data->>'ts')::bigint,
                       'dev', new.data->>'dev'),
    'state', 'user:' || new.user_id::text, true);
  return null;
end $$;

drop trigger if exists user_state_rt on public.user_state;
create trigger user_state_rt after insert or update on public.user_state
  for each row execute function public.user_state_notify();
```

**Protocolo do cliente (`_postCloud` reescrito):**

```
1. POST rpc/save_state_v2 { p_data: cloudPayload(), p_base_rev: _rev }
2. ok:true   → _rev = rev; _stateTs = ts; clearDirty(); setSync('ok')
3. ok:false  → mergeState(local, resp.data) → aplica → _rev = resp.rev → volta ao passo 1
               (máx. 3 tentativas; depois entra na fila de retry com backoff)
4. RPC ausente (404) → fallback save_state (v1) → fallback upsert direto   [caminho legado, intacto]
```

O CAS **elimina a perda por corrida** mesmo com Realtime desligado, e o merge garante que a
retentativa **não descarta nada**.

### 2.4 `user_state` continua? Tabela de eventos?

**Continua — e é a escolha certa para o beta.** Uma tabela `user_movs` (uma linha por evento,
sync incremental por cursor) é o desenho "certo" a longo prazo, mas custa: nova tabela + RLS +
migração de dados + paginação + reescrita completa do caminho de leitura/escrita, com risco alto
numa semana de prazo. Com **`rev` + CAS + merge por união no cliente** obtemos **o mesmo resultado
observável** (nada se perde, tudo converge) alterando ~1 coluna, 2 funções SQL e ~150 linhas de JS
testável. Fica registrado como **dívida pós-beta** (ver §6).

### 2.5 Migração sem quebrar quem já tem dados

Zero migração destrutiva. `mergeState` normaliza tudo na entrada:

1. **Registro sem `upd`/`dev`** (schema ≤ 2, local ou nuvem) → recebe `upd = <ts do blob>` e
   `dev = 'legacy'`. Efeito: uniões funcionam; entre um blob legado e um novo, o mais recente
   vence **por registro**, não por blob.
2. **`watch: string[]`** → `[{tk, upd:0, dev:'legacy'}]` via `normalizeWatch`. O payload
   **continua emitindo `watch` como `string[]`** (projeção dos vivos) por **um ciclo de release**,
   além do novo `watchV3` — cliente antigo continua funcionando.
3. **`carteira`** continua no payload como projeção de `MOVS` (leitura para cliente antigo);
   o cliente novo **nunca a adota como verdade** se houver `movs`.
4. **Exclusão feita em aparelho legado** não gera tombstone → o evento **ressuscita** enquanto os
   dois aparelhos não recarregarem a versão nova. Por isso: manter as blindagens atuais
   (`movsWipe`, "nuvem vazia não apaga") por **um ciclo** e removê-las depois — elas deixam de
   ser necessárias quando os dois lados falam `schema 3` (e é a remoção delas que finalmente
   resolve o **M1**: esvaziar a carteira passa a sincronizar de verdade, via tombstones).
5. **Rollback:** o payload é aditivo. Uma versão anterior do app lendo `schema 3` ignora
   `upd`/`dev`/`del` e usa `movs`/`watch`/`carteira` — degradado, mas funcional.
   *Ressalva honesta:* um cliente antigo **não filtra tombstones** — ele veria os apagados como
   eventos válidos. Mitigação: **emitir `movs` já filtrado** (só vivos) e carregar os tombstones
   numa chave separada `movsDel:[...]`, que o cliente antigo simplesmente ignora. **Adotar essa
   variante** — é uma linha a mais no `cloudPayload()` e elimina o risco.

---

## 3. Nunca perder dado silenciosamente

Quatro peças, todas de baixo custo:

**(a) Fila de mutações pendentes, persistida.** Nota importante: o *conteúdo* já está a salvo —
`localStorage` é a fonte local e sobrevive ao reload. O que falta persistir é o **fato** de haver
algo não confirmado + o diagnóstico. Substituir o booleano `_dirty` por:

```js
// lastro_sync_pending
{ since: 1754400000000,   // quando a 1ª mutação não confirmada aconteceu
  tries: 3, lastErr: "HTTP 401 · JWT expired", lastTry: 1754400300000 }
```

**(b) Retry com backoff.** `[3s, 10s, 30s, 60s, 300s]`, teto 5 min, com jitter; zera no sucesso.
Gatilhos extras de flush: `online`, `focus`, `visibilitychange→visible`, e antes de qualquer
`loadCloudState()` que adote a nuvem.

**(c) Estado visível na UI (hoje é código morto — §0.3).**
- Linha permanente no menu da conta: `acctMenuHTML()` (l. 5560) ganha, acima do "Sair", um
  `acct-item` com **bolinha** (verde `--brand` = ok / âmbar = pendente / vermelha `--dan` = erro)
  + `syncLabel()`, `onclick="syncNow()"`. **Esse é o call site que sumiu.**
- `syncLabel()` passa a incluir a pendência: *"3 alterações aguardando envio"*.
- **Faixa** discreta (não modal) no topo das views `painel`/`carteira` **só** quando
  `SYNC.state==='error'` há > 60 s ou `state==='auth'`, com botão "Tentar agora".
  Tokens de tema, sem cor fixa; testar claro/escuro.

**(d) Sessão expirada no meio.** `sbFetch` já tenta `refreshSession()` uma vez em 401 (l. 6181).
Falta o caminho de falha: se o refresh falhar, hoje **não acontece nada visível**. Passa a:
`setSync('auth', 'sessão expirada')` → faixa **"Sua sessão expirou. Entre novamente para salvar
suas alterações."** → `openAuth('login')`. **Nunca** limpar dado local nesse estado; a pendência
sobrevive e é enviada no relogin (o `save_state_v2` fará merge por CAS, então nada é
sobrescrito). `authLogout` (l. 6272) já pede confirmação quando o flush falha — manter.

**(e) Rede de segurança do beta (barata e de alto valor):**
- **Snapshot local antes de adotar a nuvem:** `lastro_bak_<ts>` com os 3 últimos estados locais,
  gravado no topo de `loadCloudState()` antes de qualquer escrita em `CARTEIRA`/`MOVS`.
  Restauração pelo Modo desenvolvedor (donos) — suficiente para "socorrer" um amigo no beta.
- **"Baixar meus dados" (JSON)** em Perfil → Segurança: `cloudPayload()` + `Blob` + `<a download>`.
  Zero backend, zero função Vercel. É a garantia real contra perda catastrófica.

---

## 4. Plano faseado

### Fase 0 — HOJE (sem refatorar nada) · esforço ~4 h · risco **baixo**

| # | O quê | Onde | Quem |
|---|---|---|---|
| 0.1 | Renderizar a linha de sync (bolinha + `syncLabel()` + `syncNow()`) no menu da conta | `acctMenuHTML()` l. 5560-5583 | frontend |
| 0.2 | Faixa de erro em `painel`/`carteira` quando `SYNC.state` é `error`(>60 s) / `auth` | `render`/`afterRender` + CSS por tokens | frontend |
| 0.3 | `lastro_sync_pending` (substitui `_dirty` booleano) + retry com backoff + flush em `online`/`focus` | l. 6310-6311, 6432-6452 | frontend |
| 0.4 | Estado `auth` quando o refresh falha; nunca apagar local | `sbFetch` l. 6175-6183, `refreshSession` l. 6159 | frontend |
| 0.5 | Poll barato: `select=rev,updated_at` antes de baixar `data`; cadência adaptativa 3/15/60 s | `loadCloudState` l. 6344, `setInterval` l. 6461 | frontend |
| 0.6 | `deviceId()` persistido (`lastro_dev`) + `dev` no payload | perto de `uid()` l. 4705 | frontend |
| 0.7 | Snapshot `lastro_bak_*` antes de adotar a nuvem + "Baixar meus dados" (JSON) | `loadCloudState` l. 6364, view `perfil` | frontend |
| 0.8 | SQL: coluna `rev` + trigger `user_state_bump_rev` (idempotente, não quebra cliente atual) | `backend/supabase/schema.sql` | backend |
| 0.9 | Corrigir o `HANDOFF.md` (a afirmação "status de sync visível" estava falsa) | `HANDOFF.md` | architect |

**Como verificar (0):** *(qa)*
1. DevTools → offline → editar a carteira → a bolinha fica âmbar e o rótulo diz "aguardando
   envio"; voltar online → em ≤ 10 s fica verde sem clique.
2. Forçar 401 (apagar `refresh_token` do `localStorage`) → editar → faixa "sessão expirou";
   relogar → a alteração sobe (conferir no Supabase Table Editor).
3. Recarregar com pendência → a bolinha continua âmbar (a pendência sobreviveu ao reload).
4. Aba B ociosa recebe a edição da aba A em ≤ 5 s (era até 15 s).
5. `rev` incrementa em toda gravação (SQL: `select rev from user_state where user_id=…`).

### Fase 1 — merge por união (**o coração**) · esforço ~1,5 dia · risco **médio**

| # | O quê | Onde | Quem |
|---|---|---|---|
| 1.1 | `vendor/sync.js` (UMD, **puro**) com a API da §5 | novo arquivo + `<script>` após a l. 4546 | finance/frontend |
| 1.2 | `test/sync.test.mjs` com **todos** os casos da §5.3 (escrever os testes ANTES) | novo arquivo | qa/finance |
| 1.3 | `cloudPayload()` → `schema:3`, `dev`, `movs` (vivos) + `movsDel`, `watchV3`+`watch` legado, `prefsT`/`profileT` | l. 6408 | frontend |
| 1.4 | `loadCloudState()` passa a **mesclar** (`LastroSync.mergeState`) em vez de escolher um lado | l. 6337-6405 | frontend |
| 1.5 | Mutações carimbam `upd`/`dev`: `addMov`/`editMov`/`removeMov` (tombstone!)/`removePosition` | l. 4754-4756, 4798 | frontend |
| 1.6 | `_postCloud` → `save_state_v2` com CAS + merge-e-retry (máx. 3) | l. 6416-6431 | backend/frontend |
| 1.7 | SQL `save_state_v2` (mantendo `save_state` v1) | `backend/supabase/schema.sql` | backend |
| 1.8 | `movsSave` corta por **data**, não por inserção; nunca corta acima do cap durante o merge | l. 4724 | finance |
| 1.9 | Auditoria do diff (iOS, tokens, segredos, `CSS chaves: 0 \| JS: OK`) | — | review |

**Como verificar (1):** *(qa — teste de dois aparelhos, obrigatório)*
- `node --test test/*.mjs` verde (inclui os casos de perda de dados que **falham** antes).
- **Playwright, dois contextos, mesma conta, mesma máquina:**
  1. Deixar **os dois offline**. A adiciona compra de PETR4; B adiciona compra de HGLG11.
  2. Voltar A online → sync. Depois B online → sync. Puxar em A.
  3. **Esperado: os dois mostram PETR4 E HGLG11**, com o mesmo patrimônio (centavo a centavo,
     comparando `deriveState` dos dois lados). *Hoje esse teste falha — um dos ativos some.*
  4. B apaga PETR4 → em ≤ 5 s A perde PETR4 **e ele não volta** após 3 ciclos de sync.
  5. A muda o tema; B muda a despesa mensal → **as duas** preferências sobrevivem.
  6. Esvaziar a carteira em A → B fica vazio (fecha o **M1**).

### Fase 2 — tempo real de verdade · esforço ~1 dia · risco **médio-baixo** (isolado)

| # | O quê | Onde | Quem |
|---|---|---|---|
| 2.1 | SQL: trigger `user_state_notify` (`realtime.send`, tópico privado `user:<uuid>`) + policy de leitura em `realtime.messages` | `schema.sql` | backend |
| 2.2 | `vendor/rt.js` — cliente Phoenix Channels mínimo: connect, join, heartbeat 30 s, reconnect com backoff, `access_token` a cada refresh | novo arquivo | backend/frontend |
| 2.3 | Ligação: ao receber `{rev}` > `_rev` → `loadCloudState()`; ao abrir socket → poll cai para 60 s; ao cair → volta a 3/15 s | perto da l. 6461 | frontend |
| 2.4 | Indicador "Ao vivo" no rótulo de sync (só quando o canal está aberto — sem mentir) | `syncLabel()` | frontend |

**Como verificar (2):** *(qa)* aba A edita → aba B **em outro dispositivo** reflete em < 2 s sem
tocar em nada; matar o WebSocket (DevTools → Network → offline no WS) → o rótulo "Ao vivo" some e
a sincronização continua por poll em ≤ 5 s; deixar 90 min aberto (atravessa a expiração do JWT) →
continua recebendo (prova que o `access_token` foi renovado no canal).

### Pós-beta (fora de escopo agora)

- Tabela `user_movs` (uma linha por evento) + sync incremental por cursor `since=rev`.
- Merge **no servidor** (plpgsql) para clientes que nunca abrirem a versão nova.
- Histórico/undo ("desfazer" a última sincronização) e restauração de backup pela UI do usuário.
- Relógio lógico (vetor de versões por device) para substituir o `upd` por relógio de parede.
- Compressão do blob / paginação do `patHist` quando o payload passar de ~200 KB.

---

## 5. Módulo puro e testado: `vendor/sync.js`

Mesmo padrão de `vendor/movs.js` e `vendor/instport.js`: UMD, **sem** `localStorage`, DOM, rede
ou relógio (o "agora" entra por `opts.now`). Testado com `node:test` em `test/sync.test.mjs`,
que já roda no CI (`.github/workflows/test.yml`).

### 5.1 API

```js
LastroSync = {
  SCHEMA: 3,

  // normaliza entrada legada (sem upd/dev, watch string[]) usando o ts do blob
  normalize(state, opts),                    // opts:{ ts, dev }  -> state schema 3

  // merge de log append-only por id (MOVS, alerts)
  mergeLog(a, b, opts),                      // opts:{ key:'id', now, tombstoneDays:180 }
                                             // -> { list, live, stats:{added,updated,deleted,kept} }

  // merge de conjunto (watch) — LWW-element-set por chave
  mergeSet(a, b, opts),                      // opts:{ key:'tk', now, tombstoneDays }

  // merge de mapa com LWW POR CAMPO (prefs, profile, theme)
  mergeMap(a, aT, b, bT),                    // -> { value, stamps }

  // merge de série por data (patHist)
  mergeSeries(a, b),                         // -> [{d,v}] ordenado, sem duplicata

  // orquestrador: recebe os dois estados inteiros e devolve o mesclado
  mergeState(local, remote, opts),           // -> { state, changed:boolean, stats, warnings:[] }

  // coleta de tombstones vencidos
  gcTombstones(list, opts),                  // opts:{ now, tombstoneDays, key }

  // helpers expostos para teste
  mtime(rec), pickWinner(x, y)
}
```

**Contrato inviolável do módulo** (escrever no cabeçalho, como nos outros vendors):
`mergeLog`/`mergeSet`/`mergeState` são **comutativos, associativos e idempotentes**. Qualquer
mudança futura que quebre uma dessas três propriedades quebra a convergência entre aparelhos.

### 5.2 Onde o app encosta no módulo

- `loadCloudState()` → `LastroSync.mergeState(localState(), d, {now:Date.now(), dev:deviceId()})`
  e aplica o resultado (uma única escrita em `MOVS`/`CARTEIRA`/`localStorage`, dentro do
  `_applyingCloud` que já existe, l. 6364).
- `_postCloud()` → em `ok:false` (conflito de `rev`), mesma chamada de merge e retenta.
- `addMov`/`editMov`/`removeMov` → carimbam `upd`/`dev`; `removeMov` **vira tombstone**
  (`{id, del, dev}`) em vez de `filter` (l. 4756).

### 5.3 Lista de casos de teste

**Perda de dados — HOJE FALHAM, depois passam (os que provam o pedido do Ramon):**
1. `união: A adiciona X, B adiciona Y (concorrentes) → merge contém X e Y`.
2. `união: A adiciona 3 compras offline, B adiciona 2 → 5 eventos, nenhum duplicado`.
3. `carteira bate: deriveState(mergeState(A,B)) === deriveState(mergeState(B,A))` (centavos).
4. `blob legado: remote schema 2 sem upd → nenhum evento local é perdido`.
5. `A edita o preço do evento X; B adiciona Y → a edição de A e o Y de B sobrevivem`.

**Exclusão (tombstones):**
6. `delete propaga: A apaga X → merge remove X do resultado vivo`.
7. `delete não ressuscita: merge(merge(A,B),B) continua sem X` (idempotência).
8. `edit-depois-de-delete (upd > del) → registro volta a viver`.
9. `delete-depois-de-edit (del > upd) → tombstone vence`.
10. `gcTombstones: del com 181 dias some; com 179 dias fica; registro VIVO com upd antigo NUNCA é removido`.

**Convergência (propriedades):**
11. `comutatividade: mergeLog(a,b) === mergeLog(b,a)` (deep-equal, ordem canônica).
12. `associatividade: merge(merge(a,b),c) === merge(a,merge(b,c))`.
13. `idempotência: merge(a,a) === a`.
14. `desempate determinístico: mesmo upd, devs diferentes → mesmo vencedor dos dois lados`.

**Demais domínios:**
15. `watch: A adiciona HGLG11, B remove PETR4 → resultado tem HGLG11 e não tem PETR4`.
16. `watch legado (string[]) normaliza sem perder ticker`.
17. `alerts: status 'disparado' em A vence 'ativo' antigo de B (LWW por upd)`.
18. `prefs por campo: A muda theme, B muda despesa → ambos preservados`.
19. `profile por campo: A edita nome, B edita telefone → ambos preservados`.
20. `patHist: união por data; mesma data com valores diferentes → vence o de maior upd/ts`.
21. `cap 5000: corte preserva os eventos MAIS RECENTES por data (hoje corta por inserção)`.
22. `payload inválido (null, string, array com null) não lança exceção e não apaga nada`.
23. `carteira derivada: mergeState não confia em remote.carteira quando há movs`.

**Integração com `vendor/movs.js`:**
24. `rebuildLots(merged) reproduz posições e caixa esperados após um merge de dois aparelhos`.

---

## 6. Trade-offs, riscos e o que NÃO é garantido

**Honestidade sobre limites:**
- **Não é garantido** que uma edição *do mesmo evento* nos dois aparelhos preserve as duas
  versões — vence a de maior `upd` (relógio do cliente). Garantido é que **nenhum evento
  desaparece**. Relógio de parede é a única opção realista sem relógio lógico (pós-beta).
- **Não é garantido** que um aparelho offline por > 180 dias não ressuscite um evento apagado
  (política de tombstones).
- **Não é "tempo real" antes da Fase 2** — na Fase 0/1 é "segundos". A UI deve dizer exatamente
  isso ("Sincronizado ✓" / "Ao vivo" só quando o canal estiver aberto de fato).
- **Realtime depende de infra de terceiro** (WS pode ser bloqueado por rede corporativa/operadora).
  Por isso ele é acelerador e o poll nunca é removido.
- **Limites do free tier** (conexões concorrentes, mensagens/mês) precisam ser **confirmados na
  página de pricing** antes de prometer; para um beta de dezenas de usuários, folga grande.
- **Custo do merge no cliente:** com ~5 000 eventos, o merge é O(n) sobre mapas — irrelevante
  (< 5 ms). O gargalo real é o `JSON.parse` do blob, que já existe hoje.

**Riscos de execução e mitigação:**
| Risco | Mitigação |
|---|---|
| Bug no merge apaga dados de todos de uma vez | Módulo **puro + 24 testes** rodando no CI antes do wiring; snapshot `lastro_bak_*` (0.7); "Baixar meus dados" |
| Cliente novo × cliente antigo durante o rollout | Payload aditivo, `movs` emitido só com vivos, `watch` legado mantido por 1 ciclo (§2.5) |
| SQL aplicado no Supabase e cliente antigo em cache | `save_state` v1 **intacto**; `save_state_v2` é overload; trigger de `rev` é transparente |
| Loop de sync (merge → save → notify → load → merge…) | `changed:false` no `mergeState` **não grava**; guarda `_applyingCloud` já existe; comparar `rev` antes de puxar |
| Escopo estourar antes do beta | Fases independentes: **0 sozinha já reduz muito o risco de perda**; 1 é a que faz a carteira bater; 2 é conforto |

**Fora de escopo neste plano:** entitlement/billing, notificações push, sync de dados de mercado
(cache de cotações), multiusuário/compartilhamento de carteira, e o `viewMetaRenda` órfão.

**Vercel:** nenhuma função nova. Continuamos **11/12** — todo o trabalho é cliente + Supabase.

---

## 7. Sequência recomendada de execução

```
architect (este doc)
  └─ Fase 0  frontend (0.1-0.7) ∥ backend (0.8)   → review → qa → publicar
       └─ Fase 1  qa/finance escrevem test/sync.test.mjs (falhando)
                  → finance/frontend vendor/sync.js → frontend wiring → backend SQL
                  → review (diff + iOS + validação) → qa (dois aparelhos) → publicar
            └─ Fase 2  backend (trigger + rt.js) → frontend (ligação) → qa → publicar
```

Antes de **cada** push (CLAUDE.md): `CSS chaves: 0 | JS: OK` + `node --test test/*.mjs`.
Depois de **cada** fase: atualizar o `HANDOFF.md` (estado real do sync) e, na Fase 1, o
`README.md` §6 (novo vendor) — a documentação atual **já está errada** sobre o status visível.

**Setup manual obrigatório** (registrar em `docs/plans/pendencias-manuais.md`): rodar o
`backend/supabase/schema.sql` atualizado no SQL Editor do Supabase a cada fase — sem isso, o
cliente cai nos fallbacks e o sync continua no modo antigo (degrada, não quebra).
