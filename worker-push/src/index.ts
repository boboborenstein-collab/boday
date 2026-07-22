// BoDay reminder push worker. Runs every minute: reads tasks, completions and
// push subscriptions from Supabase, finds reminders due at the current minute
// in each device's timezone, and sends Web Push notifications.
//
// Recurrence logic mirrors src/lib/recurrence.ts in the app (pure functions).

import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push'

interface Env {
  SUPABASE_URL: string
  SUPABASE_KEY: string
  /** Service-role key (secret). Required once RLS is enabled — the publishable key can no longer read. */
  SUPABASE_SERVICE_KEY?: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  ADMIN_EMAIL: string
}

type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; daysOfWeek: number[] }
  | { kind: 'everyNDays'; n: number }
  | { kind: 'monthly'; dateOfMonth: number }

interface OneTimeTask {
  id: string
  type: 'one_time'
  title: string
  priority: number
  reminderTime: string | null
  renudgeMinutes?: number | null
  scheduledDate: string
  completed: boolean
}
interface RecurringTask {
  id: string
  type: 'recurring'
  title: string
  priority: number
  reminderTime: string | null
  renudgeMinutes?: number | null
  startDate: string
  endDate: string | null
  recurrence: Recurrence
}
type Task = OneTimeTask | RecurringTask
interface Completion {
  taskId: string
  completionDate: string
}

// ── date helpers ('yyyy-MM-dd' strings; tz-independent via UTC) ─────────────
function utc(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const dayOfWeek = (dateStr: string) => new Date(utc(dateStr)).getUTCDay()
const dayOfMonth = (dateStr: string) => new Date(utc(dateStr)).getUTCDate()
const diffDays = (a: string, b: string) => Math.round((utc(a) - utc(b)) / 86_400_000)

/** Local time of the once-a-day summary push. */
const DIGEST_TIME = '09:00'

/** Minutes from 'HH:mm' a to 'HH:mm' b (same day, b >= a). */
function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  return bh * 60 + bm - (ah * 60 + am)
}

function occursOn(task: RecurringTask, dateStr: string): boolean {
  if (dateStr < task.startDate) return false
  if (task.endDate && dateStr > task.endDate) return false
  switch (task.recurrence.kind) {
    case 'daily':
      return true
    case 'weekly':
      return task.recurrence.daysOfWeek.includes(dayOfWeek(dateStr))
    case 'everyNDays': {
      const n = task.recurrence.n
      if (n <= 0) return false
      const diff = diffDays(dateStr, task.startDate)
      return diff >= 0 && diff % n === 0
    }
    case 'monthly':
      return dayOfMonth(dateStr) === task.recurrence.dateOfMonth
  }
}

/** Current 'yyyy-MM-dd' and 'HH:mm' in a given IANA timezone. */
function nowIn(tz: string): { today: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    today: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${get('hour')}:${get('minute')}`,
  }
}

// ── supabase REST ────────────────────────────────────────────────────────────
function sbKey(env: Env): string {
  return env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY
}

async function sbSelect(env: Env, table: string): Promise<{ id: string; user_id: string; data: unknown }[]> {
  const key = sbKey(env)
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=id,user_id,data`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`${table} fetch failed: ${res.status}`)
  return res.json()
}

async function sbDelete(env: Env, table: string, id: string): Promise<void> {
  const key = sbKey(env)
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
}

async function sbUpsert(
  env: Env,
  table: string,
  row: { id: string; user_id: string; data: unknown },
): Promise<void> {
  const key = sbKey(env)
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([row]),
  })
}

// ── Shabbat / Yom Tov quiet mode ─────────────────────────────────────────────
// While a user is inside a Shabbat or holiday window (candle lighting →
// havdalah, from Hebcal for their saved location) ALL pushes are suppressed:
// reminders, re-nudges and the digest. Windows are cached in the user_prefs
// row and refreshed by this worker every ~3 days.

interface QuietWindow {
  start: string
  end: string
  title: string
}
interface UserPrefsData {
  /**
   * locationId is 'geoname:<id>' or 'zip:<code>' — Hebcal's autocomplete
   * returns BOTH shapes (a ZIP search hits its zip index, not geonames), and
   * the Hebcal API takes a different query param for each (geonameid vs zip).
   */
  quiet?: { enabled: boolean; locationId: string; locationName?: string }
  cache?: { fetchedAt: string; windows: QuietWindow[] }
  calendarToken?: string
  snoozes?: Record<string, string>
}

/** 'geoname:5110302' -> '&geonameid=5110302'; 'zip:07631' -> '&zip=07631'. */
function locationQueryParam(locationId: string): string {
  const [kind, id] = locationId.split(':')
  return kind === 'zip' ? `&zip=${encodeURIComponent(id)}` : `&geonameid=${encodeURIComponent(id)}`
}

/** Pair Hebcal candles/havdalah items into absolute quiet windows. */
function computeQuietWindows(
  items: { category: string; date: string; title: string }[],
): QuietWindow[] {
  const sorted = items
    .filter((i) => i.category === 'candles' || i.category === 'havdalah')
    .sort((a, b) => a.date.localeCompare(b.date))
  const windows: QuietWindow[] = []
  let open: { start: string; title: string } | null = null
  for (const it of sorted) {
    if (it.category === 'candles') {
      // A second candle lighting inside an open window (multi-day chag,
      // chag into Shabbat) keeps the window open — ignore it.
      if (!open) open = { start: it.date, title: it.title }
    } else if (open) {
      windows.push({ start: open.start, end: it.date, title: open.title })
      open = null
    }
  }
  return windows
}

const dateStrUTC = (d: Date) => d.toISOString().slice(0, 10)

/** Refresh a user's cached quiet windows from Hebcal if stale. Never throws. */
async function freshQuietWindows(
  env: Env,
  row: { id: string; user_id: string; data: unknown },
): Promise<QuietWindow[]> {
  const data = (row.data ?? {}) as UserPrefsData
  const quiet = data.quiet
  if (!quiet?.enabled || !quiet.locationId) return []

  const cached = data.cache
  const now = Date.now()
  const lastEnd = cached?.windows.length
    ? Date.parse(cached.windows[cached.windows.length - 1].end)
    : 0
  const stale =
    !cached ||
    now - Date.parse(cached.fetchedAt) > 72 * 3_600_000 ||
    lastEnd < now + 48 * 3_600_000

  if (!stale) return cached.windows

  try {
    const start = dateStrUTC(new Date(now - 86_400_000))
    const end = dateStrUTC(new Date(now + 9 * 86_400_000))
    const res = await fetch(
      `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&c=on&M=on&start=${start}&end=${end}${locationQueryParam(quiet.locationId)}`,
    )
    if (!res.ok) throw new Error(`hebcal ${res.status}`)
    const body = (await res.json()) as { items?: { category: string; date: string; title: string }[] }
    const windows = computeQuietWindows(body.items ?? [])
    await mergeUserPrefs(env, row.user_id, {
      cache: { fetchedAt: new Date(now).toISOString(), windows },
    })
    return windows
  } catch (e) {
    console.log(`quiet window refresh failed for ${row.user_id}: ${String(e)}`)
    return cached?.windows ?? []
  }
}

function inQuietWindow(windows: QuietWindow[], now: number): QuietWindow | null {
  for (const w of windows) {
    if (Date.parse(w.start) <= now && now <= Date.parse(w.end)) return w
  }
  return null
}

/** GET /geo?q= — CORS-friendly proxy for Hebcal's location autocomplete. */
async function handleGeo(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q) return json([])
  try {
    const res = await fetch(`https://www.hebcal.com/complete.php?q=${encodeURIComponent(q)}`)
    if (!res.ok) return json([])
    const items = (await res.json()) as { id: number | string; geo: string; value: string }[]
    return json(
      items
        .slice(0, 8)
        .map((i) => ({ locationId: `${i.geo === 'zip' ? 'zip' : 'geoname'}:${i.id}`, name: i.value })),
    )
  } catch {
    return json([])
  }
}

// ── invite-only signup ───────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function serviceHeaders(env: Env): Record<string, string> {
  const key = sbKey(env)
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

function pruneSnoozes(map: Record<string, string>): Record<string, string> {
  const now = Date.now()
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (Date.parse(v) > now) out[k] = v
  }
  return out
}

/** Atomic jsonb merge (see docs/supabase-merge-user-prefs.sql). */
async function mergeUserPrefs(env: Env, userId: string, patch: UserPrefsData): Promise<void> {
  const bodyPatch = { ...patch }
  if (bodyPatch.snoozes) {
    bodyPatch.snoozes = pruneSnoozes(bodyPatch.snoozes)
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/merge_user_prefs`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify({ pref_id: userId, patch: bodyPatch }),
  })
  if (res.ok) return

  const prefRows = await sbSelect(env, 'user_prefs').catch(() => [])
  const row = prefRows.find((r) => r.user_id === userId)
  const existing = (row?.data ?? {}) as UserPrefsData
  const merged: UserPrefsData = { ...existing, ...bodyPatch }
  if (bodyPatch.snoozes) {
    merged.snoozes = pruneSnoozes({ ...(existing.snoozes ?? {}), ...bodyPatch.snoozes })
  }
  await sbUpsert(env, 'user_prefs', { id: userId, user_id: userId, data: merged })
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  let s = ''
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return `BODAY-${s}`
}

/** Resolve the caller's Supabase user from their access token; null if invalid. */
async function getCaller(req: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.json()
}

async function handleSignup(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    password?: string
    code?: string
  }
  const email = body.email?.trim()
  const password = body.password ?? ''
  const code = body.code?.trim().toUpperCase()
  if (!email || password.length < 6 || !code) {
    return json({ error: 'Enter your email, a password of at least 6 characters, and an invite code.' }, 400)
  }

  const rows = (await (
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/invite_codes?code=eq.${encodeURIComponent(code)}&select=code,used_by`,
      { headers: serviceHeaders(env) },
    )
  ).json()) as { code: string; used_by: string | null }[]
  if (!rows.length || rows[0].used_by) {
    return json({ error: "That invite code isn't valid." }, 400)
  }

  const createRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const created = (await createRes.json()) as { id?: string; msg?: string; message?: string }
  if (!createRes.ok || !created.id) {
    return json({ error: created.msg || created.message || 'Could not create the account.' }, 400)
  }

  await fetch(`${env.SUPABASE_URL}/rest/v1/invite_codes?code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify({ used_by: created.id, used_at: new Date().toISOString() }),
  })

  return json({ ok: true })
}

async function handleInvites(req: Request, env: Env): Promise<Response> {
  const caller = await getCaller(req, env)
  if (!caller) return json({ error: 'Sign in required.' }, 401)
  if (caller.email !== env.ADMIN_EMAIL) return json({ error: 'Admin only.' }, 403)

  if (req.method === 'POST') {
    const code = generateCode()
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/invite_codes`, {
      method: 'POST',
      headers: { ...serviceHeaders(env), Prefer: 'return=minimal' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) return json({ error: `Could not create code (${res.status}).` }, 500)
    return json({ code })
  }

  // GET: list codes newest-first, resolving claimant emails.
  const rows = (await (
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/invite_codes?select=code,created_at,used_by,used_at&order=created_at.desc`,
      { headers: serviceHeaders(env) },
    )
  ).json()) as { code: string; created_at: string; used_by: string | null; used_at: string | null }[]

  const invites = await Promise.all(
    rows.map(async (r) => {
      let used_by_email: string | null = null
      if (r.used_by) {
        const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${r.used_by}`, {
          headers: serviceHeaders(env),
        })
        if (res.ok) used_by_email = ((await res.json()) as { email?: string }).email ?? null
      }
      return { code: r.code, created_at: r.created_at, used_by_email, used_at: r.used_at }
    }),
  )
  return json({ invites })
}

// ── calendar feed (.ics) ─────────────────────────────────────────────────────
function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(utc(dateStr))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function icsTimedEnd(dateStr: string, hhmm: string, durationMin = 30): { date: string; hhmm: string } {
  const [hh, mm] = hhmm.split(':').map(Number)
  let mins = hh * 60 + mm + durationMin
  let date = dateStr
  if (mins >= 24 * 60) {
    date = addDaysStr(dateStr, 1)
    mins -= 24 * 60
  }
  const eh = Math.floor(mins / 60)
  const em = mins % 60
  return {
    date,
    hhmm: `${String(eh).padStart(2, '0')}${String(em).padStart(2, '0')}00`,
  }
}

function buildIcs(tasks: Task[], completions: Completion[], fromDate: string): string {
  const doneToday = new Set(completions.map((c) => `${c.taskId}|${c.completionDate}`))
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BoDay//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'NAME:BoDay',
  ]
  const endHorizon = addDaysStr(fromDate, 90)
  for (const t of tasks) {
    if (t.type === 'one_time') {
      if (t.scheduledDate < fromDate || t.scheduledDate > endHorizon) continue
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${t.id}@boday`)
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`)
      if (t.reminderTime) {
        const [hh, mm] = t.reminderTime.split(':')
        const start = `${t.scheduledDate.replace(/-/g, '')}T${hh}${mm}00`
        const end = icsTimedEnd(t.scheduledDate, t.reminderTime)
        lines.push(`DTSTART:${start}`)
        lines.push(`DTEND:${end.date.replace(/-/g, '')}T${end.hhmm}`)
        lines.push(`SUMMARY:${icsEscape(t.title)}`)
      } else {
        lines.push(`DTSTART;VALUE=DATE:${t.scheduledDate.replace(/-/g, '')}`)
        lines.push(`DTEND;VALUE=DATE:${addDaysStr(t.scheduledDate, 1).replace(/-/g, '')}`)
        lines.push(`SUMMARY:${icsEscape(t.title)}`)
      }
      if (t.completed) lines.push('STATUS:COMPLETED')
      lines.push('END:VEVENT')
    } else {
      for (let d = fromDate; d <= endHorizon; d = addDaysStr(d, 1)) {
        if (!occursOn(t, d)) continue
        lines.push('BEGIN:VEVENT')
        lines.push(`UID:${t.id}-${d}@boday`)
        lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`)
        if (t.reminderTime) {
          const [hh, mm] = t.reminderTime.split(':')
          const start = `${d.replace(/-/g, '')}T${hh}${mm}00`
          const end = icsTimedEnd(d, t.reminderTime)
          lines.push(`DTSTART:${start}`)
          lines.push(`DTEND:${end.date.replace(/-/g, '')}T${end.hhmm}`)
        } else {
          lines.push(`DTSTART;VALUE=DATE:${d.replace(/-/g, '')}`)
          lines.push(`DTEND;VALUE=DATE:${addDaysStr(d, 1).replace(/-/g, '')}`)
        }
        lines.push(`SUMMARY:${icsEscape(t.title)}`)
        if (doneToday.has(`${t.id}|${d}`)) lines.push('STATUS:COMPLETED')
        lines.push('END:VEVENT')
      }
    }
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

async function handleCalendarFeed(
  env: Env,
  token: string,
  prefRows: { id: string; user_id: string; data: unknown }[],
  taskRows: { id: string; user_id: string; data: unknown }[],
  compRows: { id: string; user_id: string; data: unknown }[],
): Promise<Response> {
  const owner = prefRows.find(
    (r) => (r.data as UserPrefsData).calendarToken === token,
  )
  if (!owner) return new Response('Not found', { status: 404 })
  const userId = owner.user_id
  const tasks = taskRows.filter((r) => r.user_id === userId).map((r) => r.data as Task)
  const completions = compRows
    .filter((r) => r.user_id === userId)
    .map((r) => r.data as Completion)
  const today = new Date().toISOString().slice(0, 10)
  const body = buildIcs(tasks, completions, today)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  })
}

// ── share task ───────────────────────────────────────────────────────────────
async function findUserByEmail(env: Env, email: string): Promise<{ id: string } | null> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    headers: serviceHeaders(env),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { users?: { id: string; email?: string }[] }
  const hit = data.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  return hit ? { id: hit.id } : null
}

async function handleShare(req: Request, env: Env, taskRows: { id: string; user_id: string; data: unknown }[]): Promise<Response> {
  const caller = await getCaller(req, env)
  if (!caller) return json({ error: 'Sign in required.' }, 401)
  const body = (await req.json().catch(() => ({}))) as { taskId?: string; toEmail?: string }
  const taskId = body.taskId?.trim()
  const toEmail = body.toEmail?.trim().toLowerCase()
  if (!taskId || !toEmail) return json({ error: 'taskId and toEmail required.' }, 400)

  const row = taskRows.find((r) => r.user_id === caller.id && r.id === taskId)
  if (!row) return json({ error: 'Task not found.' }, 404)

  const assignee = await findUserByEmail(env, toEmail)
  if (!assignee) return json({ error: 'No BoDay account for that email yet.' }, 404)
  if (assignee.id === caller.id) return json({ error: "Can't share with yourself." }, 400)

  const src = row.data as Task & { assignedByEmail?: string; assignedFromTaskId?: string }
  const copyId = crypto.randomUUID()
  const base = {
    ...src,
    id: copyId,
    assignedByEmail: caller.email,
    assignedFromTaskId: taskId,
    createdAt: new Date().toISOString(),
  }
  const copy =
    src.type === 'one_time'
      ? { ...base, completed: false, completedAt: null }
      : base
  await sbUpsert(env, 'tasks', { id: copyId, user_id: assignee.id, data: copy })
  return json({ ok: true, id: copyId })
}

// ── push notification actions (done / snooze) ────────────────────────────────
async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.VAPID_PRIVATE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signPushAction(
  env: Env,
  payload: { u: string; t: string; d: string; exp: number },
): Promise<string> {
  const key = await hmacKey(env)
  const body = new TextEncoder().encode(JSON.stringify(payload))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, body))
  return `${b64url(body)}.${b64url(sig)}`
}

async function verifyPushAction(
  env: Env,
  token: string,
): Promise<{ userId: string; taskId: string; date: string } | null> {
  const [bodyPart, sigPart] = token.split('.')
  if (!bodyPart || !sigPart) return null
  const body = Uint8Array.from(atob(bodyPart.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  )
  const sig = Uint8Array.from(atob(sigPart.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  )
  const key = await hmacKey(env)
  const ok = await crypto.subtle.verify('HMAC', key, sig, body)
  if (!ok) return null
  const payload = JSON.parse(new TextDecoder().decode(body)) as {
    u: string
    t: string
    d: string
    exp: number
  }
  if (payload.exp < Date.now()) return null
  return { userId: payload.u, taskId: payload.t, date: payload.d }
}

async function handlePushAction(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { token?: string; action?: string }
  const parsed = body.token ? await verifyPushAction(env, body.token) : null
  if (!parsed) return json({ error: 'Invalid or expired token.' }, 400)

  const taskRows = await sbSelect(env, 'tasks')
  const row = taskRows.find((r) => r.user_id === parsed.userId && r.id === parsed.taskId)
  if (!row) return json({ error: 'Task gone.' }, 404)
  const task = row.data as Task

  if (body.action === 'done') {
    if (task.type === 'one_time') {
      if (task.completed) return json({ ok: true })
      await sbUpsert(env, 'tasks', {
        id: row.id,
        user_id: parsed.userId,
        data: { ...task, completed: true, completedAt: new Date().toISOString() },
      })
    } else {
      const compRows = await sbSelect(env, 'completions')
      const exists = compRows.some((r) => {
        if (r.user_id !== parsed.userId) return false
        const c = r.data as Completion & { skipped?: boolean }
        return (
          c.taskId === parsed.taskId &&
          c.completionDate === parsed.date &&
          !c.skipped
        )
      })
      if (exists) return json({ ok: true })
      const compId = crypto.randomUUID()
      await sbUpsert(env, 'completions', {
        id: compId,
        user_id: parsed.userId,
        data: {
          id: compId,
          taskId: parsed.taskId,
          completionDate: parsed.date,
          completedAt: new Date().toISOString(),
        },
      })
    }
    return json({ ok: true })
  }

  if (body.action === 'snooze30') {
    const until = new Date(Date.now() + 30 * 60_000).toISOString()
    await mergeUserPrefs(env, parsed.userId, {
      snoozes: { [`${parsed.taskId}|${parsed.date}`]: until },
    })
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
}

function isSnoozed(snoozes: Record<string, string> | undefined, taskId: string, date: string): boolean {
  const until = snoozes?.[`${taskId}|${date}`]
  if (!until) return false
  return Date.parse(until) > Date.now()
}

// ── main ─────────────────────────────────────────────────────────────────────
export default {
  // Manual test: GET /test sends a test push to every subscription and
  // reports the push service's response status for each.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (url.pathname === '/signup' && req.method === 'POST') return handleSignup(req, env)
    if (url.pathname === '/invites') return handleInvites(req, env)
    if (url.pathname === '/geo') return handleGeo(req)
    if (url.pathname === '/share' && req.method === 'POST') {
      const taskRows = await sbSelect(env, 'tasks')
      return handleShare(req, env, taskRows)
    }
    if (url.pathname === '/push-action' && req.method === 'POST') return handlePushAction(req, env)

    const calMatch = url.pathname.match(/^\/cal\/([a-zA-Z0-9]+)\.ics$/)
    if (calMatch && req.method === 'GET') {
      const [taskRows, compRows, prefRows] = await Promise.all([
        sbSelect(env, 'tasks'),
        sbSelect(env, 'completions'),
        sbSelect(env, 'user_prefs').catch(() => []),
      ])
      return handleCalendarFeed(env, calMatch[1], prefRows, taskRows, compRows)
    }

    if (url.pathname !== '/test') return new Response('boday-push ok', { status: 200 })

    const subRows = await sbSelect(env, 'push_subscriptions')
    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    }
    const results: unknown[] = []
    for (const row of subRows) {
      const { subscription } = row.data as { subscription: PushSubscription }
      try {
        const payload = await buildPushPayload(
          {
            data: JSON.stringify({ title: 'BoDay', body: 'Test push — it works! 🎉', url: '/' }),
            options: { ttl: 300, urgency: 'high' },
          },
          subscription,
          vapid,
        )
        const res = await fetch(subscription.endpoint, payload)
        results.push({ endpoint: subscription.endpoint.slice(0, 60), status: res.status, body: await res.text() })
      } catch (e) {
        results.push({ endpoint: subscription.endpoint.slice(0, 60), error: String(e) })
      }
    }
    return Response.json(results)
  },
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const [taskRows, compRows, subRows, prefRows] = await Promise.all([
      sbSelect(env, 'tasks'),
      sbSelect(env, 'completions'),
      sbSelect(env, 'push_subscriptions'),
      sbSelect(env, 'user_prefs').catch(() => []),
    ])
    if (!subRows.length) return

    // Quiet windows + snoozes per user (refreshing stale caches from Hebcal).
    const quietByUser = new Map<string, QuietWindow[]>()
    const snoozesByUser = new Map<string, Record<string, string>>()
    for (const r of prefRows) {
      quietByUser.set(r.user_id, await freshQuietWindows(env, r))
      snoozesByUser.set(r.user_id, pruneSnoozes((r.data as UserPrefsData).snoozes ?? {}))
    }

    // Group by user so each device only gets its owner's reminders.
    const tasksByUser = new Map<string, Task[]>()
    for (const r of taskRows) {
      const list = tasksByUser.get(r.user_id) ?? []
      list.push(r.data as Task)
      tasksByUser.set(r.user_id, list)
    }
    const doneByUser = new Map<string, Set<string>>()
    for (const r of compRows) {
      const c = r.data as Completion
      const set = doneByUser.get(r.user_id) ?? new Set<string>()
      set.add(`${c.taskId}|${c.completionDate}`)
      doneByUser.set(r.user_id, set)
    }

    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    }

    for (const row of subRows) {
      const { subscription, tz } = row.data as { subscription: PushSubscription; tz?: string }
      const { today, hhmm } = nowIn(tz || 'America/New_York')

      // Shabbat / Yom Tov: total silence for this user.
      const quietWin = inQuietWindow(quietByUser.get(row.user_id) ?? [], Date.now())
      if (quietWin) {
        console.log(`quiet mode active for ${row.user_id} until ${quietWin.end}`)
        continue
      }
      const tasks = tasksByUser.get(row.user_id) ?? []
      const doneToday = doneByUser.get(row.user_id) ?? new Set<string>()
      const snoozes = snoozesByUser.get(row.user_id) ?? {}

      // A task is "pending today" if it should be acted on and isn't done yet.
      const pendingToday = (t: Task): boolean => {
        if (t.type === 'one_time') return !t.completed && t.scheduledDate <= today
        return occursOn(t, today) && !doneToday.has(`${t.id}|${today}`)
      }

      const messages: { title: string; body: string; taskId?: string; actionToken?: string }[] = []

      for (const t of tasks) {
        if (!pendingToday(t)) continue
        if (isSnoozed(snoozes, t.id, today)) continue

        const exp = Date.now() + 60 * 60 * 1000
        const actionToken = await signPushAction(env, {
          u: row.user_id,
          t: t.id,
          d: today,
          exp,
        })

        // 1) On-time reminder at the task's own reminder time.
        if (t.reminderTime === hhmm) {
          messages.push({
            title: 'BoDay',
            body: `Time for: ${t.title}`,
            taskId: t.id,
            actionToken,
          })
          continue
        }

        // 2) Escalating re-nudges after a missed reminder (same day, stateless:
        //    fires when the minutes elapsed since the reminder hit the schedule).
        if (t.reminderTime && t.reminderTime < hhmm) {
          const since = minutesBetween(t.reminderTime, hhmm)
          const ago = since % 60 === 0 ? `${since / 60}h` : `${since}m`
          if (t.renudgeMinutes === null || t.renudgeMinutes === 0) {
            // explicitly off
          } else if (typeof t.renudgeMinutes === 'number') {
            // per-task cadence chosen in the editor
            if (since % t.renudgeMinutes === 0) {
              messages.push(
                t.priority === 1
                  ? {
                      title: '🔴 BoDay — OVERDUE (P1)',
                      body: `STILL NOT DONE: ${t.title} — ${ago} past its time`,
                      taskId: t.id,
                      actionToken,
                    }
                  : {
                      title: '🟠 BoDay — still pending',
                      body: `${t.title} was due ${ago} ago`,
                      taskId: t.id,
                      actionToken,
                    },
              )
            }
          } else if (t.priority === 1 && since % 60 === 0) {
            // default: P1 nags hourly
            messages.push({
              title: '🔴 BoDay — OVERDUE (P1)',
              body: `STILL NOT DONE: ${t.title} — ${ago} past its time`,
              taskId: t.id,
              actionToken,
            })
          } else if (t.priority === 2 && (since === 120 || since === 360)) {
            // default: P2 nudges at 2h and 6h
            messages.push({
              title: '🟠 BoDay — still pending',
              body: `${t.title} was due ${ago} ago`,
              taskId: t.id,
              actionToken,
            })
          }
        }
      }

      // 3) Morning digest at DIGEST_TIME local: today's plan + overdue emphasis.
      if (hhmm === DIGEST_TIME) {
        const pending = tasks.filter(pendingToday)
        const overdue = pending.filter((t) => t.type === 'one_time' && t.scheduledDate < today)
        const p1Overdue = overdue.filter((t) => t.priority === 1)
        if (pending.length) {
          let body = `${pending.length} task${pending.length === 1 ? '' : 's'} on your plate today`
          if (overdue.length) body += ` — ⚠️ ${overdue.length} overdue`
          if (p1Overdue.length) body += `. 🔴 Top priority: ${p1Overdue[0].title}`
          messages.push({ title: 'BoDay — your day', body })
        }
      }

      console.log(`tick tz=${tz} today=${today} hhmm=${hhmm} tasks=${tasks.length} messages=${messages.length}`)

      for (const msg of messages) {
        const payload = await buildPushPayload(
          {
            data: JSON.stringify({
              title: msg.title,
              body: msg.body,
              url: '/',
              taskId: msg.taskId,
              dateStr: today,
              actionToken: msg.actionToken,
            }),
            options: { ttl: 300, urgency: 'high' },
          },
          subscription,
          vapid,
        )
        const res = await fetch(subscription.endpoint, payload)
        console.log(`sent "${msg.body}" -> ${res.status}`)
        // Expired/revoked subscription: clean it up so we stop trying.
        if (res.status === 404 || res.status === 410) {
          await sbDelete(env, 'push_subscriptions', row.id)
          break
        }
      }
    }
  },
}
