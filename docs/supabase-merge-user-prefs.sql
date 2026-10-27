-- Atomic merge for user_prefs.data (avoids clobbering quiet/cache/snoozes/calendarToken).
-- Run in the Supabase SQL editor. Safe to run again.
--
-- SECURITY DEFINER bypasses RLS, so the function checks the caller itself:
-- a signed-in user may only write their own row; the push worker calls it with
-- the service key (no auth.uid()), and anon cannot call it at all.

create or replace function public.merge_user_prefs(pref_id text, patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and pref_id is distinct from auth.uid()::text then
    raise exception 'merge_user_prefs: not your row' using errcode = '42501';
  end if;

  insert into public.user_prefs (id, user_id, data)
  values (pref_id, pref_id, patch)
  on conflict (id) do update set
    data =
      (coalesce(public.user_prefs.data, '{}'::jsonb) - 'snoozes')
      || (patch - 'snoozes')
      || case
           when patch ? 'snoozes' then jsonb_build_object(
             'snoozes',
             coalesce(public.user_prefs.data->'snoozes', '{}'::jsonb)
               || coalesce(patch->'snoozes', '{}'::jsonb)
           )
           else '{}'::jsonb
         end,
    updated_at = now();
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which includes anon.
revoke execute on function public.merge_user_prefs(text, jsonb) from public, anon;
grant execute on function public.merge_user_prefs(text, jsonb) to authenticated, service_role;
