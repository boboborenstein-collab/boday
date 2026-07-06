# Cross-device sync

BoDay is **local-first**: localStorage is always the working copy and the app
works fully offline. When `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are
set in `.env` (see `src/lib/sync.ts`), a background engine mirrors `tasks` +
`completions` to Supabase and subscribes to realtime changes from other
devices. Conflict policy: last-writer-wins by row id; local deletions
propagate remotely.

Single-user setup: every device uses the fixed identity `owner` — no login.
Each row stores the full app object in a `data` jsonb column.

## Schema (run in the Supabase SQL Editor)

```sql
create table public.tasks (
  id text primary key,
  user_id text not null,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table public.completions (
  id text primary key,
  user_id text not null,
  data jsonb not null,
  updated_at timestamptz default now()
);

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.completions;
```

RLS is off (Data API enabled, auto-RLS disabled). If the app ever grows real
accounts, switch `userId` in `startSync()` to Supabase auth and enable RLS.
