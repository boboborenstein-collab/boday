// Generates the TS<->Python recurrence parity fixture (stdout).
// Run: TZ=America/New_York npx tsx scripts/gen-recurrence-parity.ts > agent/tests/fixtures/recurrence_parity.json
import { addDays, subDays } from 'date-fns'
import { fromDateStr, toDateStr } from '../src/lib/date'
import { buildDayList, buildTodayList, occursOn } from '../src/lib/recurrence'
import { makeSeed } from '../src/store/seed'
import type { RecurringTask, Task } from '../src/types'

const TODAY = '2026-06-17'
const seed = makeSeed(TODAY)

const syn = (id: string, recurrence: RecurringTask['recurrence'], startDate: string, endDate?: string | null): RecurringTask => ({
  id,
  type: 'recurring',
  title: id,
  priority: 3,
  recurrence,
  startDate,
  endDate: endDate ?? null,
  reminderTime: null,
  createdAt: `${startDate}T08:00:00.000Z`,
} as RecurringTask)

const tasks: Task[] = [
  ...seed.tasks,
  syn('syn-monthly-31', { kind: 'monthly', dateOfMonth: 31 }, '2026-06-01'),
  syn('syn-every-0', { kind: 'everyNDays', n: 0 }, '2026-06-01'),
  syn('syn-ended', { kind: 'daily' }, '2026-06-10', '2026-06-20'),
  // Sunday (0) and Saturday (6): the parity range must include positive hits, not only misses.
  syn('syn-weekly-sun-sat', { kind: 'weekly', daysOfWeek: [0, 6] }, '2026-06-01'),
  {
    id: 'ot-completed-utc-midnight',
    type: 'one_time',
    title: 'Completed near UTC midnight',
    priority: 3,
    scheduledDate: TODAY,
    completed: true,
    // 03:30Z is 23:30 the previous calendar day in New York (EDT, UTC-4):
    // still TODAY locally, already the next day in UTC.
    completedAt: '2026-06-18T03:30:00.000Z',
    reminderTime: null,
    createdAt: `${TODAY}T08:00:00.000Z`,
  },
]

const base = fromDateStr(TODAY)
const dates: string[] = []
for (let i = -10; i <= 45; i++) dates.push(toDateStr(i < 0 ? subDays(base, -i) : addDays(base, i)))

const occurs: Record<string, string[]> = {}
for (const t of tasks) {
  if (t.type === 'recurring') occurs[t.id] = dates.filter((d) => occursOn(t, d))
}
const day_lists: Record<string, string[]> = {}
for (const d of dates) day_lists[d] = buildDayList(tasks, seed.completions, d).map((i) => i.task.id)

const today_lists: Record<string, [string, number, boolean, boolean][]> = {}
for (const n of [-1, 0, 1, 3]) {
  const t = toDateStr(addDays(base, n))
  today_lists[t] = buildTodayList(tasks, seed.completions, t).map((i) => [
    i.task.id, i.carriedOverFromDays, i.completed, i.skipped,
  ])
}

console.log(JSON.stringify({
  today: TODAY, timezone: 'America/New_York', tasks, completions: seed.completions,
  occurs, day_lists, today_lists,
}, null, 2))
