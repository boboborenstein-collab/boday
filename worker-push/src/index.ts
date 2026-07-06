// BoDay reminder push worker. Runs every minute: reads tasks, completions and
// push subscriptions from Supabase, finds reminders due at the current minute
// in each device's timezone, and sends Web Push notifications.
//
// Recurrence logic mirrors src/lib/recurrence.ts in the app (pure functions).

import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push'

interface Env {
  SUPABASE_URL: string
  SUPABASE_KEY: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
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
  scheduledDate: string
  completed: boolean
}
interface RecurringTask {
  id: string
  type: 'recurring'
  title: string
  priority: number
  reminderTime: string | null
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
async function sbSelect(env: Env, table: string): Promise<{ id: string; data: unknown }[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=id,data`, {
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` },
  })
  if (!res.ok) throw new Error(`${table} fetch failed: ${res.status}`)
  return res.json()
}

async function sbDelete(env: Env, table: string, id: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` },
  })
}

// ── main ─────────────────────────────────────────────────────────────────────
export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const [taskRows, compRows, subRows] = await Promise.all([
      sbSelect(env, 'tasks'),
      sbSelect(env, 'completions'),
      sbSelect(env, 'push_subscriptions'),
    ])
    if (!subRows.length) return

    const tasks = taskRows.map((r) => r.data as Task)
    const completions = compRows.map((r) => r.data as Completion)
    const doneToday = new Set(completions.map((c) => `${c.taskId}|${c.completionDate}`))

    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    }

    for (const row of subRows) {
      const { subscription, tz } = row.data as { subscription: PushSubscription; tz?: string }
      const { today, hhmm } = nowIn(tz || 'America/New_York')

      // A task is "pending today" if it should be acted on and isn't done yet.
      const pendingToday = (t: Task): boolean => {
        if (t.type === 'one_time') return !t.completed && t.scheduledDate <= today
        return occursOn(t, today) && !doneToday.has(`${t.id}|${today}`)
      }

      const messages: { title: string; body: string }[] = []

      for (const t of tasks) {
        if (!pendingToday(t)) continue

        // 1) On-time reminder at the task's own reminder time.
        if (t.reminderTime === hhmm) {
          messages.push({ title: 'BoDay', body: `Time for: ${t.title}` })
          continue
        }

        // 2) Escalating re-nudges after a missed reminder (same day, stateless:
        //    fires when the minutes elapsed since the reminder hit the schedule).
        if (t.reminderTime && t.reminderTime < hhmm) {
          const since = minutesBetween(t.reminderTime, hhmm)
          if (t.priority === 1 && since % 60 === 0) {
            messages.push({
              title: '🔴 BoDay — OVERDUE (P1)',
              body: `STILL NOT DONE: ${t.title} — ${since / 60}h past its time`,
            })
          } else if (t.priority === 2 && (since === 120 || since === 360)) {
            messages.push({ title: '🟠 BoDay — still pending', body: `${t.title} was due ${since / 60}h ago` })
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

      for (const msg of messages) {
        const payload = await buildPushPayload(
          {
            data: JSON.stringify({ ...msg, url: '/' }),
            options: { ttl: 300, urgency: 'high' },
          },
          subscription,
          vapid,
        )
        const res = await fetch(subscription.endpoint, payload)
        // Expired/revoked subscription: clean it up so we stop trying.
        if (res.status === 404 || res.status === 410) {
          await sbDelete(env, 'push_subscriptions', row.id)
          break
        }
      }
    }
  },
}
