-- ════════════════════════════════════════════════════════════
-- LASTRO · Schema de Notícias (Supabase / Postgres)
-- Execute no SQL Editor do Supabase (uma vez).
-- ════════════════════════════════════════════════════════════

-- Tabela principal de notícias
create table if not exists public.news (
  id            bigint generated always as identity primary key,
  hash          text not null unique,           -- dedupe (hash do título+fonte)
  title         text not null,
  url           text,
  source        text,                            -- InfoMoney, CVM, etc.
  tag           text,                            -- Ações | FIIs | Stocks | Cripto | Mercado | BDRs
  ticker        text,                            -- ticker citado (ex: PETR4), se houver
  is_official   boolean default false,           -- true para Fato Relevante/CVM
  published_at  timestamptz,
  created_at    timestamptz default now()
);

create index if not exists news_published_idx on public.news (published_at desc);
create index if not exists news_tag_idx        on public.news (tag);

-- Tabela de metadados (ex: resumo do dia gerado por IA)
create table if not exists public.meta (
  key         text primary key,
  value       text,
  updated_at  timestamptz default now()
);

-- ─── Row Level Security ───────────────────────────────
-- Leitura pública (anon) liberada; escrita só com service_role (que ignora RLS).
alter table public.news enable row level security;
alter table public.meta enable row level security;

drop policy if exists "leitura pública news" on public.news;
create policy "leitura pública news" on public.news
  for select using (true);

drop policy if exists "leitura pública meta" on public.meta;
create policy "leitura pública meta" on public.meta
  for select using (true);

-- Limpeza opcional: remove notícias com mais de 30 dias (chame via cron se quiser)
-- delete from public.news where published_at < now() - interval '30 days';

-- ════════════════════════════════════════════════════════════
-- Estado do usuário (sync de carteira/watchlist/plano na nuvem)
-- Requer Supabase Auth (já habilitado por padrão).
-- ════════════════════════════════════════════════════════════
create table if not exists public.user_state (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);
alter table public.user_state enable row level security;

-- Cada usuário só acessa a própria linha
drop policy if exists "user_state select own" on public.user_state;
create policy "user_state select own" on public.user_state for select using (auth.uid() = user_id);

drop policy if exists "user_state insert own" on public.user_state;
create policy "user_state insert own" on public.user_state for insert with check (auth.uid() = user_id);

drop policy if exists "user_state update own" on public.user_state;
create policy "user_state update own" on public.user_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════
-- SINCRONIZAÇÃO entre aparelhos: gravação com carimbo do SERVIDOR.
-- Resolve o "clock-skew" (um aparelho com a hora errada ganhando sempre): o carimbo (ts) que
-- decide "quem é mais novo" passa a vir do relógio do BANCO, não do celular/PC. O cliente chama
-- rpc/save_state(p_data) e recebe de volta o ts autoritativo (epoch ms), já embutido em data.ts.
-- security invoker → roda como o próprio usuário; a RLS acima continua valendo (só a própria linha).
create or replace function public.save_state(p_data jsonb)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_ts   bigint;
  v_data jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  v_ts   := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_data := coalesce(p_data, '{}'::jsonb) || jsonb_build_object('ts', v_ts);
  insert into public.user_state (user_id, data, updated_at)
    values (auth.uid(), v_data, now())
  on conflict (user_id) do update
    set data = v_data, updated_at = now();
  return v_ts;
end;
$$;

grant execute on function public.save_state(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════
-- ENTITLEMENT (plano/assinatura) — FONTE DA VERDADE NO SERVIDOR.
-- O plano NÃO pode viver só no cliente: localStorage é forjável (qualquer um faria
-- `localStorage.lastro_plan='premium'`) e some no logout (assinante perde o Premium).
-- Aqui o cliente só LÊ a própria linha; NÃO há policy de insert/update para `authenticated`
-- → ninguém se auto-promove a Premium mexendo no navegador. A escrita legítima vem:
--   • hoje (provisório): pela RPC `grant_entitlement` (security definer) — checkout SIMULADO;
--   • no futuro: pelo webhook do gateway de pagamento rodando com service_role (ignora RLS).
-- ════════════════════════════════════════════════════════════
create table if not exists public.user_entitlement (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  plan                text not null default 'free',       -- 'free' | 'premium' | 'pro'
  tier                text,                                -- rótulo opcional do nível
  status              text not null default 'active',      -- active | canceled | past_due
  current_period_end  timestamptz,                         -- fim do período pago (null = sem validade)
  updated_at          timestamptz default now()
);
alter table public.user_entitlement enable row level security;

-- Só LEITURA para o dono. SEM policy de insert/update para `authenticated` → não é forjável.
drop policy if exists "entitlement select own" on public.user_entitlement;
create policy "entitlement select own" on public.user_entitlement
  for select using (auth.uid() = user_id);
-- (Quando houver gateway real, a escrita fica a cargo do webhook com service_role — que ignora
--  a RLS e dispensa policy. NÃO crie policy de escrita para `authenticated`.)

-- ─── RPC PROVISÓRIA (checkout SIMULADO) — REMOVER quando o pagamento real existir ───
-- security definer: roda como o dono da função (postgres) e grava mesmo sem policy de escrita.
-- Ainda é chamável por qualquer usuário autenticado (por isso PROVISÓRIA — não é anti-fraude),
-- mas já centraliza a verdade no SERVIDOR e faz o plano sobreviver ao logout/troca de aparelho.
create or replace function public.grant_entitlement(p_plan text, p_tier text default null, p_days int default 30)
returns public.user_entitlement
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
  v_row  public.user_entitlement;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_plan not in ('free','premium','pro') then
    raise exception 'invalid plan: %', p_plan;
  end if;
  v_days := least(greatest(coalesce(p_days, 30), 1), 366);   -- clamp defensivo
  insert into public.user_entitlement (user_id, plan, tier, status, current_period_end, updated_at)
    values (auth.uid(), p_plan, p_tier,
            case when p_plan = 'free' then 'canceled' else 'active' end,
            case when p_plan = 'free' then null else now() + (v_days || ' days')::interval end,
            now())
  on conflict (user_id) do update
    set plan = excluded.plan,
        tier = excluded.tier,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.grant_entitlement(text, text, int) from public;
grant execute on function public.grant_entitlement(text, text, int) to authenticated;
