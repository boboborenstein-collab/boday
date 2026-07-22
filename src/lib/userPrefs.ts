import { getSupabase, isSupabaseConfigured } from './supabaseClient'

export type SnoozeMap = Record<string, string>

export interface UserPrefsEnvelope {
  quiet?: unknown
  cache?: unknown
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

async function sessionUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  const { data } = await getSupabase().auth.getSession()
  return data.session?.user.id ?? null
}

export async function loadUserPrefsEnvelope(): Promise<UserPrefsEnvelope> {
  const userId = await sessionUserId()
  if (!userId) return {}
  try {
    const { data, error } = await getSupabase()
      .from('user_prefs')
      .select('data')
      .eq('id', userId)
      .single()
    if (error || !data?.data) return {}
    const env = data.data as UserPrefsEnvelope
    if (env.snoozes) env.snoozes = pruneSnoozes(env.snoozes)
    return env
  } catch {
    return {}
  }
}

/** Deep-merge a patch into user_prefs.data (RPC when available). */
export async function mergeUserPrefsData(patch: Partial<UserPrefsEnvelope>): Promise<void> {
  const userId = await sessionUserId()
  if (!userId) return

  const payload = { ...patch }
  if (payload.snoozes) {
    payload.snoozes = pruneSnoozes(payload.snoozes)
  }

  const supabase = getSupabase()
  const { error: rpcErr } = await supabase.rpc('merge_user_prefs', {
    pref_id: userId,
    patch: payload,
  })

  if (!rpcErr) return

  const existing = await loadUserPrefsEnvelope()
  await supabase.from('user_prefs').upsert({
    id: userId,
    user_id: userId,
    data: mergeEnvelope(existing, payload),
  })
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
