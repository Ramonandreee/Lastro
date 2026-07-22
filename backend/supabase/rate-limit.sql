-- ════════════════════════════════════════════════════════════
-- LASTRO · Rate limiting DURÁVEL (Supabase / Postgres)
-- ────────────────────────────────────────────────────────────
-- Limitador compartilhado entre TODAS as instâncias serverless (o limitador em
-- memória do /api/ai não persiste entre instâncias). Contador atômico por janela
-- (bucket), chaveado pelo usuário AUTENTICADO (auth.uid()) — o cliente não pode
-- falsificar a chave nem contar por outro usuário.
--
-- Execute no SQL Editor do Supabase (uma vez). Sem isso, o /api/ai cai no
-- limitador em memória (best-effort) automaticamente.
-- ════════════════════════════════════════════════════════════

create table if not exists public.rate_limits (
  key     text   not null,          -- "<user_id>:<escopo>"
  bucket  bigint not null,          -- floor(epoch/janela)
  count   int    not null default 0,
  primary key (key, bucket)
);

-- Sem acesso direto: a tabela só é tocada pela RPC (security definer). RLS ligada
-- e SEM policies = nega qualquer select/insert/update via PostgREST pelo cliente.
alter table public.rate_limits enable row level security;

-- Verifica-e-incrementa atômico. Retorna TRUE se dentro do limite, FALSE se estourou.
create or replace function public.rl_check(p_scope text, p_limit int, p_window int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_bucket bigint;
  v_key    text;
  v_count  int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return false;                                  -- sem sessão válida: nega
  end if;
  v_bucket := floor(extract(epoch from now()) / greatest(p_window, 1));
  v_key    := v_uid::text || ':' || coalesce(p_scope, '');
  insert into public.rate_limits (key, bucket, count) values (v_key, v_bucket, 1)
    on conflict (key, bucket) do update set count = public.rate_limits.count + 1
    returning count into v_count;
  return v_count <= greatest(p_limit, 1);
end;
$$;

grant execute on function public.rl_check(text, int, int) to authenticated;

-- RECOMENDADO: agende a limpeza dos buckets antigos (senão a tabela cresce sem parar).
-- No Supabase → Database → Cron (pg_cron), rode de hora em hora:
--   select cron.schedule('rl_cleanup', '0 * * * *',
--     $$ delete from public.rate_limits where bucket < floor(extract(epoch from now())/60) - 1440 $$);
-- (remove buckets com mais de ~1 dia; ajuste conforme suas janelas.)
