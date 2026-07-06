import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useStore } from '../store/useStore'
import { priorityMeta } from '../lib/priority'
import { describeRecurrence, formatReminder } from '../lib/format'
import { celebrate } from '../lib/feedback'
import { PRIORITY_STYLES } from './priorityStyles'
import { CheckIcon, ClockIcon, FlameIcon, RepeatIcon, TrashIcon } from './icons'
import { Confetti } from './Confetti'
import type { DayItem } from '../types'

interface TaskRowProps {
  item: DayItem
  /** The date this row represents ('yyyy-MM-dd') — used when toggling recurring. */
  dateStr: string
  /** Current streak for recurring tasks (0 hides the flame). */
  streak?: number
  /** Whether to show overdue text instead of carried text. */
  overdue?: boolean
}

const SWIPE_THRESHOLD = 80

export function TaskRow({ item, dateStr, streak = 0, overdue = false }: TaskRowProps) {
  const { task, completed, carriedOverFromDays } = item
  const setOneTimeCompleted = useStore((s) => s.setOneTimeCompleted)
  const toggleRecurring = useStore((s) => s.toggleRecurringCompletion)
  const deleteTask = useStore((s) => s.deleteTask)
  const openEditor = useStore((s) => s.openEditor)
  const sound = useStore((s) => s.settings.sound)
  const reduce = useReducedMotion()

  const [burst, setBurst] = useState(false)

  const pm = priorityMeta(task.priority)
  const ps = PRIORITY_STYLES[task.priority]

  const toggle = () => {
    const next = !completed
    if (task.type === 'one_time') setOneTimeCompleted(task.id, next)
    else toggleRecurring(task.id, dateStr)
    if (next) {
      setBurst(true)
      celebrate({ sound })
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 38, mass: 0.6 }}
      className="relative overflow-hidden rounded-2xl"
    >
      {/* Swipe action backgrounds (revealed as the card is dragged) */}
      <div className="absolute inset-0 flex items-center justify-between rounded-2xl px-5 text-sm font-semibold">
        <span className="flex items-center gap-1.5 text-success">
          <CheckIcon className="size-4" /> {completed ? 'Undo' : 'Done'}
        </span>
        <span className="flex items-center gap-1.5 text-danger">
          Delete <TrashIcon className="size-4" />
        </span>
      </div>

      <motion.div
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          if (info.offset.x > SWIPE_THRESHOLD) toggle()
          else if (info.offset.x < -SWIPE_THRESHOLD) deleteTask(task.id)
        }}
        whileTap={{ cursor: 'grabbing' }}
        className="group relative flex items-stretch gap-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-colors hover:border-border-strong"
      >
        {/* Priority accent bar */}
        <div className={`w-1 shrink-0 ${ps.bar} ${completed ? 'opacity-30' : ''}`} />

        <div className="flex flex-1 items-start gap-3 p-3 pl-3.5">
          {/* Checkbox */}
          <button
            onClick={toggle}
            aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
            className={`relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${
              completed
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border-strong text-transparent hover:border-accent'
            }`}
          >
            {completed && <CheckIcon className="size-4 animate-pop" />}
            <AnimatePresence>
              {burst && <Confetti onDone={() => setBurst(false)} />}
            </AnimatePresence>
          </button>

          {/* Body — tap to edit */}
          <button onClick={() => openEditor(task.id)} className="flex-1 text-left">
            <div
              className={`text-[15px] font-medium leading-snug transition-colors ${
                completed ? 'text-faint line-through' : 'text-text'
              }`}
            >
              {task.title}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {task.type === 'recurring' && (
                <span className="inline-flex items-center gap-1">
                  <RepeatIcon className="size-3.5" />
                  {describeRecurrence(task)}
                </span>
              )}
              {task.reminderTime && (
                <span className="inline-flex items-center gap-1">
                  <ClockIcon className="size-3.5" />
                  {formatReminder(task.reminderTime)}
                </span>
              )}
              {task.type === 'recurring' && streak > 0 && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <FlameIcon className="size-3.5" />
                  {streak}
                </span>
              )}
              {task.tags?.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted"
                >
                  #{t}
                </span>
              ))}
              {task.notes && !completed && (
                <span className="truncate text-faint">{task.notes}</span>
              )}
            </div>
          </button>

          {/* Right rail: carry-over badge + priority chip */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${ps.softBg} ${ps.text}`}
              title={pm.label}
            >
              {pm.short}
            </span>
            {carriedOverFromDays > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded-md bg-carry-soft px-1.5 py-0.5 text-[10px] font-medium text-carry"
                title={`Originally scheduled ${carriedOverFromDays} day${
                  carriedOverFromDays === 1 ? '' : 's'
                } ago`}
              >
                {overdue ? `${carriedOverFromDays}d overdue` : `carried ${carriedOverFromDays}d`}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
