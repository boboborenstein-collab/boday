// Insight aggregations for the Stats view. Built entirely on the existing
// pure engine (summarizeDay / currentStreak) — no domain logic is duplicated.

import { subDays } from 'date-fns'
import { fromDateStr, toDateStr } from './date'
import { summarizeDay } from './recurrence'
import { currentStreak } from './streaks'
import type { Task, TaskCompletion } from '../types'

export interface DayStat {
  dateStr: string
  total: number
  completed: number
  /** completed / total, or 0 when nothing was scheduled. */
  ratio: number
}

/** Per-day completion for the `days` calendar days ending at (and including) `today`. */
export function dailyStats(
  tasks: Task[],
  completions: TaskCompletion[],
  today: string,
  days: number,
): DayStat[] {
  const end = fromDateStr(today)
  const out: DayStat[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = toDateStr(subDays(end, i))
    const { total, completed } = summarizeDay(tasks, completions, dateStr)
    out.push({ dateStr, total, completed, ratio: total ? completed / total : 0 })
  }
  return out
}

export interface Overview {
  /** Tasks completed across the whole window. */
  completedInWindow: number
  /** Scheduled occurrences across the window. */
  scheduledInWindow: number
  windowRatio: number
  /** Days in the window where everything scheduled was completed. */
  perfectDays: number
  /** Consecutive perfect days ending today. */
  perfectStreak: number
  activeRecurring: number
  totalTasks: number
  /** Best current streak among recurring tasks + which task. */
  topStreak: { title: string; streak: number } | null
}

export function overview(
  tasks: Task[],
  completions: TaskCompletion[],
  today: string,
  windowDays: number,
): Overview {
  const stats = dailyStats(tasks, completions, today, windowDays)
  let completedInWindow = 0
  let scheduledInWindow = 0
  let perfectDays = 0
  for (const d of stats) {
    completedInWindow += d.completed
    scheduledInWindow += d.total
    if (d.total > 0 && d.completed === d.total) perfectDays++
  }

  // Perfect streak: walk back from today over days that HAD tasks and were 100%.
  let perfectStreak = 0
  for (let i = stats.length - 1; i >= 0; i--) {
    const d = stats[i]
    if (d.total === 0) continue // rest days don't break the streak
    if (d.completed === d.total) perfectStreak++
    else break
  }

  const recurring = tasks.filter((t) => t.type === 'recurring')
  let topStreak: Overview['topStreak'] = null
  for (const t of recurring) {
    if (t.type !== 'recurring') continue
    const s = currentStreak(t, completions, today)
    if (!topStreak || s > topStreak.streak) topStreak = { title: t.title, streak: s }
  }

  return {
    completedInWindow,
    scheduledInWindow,
    windowRatio: scheduledInWindow ? completedInWindow / scheduledInWindow : 0,
    perfectDays,
    perfectStreak,
    activeRecurring: recurring.length,
    totalTasks: tasks.length,
    topStreak: topStreak && topStreak.streak > 0 ? topStreak : null,
  }
}

/** All-time completions count (one-time done + recurring completion rows). */
export function lifetimeCompleted(tasks: Task[], completions: TaskCompletion[]): number {
  const oneTimeDone = tasks.filter((t) => t.type === 'one_time' && t.completed).length
  return oneTimeDone + completions.length
}
