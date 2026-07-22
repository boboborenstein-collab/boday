import { addDays, format, subDays } from 'date-fns'
import { fromDateStr, toDateStr } from './date'
import { buildDayList } from './recurrence'
import { currentStreak } from './streaks'
import { overview } from './stats'
import type { Task, TaskCompletion } from '../types'

export interface WeeklyReview {
  weekLabel: string
  completed: number
  scheduled: number
  ratio: number
  perfectDays: number
  carriedEnd: number
  topStreak: { title: string; streak: number } | null
  mostSkipped: { title: string; count: number } | null
  highlights: string[]
}

export function buildWeeklyReview(
  tasks: Task[],
  completions: TaskCompletion[],
  today: string,
): WeeklyReview {
  const end = fromDateStr(today)
  const start = subDays(end, 6)
  const weekLabel = `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`

  const ov = overview(tasks, completions, today, 7)

  let carriedEnd = 0
  for (const t of tasks) {
    if (t.type === 'one_time' && !t.completed && t.scheduledDate < today) carriedEnd++
  }

  const skipCounts = new Map<string, number>()
  for (const c of completions) {
    if (!c.skipped) continue
    skipCounts.set(c.taskId, (skipCounts.get(c.taskId) ?? 0) + 1)
  }
  let mostSkipped: WeeklyReview['mostSkipped'] = null
  for (const [taskId, count] of skipCounts) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) continue
    if (!mostSkipped || count > mostSkipped.count) {
      mostSkipped = { title: task.title, count }
    }
  }

  let topStreak: WeeklyReview['topStreak'] = null
  for (const t of tasks) {
    if (t.type !== 'recurring' || t.excludeFromStats) continue
    const streak = currentStreak(t, completions, today)
    if (streak > 0 && (!topStreak || streak > topStreak.streak)) {
      topStreak = { title: t.title, streak }
    }
  }

  const highlights: string[] = []
  if (ov.perfectDays >= 5) highlights.push(`${ov.perfectDays} perfect days — excellent week.`)
  else if (ov.windowRatio >= 0.85) highlights.push('Strong completion rate this week.')
  if (carriedEnd === 0) highlights.push('No carried-over one-time tasks hanging around.')
  else highlights.push(`${carriedEnd} one-time task${carriedEnd === 1 ? '' : 's'} still carried — consider deferring or finishing.`)
  if (mostSkipped && mostSkipped.count >= 2) {
    highlights.push(`“${mostSkipped.title}” was skipped ${mostSkipped.count} times — worth adjusting or dropping.`)
  }

  // Sanity: count scheduled in week via day lists
  let scheduled = 0
  let completed = 0
  for (let i = 0; i < 7; i++) {
    const d = toDateStr(addDays(start, i))
    const items = buildDayList(tasks, completions, d)
    scheduled += items.length
    completed += items.filter((it) => it.completed).length
  }

  return {
    weekLabel,
    completed,
    scheduled,
    ratio: scheduled ? completed / scheduled : 0,
    perfectDays: ov.perfectDays,
    carriedEnd,
    topStreak,
    mostSkipped,
    highlights,
  }
}
