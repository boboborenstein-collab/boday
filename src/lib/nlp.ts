import { todayStr } from './date'
import type { Priority, Recurrence } from '../types'
import type { TaskDraft } from '../store/useStore'
import { addDays, format, getDay, nextDay, parseISO } from 'date-fns'

const DAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
}

/**
 * A lightweight, offline natural language parser for tasks.
 * Converts "call dentist tomorrow at 2pm" -> OneTimeTask
 * Converts "read 20 mins every morning p1" -> RecurringTask
 */
export function parseNaturalLanguage(input: string): TaskDraft {
  let title = input
  const lower = input.toLowerCase()
  let priority: Priority = 3
  let reminderTime: string | null = null

  // Priority extraction
  const p1Match = lower.match(/\b(urgent|p1)\b/i)
  if (p1Match) { priority = 1; title = title.replace(p1Match[0], '') }
  
  const p2Match = lower.match(/\b(high|p2)\b/i)
  if (p2Match) { priority = 2; title = title.replace(p2Match[0], '') }

  const p4Match = lower.match(/\b(low|p4)\b/i)
  if (p4Match) { priority = 4; title = title.replace(p4Match[0], '') }

  // Reminder time extraction (e.g. "at 2pm", "at 14:30")
  const timeMatch = lower.match(/\bat\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?\b/)
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10)
    const min = timeMatch[2] || '00'
    const ampm = timeMatch[3]
    
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    
    reminderTime = `${String(hour).padStart(2, '0')}:${min}`
    title = title.replace(timeMatch[0], '')
  }

  // Recurrence extraction
  if (lower.match(/\b(every day|daily|every morning|every night)\b/)) {
    title = title.replace(/\b(every day|daily|every morning|every night)\b/i, '')
    return {
      type: 'recurring',
      title: title.trim().replace(/\s+/g, ' '),
      priority,
      reminderTime,
      recurrence: { kind: 'daily' },
      startDate: todayStr()
    }
  }

  if (lower.match(/\b(every weekday)\b/)) {
    title = title.replace(/\b(every weekday)\b/i, '')
    return {
      type: 'recurring',
      title: title.trim().replace(/\s+/g, ' '),
      priority,
      reminderTime,
      recurrence: { kind: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] },
      startDate: todayStr()
    }
  }

  const everyDayMatch = lower.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/)
  if (everyDayMatch) {
    const day = DAYS[everyDayMatch[1]]
    title = title.replace(everyDayMatch[0], '')
    return {
      type: 'recurring',
      title: title.trim().replace(/\s+/g, ' '),
      priority,
      reminderTime,
      recurrence: { kind: 'weekly', daysOfWeek: [day] },
      startDate: todayStr()
    }
  }

  // One-time date extraction
  let scheduledDate = todayStr()
  const today = new Date()

  if (lower.includes('tomorrow')) {
    scheduledDate = format(addDays(today, 1), 'yyyy-MM-dd')
    title = title.replace(/\btomorrow\b/ig, '')
  } else {
    const nextDayMatch = lower.match(/\b(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/)
    if (nextDayMatch) {
      const dayStr = nextDayMatch[1]
      const dayInt = DAYS[dayStr]
      // If it says "next X", we add a week. Otherwise we just find the closest next X.
      let d = nextDay(today, dayInt as Day)
      if (lower.includes(`next ${dayStr}`)) d = addDays(d, 7)
      
      scheduledDate = format(d, 'yyyy-MM-dd')
      title = title.replace(nextDayMatch[0], '')
    }
  }

  // Cleanup leftover prepositions
  title = title.replace(/\b(on|for)\b$/, '').trim()

  return {
    type: 'one_time',
    title: title.replace(/\s+/g, ' '),
    priority,
    reminderTime,
    scheduledDate,
    completed: false
  }
}

type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;
