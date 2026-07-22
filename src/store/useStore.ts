import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_SETTINGS } from '../types'
import type {
  OneTimeTask,
  RecurringTask,
  Settings,
  Subtask,
  Task,
  TaskCompletion,
} from '../types'
import { occursOn } from '../lib/recurrence'
import { addDays, format } from 'date-fns'
import { fromDateStr, todayStr } from '../lib/date'

/** A task being created — id and createdAt are assigned by the store. */
export type TaskDraft =
  | Omit<OneTimeTask, 'id' | 'createdAt'>
  | Omit<RecurringTask, 'id' | 'createdAt'>

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

interface BoDayState {
  tasks: Task[]
  completions: TaskCompletion[]
  settings: Settings

  // ── Editor UI state (not persisted) ──────────────────────────────────────
  editorOpen: boolean
  editingTaskId: string | null
  /** When set, a new task opens pre-filled for this date ('yyyy-MM-dd'). */
  editorDefaultDate: string | null
  openEditor: (taskId?: string, defaultDate?: string) => void
  closeEditor: () => void

  // ── Command palette UI state (not persisted) ──────────────────────────────
  commandOpen: boolean
  openCommand: () => void
  closeCommand: () => void

  // ── Settings ──────────────────────────────────────────────────────────────
  updateSettings: (patch: Partial<Settings>) => void
  importData: (data: { tasks: Task[]; completions: TaskCompletion[] }) => void

  // ── Task CRUD ─────────────────────────────────────────────────────────────
  addTask: (draft: TaskDraft) => void
  updateTask: (task: Task) => void
  deleteTask: (id: string) => void

  // ── Completion ──────────────────────────────────────────────────────────
  setOneTimeCompleted: (id: string, completed: boolean) => void
  toggleRecurringCompletion: (taskId: string, dateStr: string) => void
  /** Skip a recurring occurrence: silences today's reminders, counts as missed. */
  toggleRecurringSkip: (taskId: string, dateStr: string) => void
  /** Move a one-time task to another date (default: tomorrow). */
  deferOneTimeTask: (id: string, toDate?: string) => void
  /** Skip all recurring occurrences today (optional: keep Torah / P5). */
  bulkSkipRecurring: (dateStr: string, mode: 'all' | 'except_torah') => void
  toggleSubtask: (taskId: string, subtaskId: string) => void
  setTodayOrder: (order: string[]) => void
  deferCarriedNonUrgent: (today: string) => number

  clearAll: () => void
}

export const useStore = create<BoDayState>()(
  persist(
    (set) => ({
      tasks: [],
      completions: [],
      settings: DEFAULT_SETTINGS,

      editorOpen: false,
      editingTaskId: null,
      editorDefaultDate: null,
      openEditor: (taskId, defaultDate) =>
        set({
          editorOpen: true,
          editingTaskId: taskId ?? null,
          editorDefaultDate: defaultDate ?? null,
        }),
      closeEditor: () =>
        set({ editorOpen: false, editingTaskId: null, editorDefaultDate: null }),

      commandOpen: false,
      openCommand: () => set({ commandOpen: true }),
      closeCommand: () => set({ commandOpen: false }),

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      importData: ({ tasks, completions }) => set({ tasks, completions }),

      addTask: (draft) =>
        set((s) => ({
          tasks: [
            ...s.tasks,
            { ...draft, id: uuid(), createdAt: new Date().toISOString() } as Task,
          ],
        })),

      updateTask: (task) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
        })),

      deleteTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          // Drop orphaned completion history too.
          completions: s.completions.filter((c) => c.taskId !== id),
        })),

      setOneTimeCompleted: (id, completed) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id && t.type === 'one_time'
              ? { ...t, completed, completedAt: completed ? new Date().toISOString() : null }
              : t,
          ),
        })),

      toggleRecurringCompletion: (taskId, dateStr) =>
        set((s) => {
          const existing = s.completions.find(
            (c) => c.taskId === taskId && c.completionDate === dateStr,
          )
          if (existing?.skipped) {
            // Completing a skipped occurrence upgrades the skip to a real completion.
            return {
              completions: s.completions.map((c) =>
                c.id === existing.id
                  ? { ...c, skipped: undefined, completedAt: new Date().toISOString() }
                  : c,
              ),
            }
          }
          if (existing) {
            return {
              completions: s.completions.filter((c) => c.id !== existing.id),
            }
          }
          return {
            completions: [
              ...s.completions,
              {
                id: uuid(),
                taskId,
                completionDate: dateStr,
                completedAt: new Date().toISOString(),
              },
            ],
          }
        }),

      toggleRecurringSkip: (taskId, dateStr) =>
        set((s) => {
          const existing = s.completions.find(
            (c) => c.taskId === taskId && c.completionDate === dateStr,
          )
          // Already completed for real — skip doesn't apply.
          if (existing && !existing.skipped) return {}
          if (existing) {
            return { completions: s.completions.filter((c) => c.id !== existing.id) }
          }
          return {
            completions: [
              ...s.completions,
              {
                id: uuid(),
                taskId,
                completionDate: dateStr,
                completedAt: new Date().toISOString(),
                skipped: true,
              },
            ],
          }
        }),

      deferOneTimeTask: (id, toDate) =>
        set((s) => {
          const target =
            toDate ?? format(addDays(fromDateStr(todayStr()), 1), 'yyyy-MM-dd')
          return {
            tasks: s.tasks.map((t) =>
              t.id === id && t.type === 'one_time' ? { ...t, scheduledDate: target } : t,
            ),
          }
        }),

      bulkSkipRecurring: (dateStr, mode) =>
        set((s) => {
          let completions = s.completions
          for (const task of s.tasks) {
            if (task.type !== 'recurring' || !occursOn(task, dateStr)) continue
            if (mode === 'except_torah' && task.priority === 5) continue
            const existing = completions.find(
              (c) => c.taskId === task.id && c.completionDate === dateStr,
            )
            if (existing && !existing.skipped) continue
            if (existing?.skipped) continue
            completions = [
              ...completions,
              {
                id: uuid(),
                taskId: task.id,
                completionDate: dateStr,
                completedAt: new Date().toISOString(),
                skipped: true,
              },
            ]
          }
          return { completions }
        }),

      toggleSubtask: (taskId, subtaskId) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.subtasks?.length) return t
            return {
              ...t,
              subtasks: t.subtasks.map((st) =>
                st.id === subtaskId ? { ...st, done: !st.done } : st,
              ),
            }
          }),
        })),

      setTodayOrder: (order) =>
        set((s) => ({ settings: { ...s.settings, todayOrder: order } })),

      deferCarriedNonUrgent: (today) => {
        const tomorrow = format(addDays(fromDateStr(today), 1), 'yyyy-MM-dd')
        let count = 0
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.type !== 'one_time' || t.completed || t.scheduledDate >= today) return t
            if (t.priority <= 2) return t
            count++
            return { ...t, scheduledDate: tomorrow }
          }),
        }))
        return count
      },

      clearAll: () => set({ tasks: [], completions: [] }),
    }),
    {
      name: 'cadence-v1',
      version: 2,
      // Only persist data + settings — never the transient editor UI state.
      partialize: (s) => ({
        tasks: s.tasks,
        completions: s.completions,
        settings: s.settings,
      }),
      // Defensive merge: existing users persisted before `settings` existed, so
      // backfill any missing settings keys with defaults. Tasks/completions are
      // schema-compatible (only optional `tags` was added), so they pass through.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BoDayState>
        return {
          ...current,
          ...p,
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
        }
      },
    },
  ),
)
