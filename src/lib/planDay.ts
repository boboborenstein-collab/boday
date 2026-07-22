import type { DayItem } from '../types'

export interface PlanSuggestion {
  headline: string
  detail: string
  actions: { id: string; label: string; kind: 'defer_carried' | 'focus_p1' }[]
  /** Suggested incomplete task ids in priority order for "start here". */
  orderedIds: string[]
}

export function buildPlanSuggestion(items: DayItem[]): PlanSuggestion {
  const open = items.filter((i) => !i.completed && !i.skipped)
  const carried = open.filter((i) => i.carriedOverFromDays > 0)
  const p1 = open.filter((i) => i.task.priority === 1)
  const allDone = items.length > 0 && open.length === 0

  const orderedIds = [...open]
    .sort((a, b) => {
      if (a.task.priority !== b.task.priority) return a.task.priority - b.task.priority
      if (a.carriedOverFromDays !== b.carriedOverFromDays) {
        return b.carriedOverFromDays - a.carriedOverFromDays
      }
      const ta = a.task.reminderTime ?? '99:99'
      const tb = b.task.reminderTime ?? '99:99'
      return ta.localeCompare(tb)
    })
    .map((i) => i.task.id)

  if (allDone) {
    return {
      headline: "You're all done for today",
      detail: 'Enjoy the rest of your day.',
      actions: [],
      orderedIds: [],
    }
  }

  if (open.length === 0) {
    return {
      headline: 'Your day is clear',
      detail: 'Nothing left on the list.',
      actions: [],
      orderedIds: [],
    }
  }

  const actions: PlanSuggestion['actions'] = []

  if (carried.length > 2) {
    actions.push({
      id: 'defer-carried',
      label: `Defer ${carried.filter((c) => c.task.priority > 2).length || carried.length} non-urgent carried tasks to tomorrow`,
      kind: 'defer_carried',
    })
  }

  if (p1.length > 0) {
    actions.push({
      id: 'focus-p1',
      label: 'Focus mode — show only P1',
      kind: 'focus_p1',
    })
  }

  let headline = `${open.length} thing${open.length === 1 ? '' : 's'} left`
  let detail = 'Start with your highest-priority item at the top.'
  if (carried.length > 0 && carried.length <= 2) {
    detail = `Clear ${carried.length} carried-over task${carried.length === 1 ? '' : 's'} first, then keep going.`
  } else if (p1.length > 0) {
    detail = `${p1.length} urgent (P1) — tackle “${open.find((i) => i.task.priority === 1)?.task.title ?? 'those'}” first.`
  }

  return { headline, detail, actions, orderedIds }
}
