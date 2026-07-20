// Streak math for recurring tasks.
//
// A streak counts consecutive SCHEDULED OCCURRENCES (not calendar days) that
// have a completion, walking backward from `today`. For a Mon/Wed/Fri task,
// Wednesday → Monday counts as consecutive.
//
// Today-rule: if today is itself a scheduled occurrence but not yet completed,
// it does NOT break the streak — it's still "open". We simply start counting
// from the previous occurrence. Any EARLIER missed occurrence does break it.

import { differenceInCalendarDays, subDays } from 'date-fns'
import { fromDateStr, toDateStr } from './date'
import { occursOn } from './recurrence'
import type { RecurringTask, TaskCompletion } from '../types'

const MAX_LOOKBACK_DAYS = 366 * 5

export function currentStreak(
  task: RecurringTask,
  completions: TaskCompletion[],
  today: string,
): number {
  const done = new Set(
    completions
      .filter((c) => c.taskId === task.id)
      .map((c) => c.completionDate),
  )

  const start = fromDateStr(task.startDate)
  let cursor = fromDateStr(today)
  let streak = 0
  let walked = 0

  while (differenceInCalendarDays(cursor, start) >= 0 && walked < MAX_LOOKBACK_DAYS) {
    const ds = toDateStr(cursor)
    if (occursOn(task, ds)) {
      if (done.has(ds)) {
        streak++
      } else if (ds === today) {
        // Today's occurrence is still open — forgive it, keep counting back.
      } else {
        break
      }
    }
    cursor = subDays(cursor, 1)
    walked++
  }
  return streak
}

/**
 * Lifetime history for a recurring task, from `startDate` through `today`.
 * Today's occurrence is still "open": it counts as scheduled but never as
 * missed, and it only enters `pct` once completed.
 */
export interface RecurringHistory {
  /** Calendar days the task has been on (start → today, inclusive). */
  daysOn: number
  /** Scheduled occurrences so far (including today's, if any). */
  scheduled: number
  completed: number
  /** Past occurrences with no completion. */
  missed: number
  /** completed / (completed + missed), or 0 with no closed occurrences. */
  pct: number
}

export function recurringHistory(
  task: RecurringTask,
  completions: TaskCompletion[],
  today: string,
): RecurringHistory {
  const done = new Set(
    completions
      .filter((c) => c.taskId === task.id)
      .map((c) => c.completionDate),
  )

  const start = fromDateStr(task.startDate)
  let cursor = fromDateStr(today)
  const daysOn = Math.max(0, differenceInCalendarDays(cursor, start) + 1)
  let scheduled = 0
  let completed = 0
  let missed = 0
  let walked = 0

  while (differenceInCalendarDays(cursor, start) >= 0 && walked < MAX_LOOKBACK_DAYS) {
    const ds = toDateStr(cursor)
    if (occursOn(task, ds)) {
      scheduled++
      if (done.has(ds)) completed++
      else if (ds !== today) missed++
    }
    cursor = subDays(cursor, 1)
    walked++
  }

  const closed = completed + missed
  return { daysOn, scheduled, completed, missed, pct: closed ? completed / closed : 0 }
}

/** Total number of recorded completions for a recurring task. */
export function totalCompletions(
  task: RecurringTask,
  completions: TaskCompletion[],
): number {
  return completions.filter((c) => c.taskId === task.id).length
}
