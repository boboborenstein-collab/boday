// The recurrence + carry-over engine. Everything here is PURE: each function
// takes the relevant date as an argument (never reads "today" internally), so
// it is unit-testable and reusable unchanged against Supabase rows in Phase 3.

import { differenceInCalendarDays, getDay, getDate } from 'date-fns'
import { fromDateStr, toDateStr } from './date'
import type {
  DayItem,
  OneTimeTask,
  Priority,
  RecurringTask,
  Task,
  TaskCompletion,
} from '../types'

/** Does a recurring task have an occurrence on `dateStr` ('yyyy-MM-dd')? */
export function occursOn(task: RecurringTask, dateStr: string): boolean {
  // Range gate (string comparison is valid for 'yyyy-MM-dd').
  if (dateStr < task.startDate) return false
  if (task.endDate && dateStr > task.endDate) return false

  switch (task.recurrence.kind) {
    case 'daily':
      return true
    case 'weekly':
      return task.recurrence.daysOfWeek.includes(getDay(fromDateStr(dateStr)))
    case 'everyNDays': {
      const n = task.recurrence.n
      if (n <= 0) return false
      const diff = differenceInCalendarDays(
        fromDateStr(dateStr),
        fromDateStr(task.startDate),
      )
      return diff >= 0 && diff % n === 0
    }
    case 'monthly':
      return getDate(fromDateStr(dateStr)) === task.recurrence.dateOfMonth
  }
}

/** A one-time task is "active" (shows in Today) until it's completed. */
export function isOneTimeActive(task: OneTimeTask, dateStr: string): boolean {
  return !task.completed && task.scheduledDate <= dateStr
}

/** How many days a one-time task has been carried over by `dateStr` (0 = not carried). */
export function carryOverDays(task: OneTimeTask, dateStr: string): number {
  return Math.max(
    0,
    differenceInCalendarDays(fromDateStr(dateStr), fromDateStr(task.scheduledDate)),
  )
}

function completionKey(taskId: string, dateStr: string): string {
  return `${taskId}|${dateStr}`
}

function buildCompletionSet(completions: TaskCompletion[]): Set<string> {
  return new Set(
    completions.filter((c) => !c.skipped).map((c) => completionKey(c.taskId, c.completionDate)),
  )
}

function buildSkippedSet(completions: TaskCompletion[]): Set<string> {
  return new Set(
    completions.filter((c) => c.skipped).map((c) => completionKey(c.taskId, c.completionDate)),
  )
}

/**
 * The TODAY view list.
 *
 *   • One-time tasks use carry-over semantics: shown if not completed and
 *     scheduled on/before `today`. `carriedOverFromDays` flags how overdue.
 *   • Recurring tasks are shown if they occur today, checked iff a completion
 *     row exists for today.
 */
export function buildTodayList(
  tasks: Task[],
  completions: TaskCompletion[],
  today: string,
): DayItem[] {
  const done = buildCompletionSet(completions)
  const skipped = buildSkippedSet(completions)
  const items: DayItem[] = []

  for (const task of tasks) {
    if (task.type === 'one_time') {
      if (isOneTimeActive(task, today)) {
        items.push({
          task,
          completed: false,
          skipped: false,
          carriedOverFromDays: carryOverDays(task, today),
        })
      } else if (task.completed && task.completedAt && toDateStr(new Date(task.completedAt)) === today) {
        items.push({
          task,
          completed: true,
          skipped: false,
          carriedOverFromDays: 0,
        })
      }
    } else {
      if (occursOn(task, today)) {
        items.push({
          task,
          completed: done.has(completionKey(task.id, today)),
          skipped: skipped.has(completionKey(task.id, today)),
          carriedOverFromDays: 0,
        })
      }
    }
  }
  return sortDayItems(items)
}

/**
 * A CALENDAR-day list for an arbitrary date (past, present, or future).
 *
 * Unlike Today, carry-over is NOT applied here: a one-time task appears only
 * on its own `scheduledDate` cell, showing whether it was ultimately done.
 * Recurring tasks appear on their occurrences with that date's completion.
 */
export function buildDayList(
  tasks: Task[],
  completions: TaskCompletion[],
  dateStr: string,
): DayItem[] {
  const done = buildCompletionSet(completions)
  const skipped = buildSkippedSet(completions)
  const items: DayItem[] = []

  for (const task of tasks) {
    if (task.type === 'one_time') {
      if (task.scheduledDate === dateStr) {
        items.push({ task, completed: task.completed, skipped: false, carriedOverFromDays: 0 })
      }
    } else {
      if (occursOn(task, dateStr)) {
        items.push({
          task,
          completed: done.has(completionKey(task.id, dateStr)),
          skipped: skipped.has(completionKey(task.id, dateStr)),
          carriedOverFromDays: 0,
        })
      }
    }
  }
  return sortDayItems(items)
}

/** Lightweight summary used to paint dots on calendar cells. */
export interface DaySummary {
  total: number
  completed: number
  topPriority: Priority | null
}

export function summarizeDay(
  tasks: Task[],
  completions: TaskCompletion[],
  dateStr: string,
): DaySummary {
  const items = buildDayList(tasks, completions, dateStr)
  let topPriority: Priority | null = null
  let completed = 0
  for (const it of items) {
    if (it.completed) completed++
    if (topPriority === null || it.task.priority < topPriority) {
      topPriority = it.task.priority
    }
  }
  return { total: items.length, completed, topPriority }
}

/**
 * Sort order for a day list:
 *   1. Incomplete before complete/skipped (settled items sink).
 *   2. Higher priority first (P1 → P4).
 *   3. More overdue carry-overs first.
 *   4. Stable-ish by creation time.
 */
export function sortDayItems(items: DayItem[]): DayItem[] {
  const settled = (i: DayItem) => i.completed || i.skipped
  return [...items].sort((a, b) => {
    if (settled(a) !== settled(b)) return settled(a) ? 1 : -1
    if (a.task.priority !== b.task.priority) return a.task.priority - b.task.priority
    if (a.carriedOverFromDays !== b.carriedOverFromDays) {
      return b.carriedOverFromDays - a.carriedOverFromDays
    }
    return a.task.createdAt.localeCompare(b.task.createdAt)
  })
}
