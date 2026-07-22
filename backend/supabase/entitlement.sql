-- ════════════════════════════════════════════════════════════
-- LASTRO · Entitlement (plano) server-side — Supabase / Postgres
-- ────────────────────────────────────────────────────────────
-- Problema (C1 da auditoria): o plano PRO era decidido só no cliente → paywall
-- contornável. Aqui a FONTE DE VERDADE do plano passa a ser o banco: o usuário
-- LÊ a própria linha (RLS) mas NÃO escreve; PRO é concedido por trial carimbado
-- pelo servidor (start_trial) ou por admin/billing (service_role). Os recursos
-- gatilhados no servidor (ex.: /api/ai) consultam `my_plan()`.
--
-- Retrocompatível: enquanto esta migração NÃO for aplicada, /api/ai ignora o
-- gate de plano (comportamento atual). Nada quebra.
-- Execute no SQL Editor do Supabase (uma vez).
-- ════════════════════════════════════════════════════════════

create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'free' check (plan in ('free','premium','pro')),
  trial_started_at   timestamptz,
  current_period_end timestamptz,                 -- fim do trial/período; null = sem expiração (admin/billing)
  source             text,                         -- 'trial' | 'admin' | 'billing'
  updated_at         timestamptz default now()
);
alter table public.subscriptions enable row level security;

-- Usuário LÊ a própria linha; NÃO há policy de insert/update → só service_role/RPC controlada escreve.
drop policy if exists "sub select own" on public.subscriptions;
create policy "sub select own" on public.subscriptions for select using (auth.uid() = user_id);

-- Plano EFETIVO do usuário logado (expira trial vencido → 'free'). Fonte de verdade server-side.
create or replace function public.my_plan()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare v public.subscriptions;
begin
  if auth.uid() is null then return 'free'; end if;
  select * into v from public.subscriptions where user_id = auth.uid();
  if v.user_id is null then return 'free'; end if;
  if v.current_period_end is not null and v.current_period_end < now() then return 'free'; end if;
  return v.plan;
end;
$$;
grant execute on function public.my_plan() to authenticated;

-- Inicia o teste PRO (uma vez; carimbado pelo servidor). NÃO renova se já existe registro.
create or replace function public.start_trial(p_days int default 7)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_days int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  -- CLAMP no servidor: o cliente NÃO controla a duração (evita trial "vitalício" via p_days gigante).
  v_days := least(greatest(coalesce(p_days, 7), 1), 31);
  -- on conflict do nothing: cada usuário faz o trial UMA vez (não renova).
  insert into public.subscriptions (user_id, plan, trial_started_at, current_period_end, source)
    values (auth.uid(), 'pro', now(), now() + make_interval(days => v_days), 'trial')
  on conflict (user_id) do nothing;
  return public.my_plan();
end;
$$;
grant execute on function public.start_trial(int) to authenticated;

-- ── Conceder PRO manualmente (admin), rodando com service_role no SQL Editor: ──
--   insert into public.subscriptions (user_id, plan, source)
--   values ('<uuid-do-usuario>', 'pro', 'admin')
--   on conflict (user_id) do update set plan='pro', source='admin', current_period_end=null, updated_at=now();
