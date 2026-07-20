import { useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store/useStore'
import { buildTodayList } from '../lib/recurrence'
import { currentStreak } from '../lib/streaks'
import { todayStr } from '../lib/date'
import { formatDateLong } from '../lib/format'
import { TaskRow } from '../components/TaskRow'
import { ProgressRing } from '../components/Confetti'
import { SparklesIcon } from '../components/icons'
import { useState } from 'react'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Winding down'
}

function StatChip({
  value,
  label,
  tone,
  delay,
}: {
  value: number
  label: string
  tone?: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 300, damping: 24 }}
      className="flex-1 rounded-xl border border-border bg-surface/70 px-3 py-2.5 backdrop-blur-sm"
    >
      <div className={`text-xl font-semibold tabular-nums ${tone ?? 'text-text'}`}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </motion.div>
  )
}

export function TodayView() {
  const tasks = useStore((s) => s.tasks)
  const completions = useStore((s) => s.completions)
  const openEditor = useStore((s) => s.openEditor)
  const today = todayStr()

  const items = useMemo(
    () => buildTodayList(tasks, completions, today),
    [tasks, completions, today],
  )

  const streaks = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of items) {
      if (it.task.type === 'recurring' && !it.task.excludeFromStats) {
        map.set(it.task.id, currentStreak(it.task, completions, today))
      }
    }
    return map
  }, [items, completions, today])

  const remaining = items.filter((i) => !i.completed && !i.skipped).length
  const carried = items.filter((i) => i.carriedOverFromDays > 0).length
  const highPriority = items.filter((i) => !i.completed && !i.skipped && i.task.priority === 1).length
  const done = items.filter((i) => i.completed).length
  const progress = items.length ? done / items.length : 0
  const allDone = items.length > 0 && remaining === 0

  const [planning, setPlanning] = useState(false)
  const askBoDay = () => {
    setPlanning(true)
    setTimeout(() => {
      setPlanning(false)
      let msg = ''
      if (allDone) msg = "You're all done for today. Enjoy the rest of your day!"
      else if (remaining === 0) msg = "Your day is completely clear. Enjoy the calm!"
      else if (carried > 2) msg = `You have ${carried} tasks piling up. Want me to push the non-urgent ones to tomorrow?`
      else if (carried > 0) msg = `Let's knock out those ${carried} carried over tasks first to clear your mind.`
      else if (highPriority > 0) msg = `You have ${highPriority} urgent tasks today. Let's tackle those first!`
      else msg = `You have ${remaining} tasks today. A perfectly balanced day. Let's get started!`
      
      window.dispatchEvent(new CustomEvent('boday-toast', { detail: `✨ ${msg}` }))
    }, 1500)
  }

  return (
    <div>
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-accent">{greeting()}</div>
          <h1 className="text-2xl font-bold tracking-tight">{formatDateLong(today)}</h1>
          <p className="mt-1 text-sm text-muted">
            {allDone
              ? 'Everything done — beautiful work.'
              : remaining === 1
                ? '1 thing left for today.'
                : `${remaining} things left for today.`}
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-4">
            <button
              onClick={askBoDay}
              disabled={planning}
              className="flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              <SparklesIcon className={`size-3.5 ${planning ? 'animate-pulse' : ''}`} />
              {planning ? 'Planning...' : 'Ask BoDay'}
            </button>
            <ProgressRing value={progress} size={60}>
              <span className="text-xs font-semibold tabular-nums">
                {Math.round(progress * 100)}%
              </span>
            </ProgressRing>
          </div>
        )}
      </header>

      <div className="mb-6 flex gap-2">
        <StatChip value={remaining} label="To do" delay={0.02} />
        <StatChip value={carried} label="Carried over" tone={carried ? 'text-carry' : undefined} delay={0.06} />
        <StatChip value={highPriority} label="P1" tone={highPriority ? 'text-p1' : undefined} delay={0.1} />
        <StatChip value={done} label="Done" tone={done ? 'text-success' : undefined} delay={0.14} />
      </div>

      {items.length === 0 ? (
        <EmptyState onAdd={() => openEditor(undefined, today)} />
      ) : (
        <motion.div layout className="flex flex-col gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item) => (
              <TaskRow
                key={item.task.id}
                item={item}
                dateStr={today}
                streak={streaks.get(item.task.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      className="mt-16 flex flex-col items-center text-center"
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="grid size-16 place-items-center rounded-2xl bg-accent-soft text-accent"
      >
        <SparklesIcon className="size-8" />
      </motion.div>
      <div className="mt-4 text-lg font-semibold">All clear</div>
      <p className="mt-1 max-w-xs text-sm text-muted">
        Nothing scheduled for today. Add a task or enjoy the calm.
      </p>
      <button
        onClick={onAdd}
        className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-glow transition-transform hover:scale-[1.03] active:scale-95"
      >
        Add your first task
      </button>
    </motion.div>
  )
}
