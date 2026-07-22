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

/** P1 (highest) … P4 (lowest); 5 = Torah, a separate category that sorts last. */
export type Priority = 1 | 2 | 3 | 4 | 5

export type Recurrence =
  | { kind: 'daily' }
  /** daysOfWeek: 0 = Sunday … 6 = Saturday (matches date-fns `getDay`). */
  | { kind: 'weekly'; daysOfWeek: number[] }
  | { kind: 'everyNDays'; n: number }
  | { kind: 'monthly'; dateOfMonth: number }

export interface Subtask {
  id: string
  title: string
  done: boolean
}

interface BaseTask {
  id: string
  title: string
  notes?: string
  priority: Priority
  /** Optional free-form labels for grouping/filtering. */
  tags?: string[]
  /** Optional checklist items; parent completes when all subtasks are done (manual). */
  subtasks?: Subtask[]
  /** Set when this task was assigned by another BoDay user. */
  assignedByEmail?: string
  assignedFromTaskId?: string
  /** 'HH:mm' local time, or null for no reminder. */
  reminderTime?: string | null
  /**
   * Re-nudge cadence in minutes after a missed reminder (push notifications).
   * null/0 = off; undefined = default by priority (P1 hourly, P2 at 2h & 6h).
   */
  renudgeMinutes?: number | null
  /**
   * Leave this task out of streaks / stats / motivational aggregates.
   * undefined/false = counted (the default).
   */
  excludeFromStats?: boolean
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

/**
 * A row exists ONLY for a date on which a recurring task was checked off —
 * or explicitly skipped (`skipped: true`): a skip silences reminders for the
 * rest of that day (the push worker sees the row) but counts as MISSED in
 * streaks and stats, and the task resets normally the next occurrence.
 */
export interface TaskCompletion {
  id: string
  taskId: string
  /** 'yyyy-MM-dd'. */
  completionDate: string
  /** ISO timestamp. */
  completedAt: string
  skipped?: boolean
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
  /** Show Shabbat candle-lighting/havdalah times on the calendar (Hebcal). */
  showShabbatOnCalendar: boolean
  /** Show Jewish holidays on the calendar (Hebcal). */
  showHolidaysOnCalendar: boolean
  /** Today view: null = all tags. */
  todayTagFilter?: string | null
  /** Today view: hide everything except P1 (+ carried P1). */
  focusMode?: boolean
  /** Optional manual ordering of task ids on Today (incomplete items). */
  todayOrder?: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: 'indigo',
  reduceMotion: false,
  sound: true,
  weekStartsOn: 0,
  showShabbatOnCalendar: true,
  showHolidaysOnCalendar: true,
  todayTagFilter: null,
  focusMode: false,
  todayOrder: [],
}

/** View-model for one row in a day list (Today or a Calendar day). */
export interface DayItem {
  task: Task
  completed: boolean
  /** Recurring only: the user hit "skip" for this date (counts as missed). */
  skipped: boolean
  /**
   * For carried-over one-time tasks in the Today view: how many days ago it
   * was originally scheduled (> 0 means "carried over"). Always 0 for
   * recurring tasks and for tasks shown on their own scheduled date.
   */
  carriedOverFromDays: number
}
