# Cross-device sync (optional)

Cadence is **local-first**. Everything lives in your browser's local storage and
the app is fully usable offline with no account. Sync is opt-in: turn it on only
if you want the same tasks on multiple devices (phone + laptop).

## How it works

- The Zustand `persist` store (localStorage) is always the working copy.
- When `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set, `src/lib/sync.ts`
  mirrors `tasks` + `completions` to Supabase and subscribes to realtime changes.
- Conflict policy: **last-writer-wins by row id** (remote wins on the first merge
  at load, then local edits push up debounced).
- `@supabase/supabase-js` is a lazy dynamic import — local-only users never pay
  for it in the main bundle.

## Setup (~5 min)

1. Create a free project at [supabase.com](https://supabase.com).
2. **Project Settings → API**: copy the Project URL and the `anon` public key.
3. In the repo, `cp .env.example .env` and paste both values in.
4. Open the Supabase **SQL Editor** and run the schema below.
5. Rebuild (`npm run build`) / restart `npm run dev`. Sync activates on load.

To share one dataset across devices, sign in with the same account on each. The
current adapter uses anonymous auth (per-device identity); swap in email/OAuth
auth in `startSync()` if you want a shared login.

## Schema

```sql
-- Tasks
create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb,                       -- not used by the row-shaped adapter; see note
  -- the adapter upserts full task columns; simplest is a jsonb mirror, but the
  -- code currently upserts the task object's own fields. Use the wide table below.
  created_at timestamptz default now()
);
```

> **Note:** `src/lib/sync.ts` upserts the full task/completion objects as columns
> (it spreads `...task` plus `user_id`). The simplest matching schema stores each
> as a wide row. If you prefer a single `jsonb` column instead, change `push()`
> to `{ id, user_id, data: task }` and `pull()`/`stripUser` to read `row.data`.

Wide-table version that matches the current code as-is:

```sql
create table if not exists public.tasks (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text,
  notes       text,
  priority    int,
  type        text,
  "date"      text,
  rrule       text,
  tags        jsonb,
  "createdAt" text,
  "order"     int
);

create table if not exists public.completions (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  "taskId"    text,
  "date"      text,
  "createdAt" text
);

alter table public.tasks       enable row level security;
alter table public.completions enable row level security;

create policy "own tasks"       on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own completions" on public.completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.tasks, public.completions;
```

Adjust column names to match `src/types.ts` if you change the task shape. The RLS
policies ensure each user only ever reads/writes their own rows.
