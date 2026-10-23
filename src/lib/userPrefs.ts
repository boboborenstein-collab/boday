import { getSupabase, isSupabaseConfigured } from './supabaseClient'

export type SnoozeMap = Record<string, string>

export interface UserPrefsCache {
  fetchedAt?: string
  windows?: { start: string; end: string; title: string }[]
}

export interface AgentAiPrefs {
  provider: 'auto' | 'claude' | 'custom'
  model: string | null
  baseUrl: string | null
  keyCiphertext: string | null
}

export interface UserPrefsEnvelope {
  quiet?: unknown
  cache?: UserPrefsCache
  ai?: AgentAiPrefs
  calendarToken?: string
  snoozes?: SnoozeMap
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `tok-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Drop expired snooze keys so user_prefs doesn't grow forever. */
export function pruneSnoozes(map: SnoozeMap): SnoozeMap {
  const now = Date.now()
  const out: SnoozeMap = {}
  for (const [key, until] of Object.entries(map)) {
    if (Date.parse(until) > now) out[key] = until
  }
  return out
}

function mergeEnvelope(
  existing: UserPrefsEnvelope,
  patch: Partial<UserPrefsEnvelope>,
): UserPrefsEnvelope {
  const merged: UserPrefsEnvelope = { ...existing, ...patch }
  if (patch.snoozes) {
    merged.snoozes = pruneSnoozes({ ...(existing.snoozes ?? {}), ...patch.snoozes })
  }
  return merged
}

/** The slice of the Supabase client that prefs reads use (a fake in tests). */
export interface PrefsClient {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null } }> }
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: { data?: unknown } | null; error: unknown }>
      }
    }
    upsert(row: { id: string; user_id: string; data: UserPrefsEnvelope }): PromiseLike<{ error: unknown }>
  }
  rpc(fn: string, args: { pref_id: string; patch: Partial<UserPrefsEnvelope> }): PromiseLike<{ error: unknown }>
}

export type PrefsWrite = { ok: true } | { ok: false; message: string }

const WRITE_FAILED = "Couldn't save your settings. Try again."


export type UserPrefsLoad =
  | { ok: true; env: UserPrefsEnvelope }
  | { ok: false; reason: 'signed-out' | 'error' }

function defaultPrefsClient(): PrefsClient | null {
  return isSupabaseConfigured() ? (getSupabase() as unknown as PrefsClient) : null
}

/** Read user_prefs and say whether the read worked. A missing row is an empty envelope. */
export async function loadUserPrefsResult(
  client: PrefsClient | null = defaultPrefsClient(),
): Promise<UserPrefsLoad> {
  if (!client) return { ok: false, reason: 'signed-out' }
  try {
    const { data: auth } = await client.auth.getSession()
    const userId = auth.session?.user.id
    if (!userId) return { ok: false, reason: 'signed-out' }
    const { data, error } = await client.from('user_prefs').select('data').eq('id', userId).maybeSingle()
    if (error) return { ok: false, reason: 'error' }
    const env = (data?.data ?? {}) as UserPrefsEnvelope
    if (env.snoozes) env.snoozes = pruneSnoozes(env.snoozes)
    return { ok: true, env }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/** Best-effort read: any failure reads as an empty envelope. */
export async function loadUserPrefsEnvelope(): Promise<UserPrefsEnvelope> {
  const result = await loadUserPrefsResult()
  return result.ok ? result.env : {}
}

/**
 * Merge a patch into user_prefs.data (RPC when available) and say whether it was written.
 * The fallback read-modify-write refuses to run when the read fails, so it can never
 * replace the whole row with just the patch.
 */
export async function mergeUserPrefsData(
  patch: Partial<UserPrefsEnvelope>,
  client: PrefsClient | null = defaultPrefsClient(),
): Promise<PrefsWrite> {
  if (!client) return { ok: false, message: 'Sign in required.' }
  try {
    const { data: auth } = await client.auth.getSession()
    const userId = auth.session?.user.id
    if (!userId) return { ok: false, message: 'Sign in required.' }

    const payload = { ...patch }
    if (payload.snoozes) {
      payload.snoozes = pruneSnoozes(payload.snoozes)
    }

    const { error: rpcErr } = await client.rpc('merge_user_prefs', {
      pref_id: userId,
      patch: payload,
    })
    if (!rpcErr) return { ok: true }

    const existing = await loadUserPrefsResult(client)
    if (!existing.ok) return { ok: false, message: WRITE_FAILED }
    const { error } = await client.from('user_prefs').upsert({
      id: userId,
      user_id: userId,
      data: mergeEnvelope(existing.env, payload),
    })
    return error ? { ok: false, message: WRITE_FAILED } : { ok: true }
  } catch {
    return { ok: false, message: WRITE_FAILED }
  }
}

export async function ensureCalendarToken(): Promise<string | null> {
  const env = await loadUserPrefsEnvelope()
  if (env.calendarToken) return env.calendarToken
  const token = uuid().replace(/-/g, '')
  await mergeUserPrefsData({ calendarToken: token })
  return token
}

export async function setSnooze(taskId: string, dateStr: string, untilIso: string): Promise<void> {
  await mergeUserPrefsData({
    snoozes: { [`${taskId}|${dateStr}`]: untilIso },
  })
}

export async function clearSnooze(taskId: string, dateStr: string): Promise<void> {
  const env = await loadUserPrefsEnvelope()
  const snoozes = { ...(env.snoozes ?? {}) }
  delete snoozes[`${taskId}|${dateStr}`]
  await mergeUserPrefsData({ snoozes })
}
