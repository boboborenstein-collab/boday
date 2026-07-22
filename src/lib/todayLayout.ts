import type { DayItem, Settings } from '../types'
import { sortDayItems } from './recurrence'

export type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'anytime'

const BUCKET_LABEL: Record<TimeBucket, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
}

export function timeBucket(reminderTime: string | null | undefined): TimeBucket {
  if (!reminderTime) return 'anytime'
  const [h] = reminderTime.split(':').map(Number)
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

export function filterTodayItems(items: DayItem[], settings: Settings): DayItem[] {
  let out = items
  const tag = settings.todayTagFilter
  if (tag) {
    out = out.filter((i) => i.task.tags?.includes(tag))
  }
  if (settings.focusMode) {
    out = out.filter((i) => i.task.priority === 1)
  }
  return out
}

export function applyTodayOrder(items: DayItem[], order: string[] | undefined): DayItem[] {
  if (!order?.length) return sortDayItems(items)
  const rank = new Map(order.map((id, i) => [id, i]))
  const settled = (i: DayItem) => i.completed || i.skipped
  return [...items].sort((a, b) => {
    if (settled(a) !== settled(b)) return settled(a) ? 1 : -1
    const ra = rank.get(a.task.id)
    const rb = rank.get(b.task.id)
    if (ra != null && rb != null) return ra - rb
    if (ra != null) return -1
    if (rb != null) return 1
    return sortDayItems([a, b])[0] === a ? -1 : 1
  })
}

export function groupByTimeBucket(items: DayItem[]): { bucket: TimeBucket; label: string; items: DayItem[] }[] {
  const buckets: TimeBucket[] = ['morning', 'afternoon', 'evening', 'anytime']
  const groups = buckets.map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    items: items.filter((i) => timeBucket(i.task.reminderTime) === bucket),
  }))
  return groups.filter((g) => g.items.length > 0)
}

export function collectTagsFromItems(items: DayItem[]): string[] {
  const set = new Set<string>()
  for (const i of items) {
    for (const t of i.task.tags ?? []) set.add(t)
  }
  return [...set].sort()
}
