import type { Priority } from '../types'

// Full, static class strings (NOT interpolated) so Tailwind's scanner emits
// them. Keyed by priority so the lookup stays type-safe.
interface PriorityStyle {
  text: string
  bg: string
  softBg: string
  bar: string
}

export const PRIORITY_STYLES: Record<Priority, PriorityStyle> = {
  1: { text: 'text-p1', bg: 'bg-p1', softBg: 'bg-p1/15', bar: 'bg-p1' },
  2: { text: 'text-p2', bg: 'bg-p2', softBg: 'bg-p2/15', bar: 'bg-p2' },
  3: { text: 'text-p3', bg: 'bg-p3', softBg: 'bg-p3/15', bar: 'bg-p3' },
  4: { text: 'text-p4', bg: 'bg-p4', softBg: 'bg-p4/15', bar: 'bg-p4' },
}
