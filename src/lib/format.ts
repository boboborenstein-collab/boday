import { format } from 'date-fns'
import { fromDateStr } from './date'
import type { RecurringTask, TimeFormat } from '../types'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Human label for a recurrence pattern, e.g. "Weekdays", "Every 3 days". */
export function describeRecurrence(task: RecurringTask): string {
  const r = task.recurrence
  if (r.kind === 'daily') return 'Every day'
  if (r.kind === 'everyNDays') return r.n === 1 ? 'Every day' : `Every ${r.n} days`
  if (r.kind === 'monthly') {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = r.dateOfMonth % 100;
    const suffix = s[(v - 20) % 10] || s[v] || s[0];
    return `Monthly on the ${r.dateOfMonth}${suffix}`
  }

  const days = [...r.daysOfWeek].sort((a, b) => a - b)
  if (days.length === 0) return 'Never'
  if (days.length === 7) return 'Every day'
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Weekdays'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends'
  return days.map((d) => DOW[d]).join(', ')
}

/** "Monday, June 17" */
export function formatDateLong(dateStr: string): string {
  return format(fromDateStr(dateStr), 'EEEE, MMMM d')
}

/** "Jun 17" */
export function formatDateShort(dateStr: string): string {
  return format(fromDateStr(dateStr), 'MMM d')
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const HHMM_IN_TEXT = /\b([01]\d|2[0-3]):([0-5]\d)\b/g

function clock(hours: number, minutes: number, fmt: TimeFormat): string {
  const mm = String(minutes).padStart(2, '0')
  if (fmt === '24h') return `${String(hours).padStart(2, '0')}:${mm}`
  const period = hours >= 12 ? 'PM' : 'AM'
  return `${hours % 12 === 0 ? 12 : hours % 12}:${mm} ${period}`
}

/** "09:00" → "9:00 AM" (12h) or "09:00" (24h). Anything that is not HH:mm is returned as is. */
export function formatTime(hhmm: string, fmt: TimeFormat): string {
  const match = HHMM.exec(hhmm)
  if (!match) return hhmm
  return clock(Number(match[1]), Number(match[2]), fmt)
}

/** Rewrites every HH:mm inside a sentence (e.g. server-written warnings). */
export function formatTimesInText(text: string, fmt: TimeFormat): string {
  return text.replace(HHMM_IN_TEXT, (_m, h: string, m: string) => clock(Number(h), Number(m), fmt))
}

/** Local clock time of an ISO timestamp. */
export function formatIsoTime(iso: string, fmt: TimeFormat): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return clock(date.getHours(), date.getMinutes(), fmt)
}
