import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import { useStore } from '../store/useStore'
import { buildDayList } from '../lib/recurrence'
import { currentStreak } from '../lib/streaks'
import { fromDateStr, todayStr, toDateStr } from '../lib/date'
import { formatDateLong } from '../lib/format'
import { TaskRow } from '../components/TaskRow'
import { PRIORITY_STYLES } from '../components/priorityStyles'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../components/icons'
import type { DayItem } from '../types'

const LABELS_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const LABELS_MON = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function CalendarView() {
  const tasks = useStore((s) => s.tasks)
  const completions = useStore((s) => s.completions)
  const openEditor = useStore((s) => s.openEditor)
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn)

  const today = todayStr()
  const [view, setView] = useState<'month' | 'week'>('month')
  const [anchor, setAnchor] = useState(today)
  const [selected, setSelected] = useState(today)
  const [dir, setDir] = useState(0)

  const anchorDate = fromDateStr(anchor)
  const weekdays = weekStartsOn === 1 ? LABELS_MON : LABELS_SUN

  const cells = useMemo(() => {
    const range =
      view === 'month'
        ? {
            start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn }),
            end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn }),
          }
        : {
            start: startOfWeek(anchorDate, { weekStartsOn }),
            end: endOfWeek(anchorDate, { weekStartsOn }),
          }
    return eachDayOfInterval(range).map((date) => {
      const dateStr = toDateStr(date)
      return {
        date,
        dateStr,
        inMonth: isSameMonth(date, anchorDate),
        items: buildDayList(tasks, completions, dateStr),
      }
    })
  }, [view, anchorDate, tasks, completions, weekStartsOn])

  const selectedItems = useMemo(
    () => buildDayList(tasks, completions, selected),
    [tasks, completions, selected],
  )

  const step = (d: 1 | -1) => {
    setDir(d)
    if (view === 'month') {
      setAnchor(toDateStr(d === 1 ? addMonths(anchorDate, 1) : subMonths(anchorDate, 1)))
    } else {
      setAnchor(toDateStr(d === 1 ? addWeeks(anchorDate, 1) : subWeeks(anchorDate, 1)))
    }
  }

  const goToday = () => {
    setDir(0)
    setAnchor(today)
    setSelected(today)
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {format(anchorDate, view === 'month' ? 'MMMM yyyy' : "'Week of' MMM d")}
        </h1>
        <div className="flex items-center gap-1">
          <NavBtn onClick={() => step(-1)} label="Previous">
            <ChevronLeftIcon className="size-5" />
          </NavBtn>
          <NavBtn onClick={() => step(1)} label="Next">
            <ChevronRightIcon className="size-5" />
          </NavBtn>
        </div>
      </header>

      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg border border-border bg-surface/60 p-0.5 text-xs font-medium">
          {(['month', 'week'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="relative rounded-md px-3 py-1 capitalize transition-colors"
            >
              {view === v && (
                <motion.span
                  layoutId="calViewPill"
                  className="absolute inset-0 rounded-md bg-surface-3"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className={`relative ${view === v ? 'text-text' : 'text-muted'}`}>{v}</span>
            </button>
          ))}
        </div>
        <button
          onClick={goToday}
          className="rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text"
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface/70 p-2 backdrop-blur-sm">
        <div className="grid grid-cols-7">
          {weekdays.map((d, i) => (
            <div key={i} className="pb-1 text-center text-[11px] font-medium text-faint">
              {d}
            </div>
          ))}
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={anchor + view}
            custom={dir}
            initial={{ opacity: 0, x: dir * 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -30 }}
            transition={{ type: 'spring', stiffness: 350, damping: 34 }}
            className="grid grid-cols-7 gap-0.5"
          >
            {cells.map((cell) => (
              <CalendarCell
                key={cell.dateStr}
                label={format(cell.date, 'd')}
                inMonth={cell.inMonth}
                isToday={cell.dateStr === today}
                isSelected={cell.dateStr === selected}
                items={cell.items}
                onSelect={() => setSelected(cell.dateStr)}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Selected day detail */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">
            {selected === today ? 'Today · ' : ''}
            {formatDateLong(selected)}
          </h2>
          <button
            onClick={() => openEditor(undefined, selected)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface/60 px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-text"
          >
            <PlusIcon className="size-3.5" /> Add
          </button>
        </div>
        {selectedItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint">
            Nothing scheduled.
          </p>
        ) : (
          <motion.div layout className="flex flex-col gap-2">
            <AnimatePresence initial={false} mode="popLayout">
              {selectedItems.map((item) => (
                <TaskRow
                  key={item.task.id}
                  item={item}
                  dateStr={selected}
                  streak={
                    item.task.type === 'recurring'
                      ? currentStreak(item.task, completions, selected)
                      : 0
                  }
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>
    </div>
  )
}

function NavBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      aria-label={label}
      className="grid size-9 place-items-center rounded-lg border border-border bg-surface/60 text-muted transition-colors hover:text-text"
    >
      {children}
    </motion.button>
  )
}

function CalendarCell({
  label,
  inMonth,
  isToday,
  isSelected,
  items,
  onSelect,
}: {
  label: string
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  items: DayItem[]
  onSelect: () => void
}) {
  const dots = items.slice(0, 4)
  const allDone = items.length > 0 && items.every((i) => i.completed)
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onSelect}
      className={`flex aspect-square flex-col items-center justify-start gap-1 rounded-lg py-1.5 text-sm transition-colors ${
        isSelected ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-surface-2'
      } ${inMonth ? '' : 'opacity-35'}`}
    >
      <span
        className={`grid size-6 place-items-center rounded-full text-[13px] ${
          isToday ? 'bg-accent font-semibold text-on-accent' : 'text-text'
        }`}
      >
        {label}
      </span>
      <span className="flex h-2 items-center gap-0.5">
        {allDone ? (
          <span className="size-1.5 rounded-full bg-success" />
        ) : (
          dots.map((it, i) => (
            <span
              key={i}
              className={`size-1.5 rounded-full ${PRIORITY_STYLES[it.task.priority].bar} ${
                it.completed ? 'opacity-30' : ''
              }`}
            />
          ))
        )}
      </span>
    </motion.button>
  )
}
