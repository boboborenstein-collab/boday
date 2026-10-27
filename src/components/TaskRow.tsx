import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useStore } from '../store/useStore'
import { priorityMeta } from '../lib/priority'
import { describeRecurrence, formatTime } from '../lib/format'
import { celebrate } from '../lib/feedback'
import { PRIORITY_STYLES } from './priorityStyles'
import { CheckIcon, ClockIcon, FlameIcon, RepeatIcon, SkipIcon, TrashIcon } from './icons'
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
  const { task, completed, skipped, carriedOverFromDays } = item
  const setOneTimeCompleted = useStore((s) => s.setOneTimeCompleted)
  const toggleRecurring = useStore((s) => s.toggleRecurringCompletion)
  const toggleSkip = useStore((s) => s.toggleRecurringSkip)
  const timeFormat = useStore((s) => s.settings.timeFormat)
  const deferOneTimeTask = useStore((s) => s.deferOneTimeTask)
  const toggleSubtask = useStore((s) => s.toggleSubtask)
  const deleteTask = useStore((s) => s.deleteTask)
  const openEditor = useStore((s) => s.openEditor)
  const sound = useStore((s) => s.settings.sound)
  const reduce = useReducedMotion()

  const [burst, setBurst] = useState(false)
  const [subOpen, setSubOpen] = useState(false)

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

          {/* Body — tap title to edit */}
          <div className="flex-1 text-left">
            <button type="button" onClick={() => openEditor(task.id)} className="w-full text-left">
              <div
                className={`text-[15px] font-medium leading-snug transition-colors ${
                  completed ? 'text-faint line-through' : skipped ? 'text-faint' : 'text-text'
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
                  {formatTime(task.reminderTime, timeFormat)}
                </span>
              )}
              {skipped && (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-faint">
                  <SkipIcon className="size-3" />
                  skipped today
                </span>
              )}
              {task.type === 'recurring' && streak > 0 && !skipped && (
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

            {task.subtasks && task.subtasks.length > 0 && (
              <div className="mt-2 w-full">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSubOpen((v) => !v)
                  }}
                  className="text-[11px] font-medium text-accent"
                >
                  {subOpen ? 'Hide' : 'Show'} checklist ({task.subtasks.filter((s) => s.done).length}/
                  {task.subtasks.length})
                </button>
                {subOpen && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {task.subtasks.map((st) => (
                      <li key={st.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={st.done}
                            onChange={() => toggleSubtask(task.id, st.id)}
                            className="size-3.5 rounded border-border-strong accent-accent"
                          />
                          <span className={st.done ? 'line-through text-faint' : ''}>{st.title}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

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
            {task.type === 'one_time' && !completed && (
              <button
                type="button"
                onClick={() => deferOneTimeTask(task.id)}
                title="Defer to tomorrow"
                className="inline-flex items-center rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
              >
                Tomorrow
              </button>
            )}
            {task.type === 'recurring' && !completed && (
              <button
                onClick={() => toggleSkip(task.id, dateStr)}
                title={skipped ? 'Undo skip' : 'Skip today — no more reminders, counts as missed'}
                aria-label={skipped ? 'Undo skip' : 'Skip today'}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  skipped
                    ? 'border-border-strong text-muted hover:text-text'
                    : 'border-border text-muted hover:border-border-strong hover:bg-surface-2 hover:text-text'
                }`}
              >
                <SkipIcon className="size-3.5" />
                {skipped ? 'undo' : 'skip'}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
