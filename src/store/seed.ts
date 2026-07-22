// Adversarial seed data for `npm run test:logic` only — not loaded by the app.
// Generated RELATIVE to a given "today" so the Today view exercises every rule: carry-over (incl. multi-day), due-today,
// future (must hide), completed (must hide), checked recurring, open
// recurring, every-N-days anchoring, and real streaks.

import { addDays, subDays } from 'date-fns'
import { fromDateStr, toDateStr } from '../lib/date'
import { occursOn } from '../lib/recurrence'
import type { RecurringTask, Task, TaskCompletion } from '../types'

export function makeSeed(today: string): {
  tasks: Task[]
  completions: TaskCompletion[]
} {
  const base = fromDateStr(today)
  const daysAgo = (n: number) => toDateStr(subDays(base, n))
  const daysAhead = (n: number) => toDateStr(addDays(base, n))
  const ts = (dateStr: string, hh = '08') => `${dateStr}T${hh}:00:00.000Z`

  const tasks: Task[] = [
    // ── One-time ──────────────────────────────────────────────────────────
    {
      id: 'ot-drycleaning',
      type: 'one_time',
      title: 'Pick up dry cleaning',
      notes: 'Ticket #4821 — closes at 6pm',
      priority: 2,
      scheduledDate: daysAgo(3), // carried over 3 days
      completed: false,
      completedAt: null,
      reminderTime: null,
      createdAt: ts(daysAgo(3)),
    },
    {
      id: 'ot-landlord',
      type: 'one_time',
      title: 'Reply to landlord about lease',
      priority: 1,
      scheduledDate: today, // due today
      completed: false,
      completedAt: null,
      reminderTime: '09:00',
      createdAt: ts(today),
    },
    {
      id: 'ot-gift',
      type: 'one_time',
      title: 'Buy birthday gift for Sam',
      notes: 'Party is Saturday',
      priority: 3,
      scheduledDate: daysAhead(2), // future — must NOT appear in Today
      completed: false,
      completedAt: null,
      reminderTime: null,
      createdAt: ts(today),
    },
    {
      id: 'ot-expense',
      type: 'one_time',
      title: 'Submit expense report',
      priority: 1,
      scheduledDate: daysAgo(1),
      completed: true, // done — must NOT appear in Today
      completedAt: ts(daysAgo(1), '15'),
      reminderTime: null,
      createdAt: ts(daysAgo(2)),
    },
    {
      id: 'ot-gym',
      type: 'one_time',
      title: 'Renew gym membership',
      priority: 4,
      scheduledDate: daysAgo(6), // carried over 6 days
      completed: false,
      completedAt: null,
      reminderTime: null,
      createdAt: ts(daysAgo(6)),
    },

    // ── Recurring ─────────────────────────────────────────────────────────
    {
      id: 'rt-workout',
      type: 'recurring',
      title: 'Morning workout',
      notes: '20 min',
      priority: 2,
      recurrence: { kind: 'daily' },
      startDate: daysAgo(30),
      endDate: null,
      reminderTime: '06:30',
      createdAt: ts(daysAgo(30)),
    },
    {
      id: 'rt-torah',
      type: 'recurring',
      title: 'Daily Torah learning',
      priority: 1,
      recurrence: { kind: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] }, // Mon–Fri
      startDate: daysAgo(60),
      endDate: null,
      reminderTime: '07:00',
      createdAt: ts(daysAgo(60)),
    },
    {
      id: 'rt-plants',
      type: 'recurring',
      title: 'Water the plants',
      priority: 3,
      recurrence: { kind: 'everyNDays', n: 3 },
      startDate: daysAgo(6), // anchored so today is an occurrence (6 % 3 === 0)
      endDate: null,
      reminderTime: null,
      createdAt: ts(daysAgo(6)),
    },
    {
      id: 'rt-standup',
      type: 'recurring',
      title: 'Team standup',
      notes: '15 min — #eng',
      priority: 2,
      recurrence: { kind: 'weekly', daysOfWeek: [1, 3, 5] }, // Mon/Wed/Fri
      startDate: daysAgo(40),
      endDate: null,
      reminderTime: '09:15',
      createdAt: ts(daysAgo(40)),
    },
  ]

  const completions: TaskCompletion[] = []
  const addC = (taskId: string, dateStr: string) =>
    completions.push({
      id: `c-${taskId}-${dateStr}`,
      taskId,
      completionDate: dateStr,
      completedAt: ts(dateStr, '07'),
    })

  // Morning workout: done the last 4 days, skipped day 5, today still open.
  // → current streak should be 4 (today forgiven).
  for (const n of [1, 2, 3, 4]) addC('rt-workout', daysAgo(n))

  // Water the plants: occurrences at today / -3 / -6, all done (incl. today).
  // → renders checked today, streak 3.
  for (const n of [0, 3, 6]) addC('rt-plants', daysAgo(n))

  // Torah (Mon–Fri) & standup (Mon/Wed/Fri): complete every prior occurrence
  // in the last 3 weeks; leave today open. Real streaks regardless of weekday.
  const recur = (id: string) => tasks.find((t) => t.id === id) as RecurringTask
  for (let n = 1; n <= 21; n++) {
    const d = daysAgo(n)
    if (occursOn(recur('rt-torah'), d)) addC('rt-torah', d)
    if (occursOn(recur('rt-standup'), d)) addC('rt-standup', d)
  }

  return { tasks, completions }
}
