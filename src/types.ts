// ─────────────────────────────────────────────────────────────────────────
// Core domain types
//
// There are TWO fundamentally different kinds of task. They are deliberately
// NOT collapsed into one shape:
//
//   • OneTimeTask  — has a single `scheduledDate` and a `completed` flag.
//                    Carries over: stays in "Today" until done (query-based,
//                    no row ever moves).
//   • RecurringTask — has a `recurrence` pattern. Does NOT carry over.
//                     Completions live per-date in `TaskCompletion`, so each
//                     occurrence is independent and history is preserved.
// ─────────────────────────────────────────────────────────────────────────

/** P1 (highest) … P4 (lowest). */
export type Priority = 1 | 2 | 3 | 4

export type Recurrence =
  | { kind: 'daily' }
  /** daysOfWeek: 0 = Sunday … 6 = Saturday (matches date-fns `getDay`). */
  | { kind: 'weekly'; daysOfWeek: number[] }
  | { kind: 'everyNDays'; n: number }
  | { kind: 'monthly'; dateOfMonth: number }

interface BaseTask {
  id: string
  title: string
  notes?: string
  priority: Priority
  /** Optional free-form labels for grouping/filtering. */
  tags?: string[]
  /** 'HH:mm' local time, or null for no reminder. */
  reminderTime?: string | null
  /** ISO timestamp. */
  createdAt: string
}

export interface OneTimeTask extends BaseTask {
  type: 'one_time'
  /** 'yyyy-MM-dd' — the day it was planned for. */
  scheduledDate: string
  completed: boolean
  /** ISO timestamp, or null. */
  completedAt?: string | null
}

export interface RecurringTask extends BaseTask {
  type: 'recurring'
  recurrence: Recurrence
  /** 'yyyy-MM-dd'. */
  startDate: string
  /** 'yyyy-MM-dd' or null for open-ended. */
  endDate?: string | null
}

export type Task = OneTimeTask | RecurringTask

/** A row exists ONLY for a date on which a recurring task was checked off. */
export interface TaskCompletion {
  id: string
  taskId: string
  /** 'yyyy-MM-dd'. */
  completionDate: string
  /** ISO timestamp. */
  completedAt: string
}

// ─────────────────────────────────────────────────────────────────────────
// User settings (persisted alongside data)
// ─────────────────────────────────────────────────────────────────────────

export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentKey = 'indigo' | 'violet' | 'emerald' | 'rose' | 'amber' | 'sky'

export interface Settings {
  theme: ThemeMode
  accent: AccentKey
  /** Disable non-essential animations. */
  reduceMotion: boolean
  /** Play a soft chime + haptic when completing a task. */
  sound: boolean
  /** 0 = Sunday, 1 = Monday — used by the calendar grid. */
  weekStartsOn: 0 | 1
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: 'indigo',
  reduceMotion: false,
  sound: true,
  weekStartsOn: 0,
}

/** View-model for one row in a day list (Today or a Calendar day). */
export interface DayItem {
  task: Task
  completed: boolean
  /**
   * For carried-over one-time tasks in the Today view: how many days ago it
   * was originally scheduled (> 0 means "carried over"). Always 0 for
   * recurring tasks and for tasks shown on their own scheduled date.
   */
  carriedOverFromDays: number
}
