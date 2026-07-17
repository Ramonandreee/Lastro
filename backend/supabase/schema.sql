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
