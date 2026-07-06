// Assertion harness for the pure engine. Run with: npm run test:logic
// Proves the carry-over / recurrence / streak rules against the seed data
// BEFORE any UI exists. "It renders" != "the logic is right".

import {
  buildTodayList,
  buildDayList,
  occursOn,
} from '../src/lib/recurrence.ts'
import { currentStreak } from '../src/lib/streaks.ts'
import { toDateStr, fromDateStr } from '../src/lib/date.ts'
import { makeSeed } from '../src/store/seed.ts'
import { addDays, subDays } from 'date-fns'
import type { RecurringTask } from '../src/types.ts'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// Use a fixed Wednesday so weekday-dependent assertions are deterministic.
const TODAY = '2026-06-17' // Wednesday
const base = fromDateStr(TODAY)
const daysAgo = (n: number) => toDateStr(subDays(base, n))
const daysAhead = (n: number) => toDateStr(addDays(base, n))

const { tasks, completions } = makeSeed(TODAY)
const today = buildTodayList(tasks, completions, TODAY)
const ids = today.map((i) => i.task.id)
const byId = (id: string) => today.find((i) => i.task.id === id)

console.log('\nTODAY view (today =', TODAY + '):')

check('carried-over dry cleaning shows', ids.includes('ot-drycleaning'))
check(
  'dry cleaning carry-over reads 3 days',
  byId('ot-drycleaning')?.carriedOverFromDays === 3,
  `got ${byId('ot-drycleaning')?.carriedOverFromDays}`,
)
check('gym membership carried 6 days', byId('ot-gym')?.carriedOverFromDays === 6)
check('due-today landlord task shows', ids.includes('ot-landlord'))
check('due-today task has no carry badge', byId('ot-landlord')?.carriedOverFromDays === 0)
check('FUTURE gift task is hidden', !ids.includes('ot-gift'))
check('COMPLETED expense task is hidden', !ids.includes('ot-expense'))

check('every-3-days plants occurs today', ids.includes('rt-plants'))
check('plants renders CHECKED today', byId('rt-plants')?.completed === true)
check('daily workout shows', ids.includes('rt-workout'))
check('workout renders UNCHECKED today', byId('rt-workout')?.completed === false)

// 2026-06-17 is a Wednesday → Mon–Fri and Mon/Wed/Fri tasks both occur.
check('Mon–Fri Torah occurs on Wed', ids.includes('rt-torah'))
check('Mon/Wed/Fri standup occurs on Wed', ids.includes('rt-standup'))

console.log('\nSort order (incomplete P1 first, completed sinks):')
const firstIncomplete = today.find((i) => !i.completed)
check('first item is a P1', firstIncomplete?.task.priority === 1)
const completedIdx = today.findIndex((i) => i.completed)
const lastIncompleteIdx = today.map((i) => i.completed).lastIndexOf(false)
check(
  'completed items sink below incomplete',
  completedIdx === -1 || completedIdx > lastIncompleteIdx,
)

console.log('\nStreaks:')
const recur = (id: string) => tasks.find((t) => t.id === id) as RecurringTask
check(
  'workout streak = 4 (4 done, today open, day-5 missed)',
  currentStreak(recur('rt-workout'), completions, TODAY) === 4,
  `got ${currentStreak(recur('rt-workout'), completions, TODAY)}`,
)
check(
  'plants streak = 3 (today + -3 + -6 all done)',
  currentStreak(recur('rt-plants'), completions, TODAY) === 3,
  `got ${currentStreak(recur('rt-plants'), completions, TODAY)}`,
)

console.log('\nRecurrence rule spot-checks:')
const torah = recur('rt-torah')
check('Torah occurs on a Monday', occursOn(torah, '2026-06-15'))
check('Torah does NOT occur on Saturday', !occursOn(torah, '2026-06-13'))
check('Torah does NOT occur on Sunday', !occursOn(torah, '2026-06-14'))
const plants = recur('rt-plants')
check('plants occurs at +3 days', occursOn(plants, daysAhead(3)))
check('plants does NOT occur at +1 day', !occursOn(plants, daysAhead(1)))
check('plants does NOT occur before start', !occursOn(plants, daysAgo(7)))

console.log('\nCALENDAR day view (carry-over must NOT smear):')
// On a future date, only the gift (scheduled then) + recurring occurrences show.
const giftDay = buildDayList(tasks, completions, daysAhead(2))
check('gift appears on its scheduled future date', giftDay.some((i) => i.task.id === 'ot-gift'))
// Dry cleaning lives on its original scheduled cell, not on "today".
const dcDay = buildDayList(tasks, completions, daysAgo(3))
check('dry cleaning appears on its scheduled cell', dcDay.some((i) => i.task.id === 'ot-drycleaning'))
const dcToday = buildDayList(tasks, completions, TODAY)
check(
  'dry cleaning does NOT smear onto today in calendar',
  !dcToday.some((i) => i.task.id === 'ot-drycleaning'),
)

console.log('')
if (failures === 0) {
  console.log('✅ ALL ENGINE ASSERTIONS PASSED\n')
  process.exit(0)
} else {
  console.log(`❌ ${failures} assertion(s) FAILED\n`)
  process.exit(1)
}
