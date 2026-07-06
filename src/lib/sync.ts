// ─────────────────────────────────────────────────────────────────────────
// Cross-device sync (Supabase adapter)
//
// BoDay is LOCAL-FIRST: the zustand `persist` store (localStorage) is always
// the working copy, so the app is fully functional offline with no account.
//
// When Supabase credentials are present in the environment, this module
// activates a background sync engine that mirrors `tasks` + `completions`
// to/from Supabase and listens for realtime changes from other devices.
//
// To go live (see SYNC.md for the full SQL schema + RLS):
//   1. Create a Supabase project.
//   2. Add to `.env`:
//        VITE_SUPABASE_URL=...
//        VITE_SUPABASE_ANON_KEY=...
//   3. Run the schema in SYNC.md. Done — sync activates on next load.
//
// Conflict policy: last-writer-wins by row id (remote wins on initial merge).
// The supabase-js client is loaded via dynamic import so users who never
// configure sync don't pay for the dependency in their main bundle.
// ─────────────────────────────────────────────────────────────────────────

import { useStore } from '../store/useStore'
import type { Task, TaskCompletion } from '../types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export function isSyncConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

// Row shapes mirror the app types with a user_id added by the engine.
type TaskRow = Task & { user_id: string }
type CompletionRow = TaskCompletion & { user_id: string }

function stripUser<T extends { user_id?: string }>(row: T): Omit<T, 'user_id'> {
  const { user_id: _omit, ...rest } = row
  return rest
}

/** Merge remote rows into local state, remote winning on id collisions. */
function mergeById<T extends { id: string }>(local: T[], remote: T[], pulledIds?: Set<string>): T[] {
  const map = new Map<string, T>()
  for (const r of local) map.set(r.id, r)
  for (const r of remote) {
    if (pulledIds?.has(r.id) && !map.has(r.id)) {
      continue
    }
    map.set(r.id, r)
  }
  return [...map.values()]
}

/**
 * Start the sync engine. No-op (returns a no-op disposer) when unconfigured.
 * Safe to call once at app start.
 */
export async function startSync(): Promise<() => void> {
  if (!isSyncConfigured()) return () => {}

  let pulledTaskIds = new Set<string>()
  let pulledCompletionIds = new Set<string>()

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)

  // Identify the user. Anonymous auth gives a stable per-session identity;
  // signing in with the same email on another device shares the dataset.
  let { data } = await supabase.auth.getSession()
  if (!data.session) {
    const res = await supabase.auth.signInAnonymously()
    data = res.data
  }
  const userId = data.session?.user.id
  if (!userId) return () => {}

  let applyingRemote = false

  const pull = async () => {
    const [{ data: tRows }, { data: cRows }] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', userId),
      supabase.from('completions').select('*').eq('user_id', userId),
    ])
    const precedingTasks = new Set(pulledTaskIds)
    const precedingCompletions = new Set(pulledCompletionIds)

    pulledTaskIds = new Set((tRows ?? []).map((r) => r.id))
    pulledCompletionIds = new Set((cRows ?? []).map((r) => r.id))

    applyingRemote = true
    const s = useStore.getState()
    useStore.setState({
      tasks: mergeById(s.tasks, (tRows ?? []).map((r) => stripUser(r as TaskRow) as Task), precedingTasks),
      completions: mergeById(
        s.completions,
        (cRows ?? []).map((r) => stripUser(r as CompletionRow) as TaskCompletion),
        precedingCompletions
      ),
    })
    applyingRemote = false
  }

  const push = async (tasks: Task[], completions: TaskCompletion[]) => {
    const taskRows: TaskRow[] = tasks.map((t) => ({ ...t, user_id: userId }))
    const compRows: CompletionRow[] = completions.map((c) => ({ ...c, user_id: userId }))

    const deletedTaskIds = Array.from(pulledTaskIds).filter((id) => !tasks.some((t) => t.id === id))
    const deletedCompIds = Array.from(pulledCompletionIds).filter((id) => !completions.some((c) => c.id === id))

    await Promise.all([
      taskRows.length && supabase.from('tasks').upsert(taskRows),
      compRows.length && supabase.from('completions').upsert(compRows),
    ])

    await Promise.all([
      deletedTaskIds.length && supabase.from('tasks').delete().eq('user_id', userId).in('id', deletedTaskIds),
      deletedCompIds.length && supabase.from('completions').delete().eq('user_id', userId).in('id', deletedCompIds),
    ])

    for (const t of tasks) pulledTaskIds.add(t.id)
    for (const id of deletedTaskIds) pulledTaskIds.delete(id)
    for (const c of completions) pulledCompletionIds.add(c.id)
    for (const id of deletedCompIds) pulledCompletionIds.delete(id)
  }

  // Initial reconcile: pull remote, then push the merged set back up.
  await pull()
  const init = useStore.getState()
  await push(init.tasks, init.completions)

  // Realtime: any change from another device re-pulls + merges.
  const channel = supabase
    .channel('boday-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => void pull())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, () => void pull())
    .subscribe()

  // Local → remote: debounced push on any data change we didn't cause.
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubStore = useStore.subscribe((state, prev) => {
    if (applyingRemote) return
    if (state.tasks === prev.tasks && state.completions === prev.completions) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void push(state.tasks, state.completions), 600)
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsubStore()
    void supabase.removeChannel(channel)
  }
}
