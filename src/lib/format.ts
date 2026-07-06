import { format } from 'date-fns'
import { fromDateStr } from './date'
import type { RecurringTask } from '../types'

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

/** "9:00 AM" from "09:00" */
export function formatReminder(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
