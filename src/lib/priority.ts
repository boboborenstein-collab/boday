import type { Priority } from '../types'

export interface PriorityMeta {
  value: Priority
  label: string
  short: string
  /** Semantic Tailwind color name (maps to --color-pN token). */
  color: 'p1' | 'p2' | 'p3' | 'p4'
}

export const PRIORITIES: PriorityMeta[] = [
  { value: 1, label: 'Urgent', short: 'P1', color: 'p1' },
  { value: 2, label: 'High', short: 'P2', color: 'p2' },
  { value: 3, label: 'Medium', short: 'P3', color: 'p3' },
  { value: 4, label: 'Low', short: 'P4', color: 'p4' },
]

export function priorityMeta(p: Priority): PriorityMeta {
  return PRIORITIES[p - 1]
}
