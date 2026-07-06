// Date discipline (the #1 silent-bug source in this app):
//
//   • We store and compare dates as 'yyyy-MM-dd' strings. Carry-over and
//     range checks are then pure, timezone-proof string comparisons.
//   • When we genuinely need a Date object (day-of-week, N-day diff) we use
//     `parseISO`, which interprets a date-only string as LOCAL midnight.
//   • We NEVER use `new Date('2026-06-17')` — that parses as UTC midnight and
//     produces off-by-one bugs depending on the user's timezone.

import { format, parseISO } from 'date-fns'

/** Format a Date as a local 'yyyy-MM-dd' string. */
export function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** Today as a local 'yyyy-MM-dd' string. */
export function todayStr(): string {
  return toDateStr(new Date())
}

/** Parse a 'yyyy-MM-dd' string to a Date at LOCAL midnight. */
export function fromDateStr(s: string): Date {
  return parseISO(s)
}
