-- BoDay agent traces. Owner step: run in the Supabase SQL editor.
-- Safe to run again: every statement is idempotent.
-- agent_tracer can INSERT rows and EXECUTE append_agent_feedback, nothing else.
-- It cannot SELECT, UPDATE, or DELETE. Feedback goes through the
-- security-definer function because the role cannot UPDATE.

create table if not exists public.agent_traces (
  id text primary key,
  user_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_traces_user_created
  on public.agent_traces (user_id, created_at desc);

alter table public.agent_traces enable row level security;

-- Supabase's default privileges grant anon and authenticated everything on new
-- public tables. Take that back; signed-in users only read their own rows.
revoke all on public.agent_traces from anon, authenticated;
grant select on public.agent_traces to authenticated;

drop policy if exists agent_traces_select_own on public.agent_traces;
create policy agent_traces_select_own
  on public.agent_traces
  for select
  to authenticated
  using (user_id = (select auth.uid())::text);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_tracer') then
    create role agent_tracer login nosuperuser nobypassrls;
  end if;
end
$$;

grant usage on schema public to agent_tracer;
revoke all on public.agent_traces from agent_tracer;
grant insert on public.agent_traces to agent_tracer;

drop policy if exists agent_traces_insert_tracer on public.agent_traces;
create policy agent_traces_insert_tracer
  on public.agent_traces
  for insert
  to agent_tracer
  with check (true);

create or replace function public.append_agent_feedback(
  p_run_id text,
  p_user_id text,
  p_event jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  update public.agent_traces
  set data = jsonb_set(
    data,
    '{feedback}',
    coalesce(data->'feedback', '[]'::jsonb) || jsonb_build_array(p_event),
    true
  )
  where id = p_run_id and user_id = p_user_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  return updated = 1;
end;
$$;

revoke all on function public.append_agent_feedback(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_agent_feedback(text, text, jsonb) to agent_tracer;

-- Retention is 30 days (spec §4). This file does not delete rows.
-- Owner step, once pg_cron is enabled (Database → Extensions):
--   select cron.schedule(
--     'agent-traces-retention',
--     '15 4 * * *',
--     $$delete from public.agent_traces where created_at < now() - interval '30 days'$$
--   );
