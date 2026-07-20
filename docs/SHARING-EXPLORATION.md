# Shared tasks / collaboration — exploration (2026-07-19)

Use case (from July 8 note): let a trusted partner (e.g. Charlotte) add tasks to
Jacob's list — full shared lists can come later.

## Where the infra stands today

- Multi-user email+password accounts exist (invite-only signup via the push worker).
- Supabase tables are `(id text pk, user_id text, data jsonb)` with RLS "own rows".
  Nothing in the schema or sync layer knows about more than one user per row.

## Options, simplest first

### 1. Shared account (works today, zero code)
Give her the login. Both phones see one list.
- ✅ Nothing to build. ❌ No separation: her edits are indistinguishable, one set
  of push subscriptions/streaks, and the password is shared.

### 2. "Send a task" inbox (recommended first build)
She gets her own invite/account. A worker endpoint `POST /send-task` (auth'd as
sender) inserts a task row with `user_id = recipient` via the service key, plus a
small "from Charlotte" marker in the task jsonb. A `partners` table (or a field
in `data`) whitelists who may send to whom.
- ✅ No RLS or sync-layer changes — the row lands as a normal task and syncs down.
- ✅ Matches the actual ask ("she can add things to mine"), keeps accounts separate.
- ✅ Same pattern as the planned iOS-Shortcut inbox endpoint (Apple Calendar stage 2)
  — one inbox mechanism can serve both.
- ❌ One-directional; no live co-editing of a task.

### 3. Full shared lists / spaces (roadmap "bigger swing")
A `spaces` table + membership; tasks get a `space_id`; RLS policies become
"member of the row's space"; the client sync layer, zustand store, and conflict
handling all have to become space-aware.
- ✅ The real household/grocery-list feature. ❌ Touches every layer (RLS, sync,
  store, UI); do it deliberately, not as a side quest.

## Recommendation
Do option 2 when ready — it is a small worker endpoint + a "Share to…" UI
affordance, reuses the invite-code admin patterns, and is a stepping stone to
option 3 without committing to its schema. Until then, option 1 costs nothing.
