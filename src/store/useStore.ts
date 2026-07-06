import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { makeSeed } from './seed'
import { todayStr } from '../lib/date'
import { DEFAULT_SETTINGS } from '../types'
import type {
  OneTimeTask,
  RecurringTask,
  Settings,
  Task,
  TaskCompletion,
} from '../types'

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

  resetToSeed: () => void
}

export const useStore = create<BoDayState>()(
  persist(
    (set) => ({
      ...makeSeed(todayStr()),
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

      resetToSeed: () => set({ ...makeSeed(todayStr()) }),
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
