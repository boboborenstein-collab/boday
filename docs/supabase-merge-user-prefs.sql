-- Atomic merge for user_prefs.data (avoids clobbering quiet/cache/snoozes/calendarToken).
-- Run once in the Supabase SQL editor.

create or replace function public.merge_user_prefs(pref_id text, patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

grant execute on function public.merge_user_prefs(text, jsonb) to authenticated, service_role;
