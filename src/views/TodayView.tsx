import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store/useStore'
import { buildTodayList } from '../lib/recurrence'
import { currentStreak } from '../lib/streaks'
import { todayStr } from '../lib/date'
import { formatDateLong } from '../lib/format'
import { TaskRow } from '../components/TaskRow'
import { ProgressRing } from '../components/Confetti'
import { SparklesIcon } from '../components/icons'
import {
  applyTodayOrder,
  collectTagsFromItems,
  filterTodayItems,
  groupByTimeBucket,
} from '../lib/todayLayout'
import { buildPlanSuggestion } from '../lib/planDay'
import { useJewishCalendar } from '../hooks/useJewishCalendar'
import { getDay } from 'date-fns'
import { fromDateStr } from '../lib/date'

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
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const openEditor = useStore((s) => s.openEditor)
  const setTodayOrder = useStore((s) => s.setTodayOrder)
  const deferCarriedNonUrgent = useStore((s) => s.deferCarriedNonUrgent)
  const bulkSkipRecurring = useStore((s) => s.bulkSkipRecurring)
  const today = todayStr()

  const rawItems = useMemo(
    () => buildTodayList(tasks, completions, today),
    [tasks, completions, today],
  )

  const allTags = useMemo(() => collectTagsFromItems(rawItems), [rawItems])

  const items = useMemo(() => {
    const filtered = filterTodayItems(rawItems, settings)
    return applyTodayOrder(filtered, settings.todayOrder)
  }, [rawItems, settings])

  const groups = useMemo(() => groupByTimeBucket(items), [items])
  const usePlanOrder = (settings.todayOrder?.length ?? 0) > 0

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

  const [planOpen, setPlanOpen] = useState(false)
  const plan = useMemo(() => buildPlanSuggestion(rawItems), [rawItems])

  const dayMap = useJewishCalendar(today, today)
  const todayInfo = dayMap.get(today)
  const isFriday = getDay(fromDateStr(today)) === 5

  const askBoDay = () => {
    setPlanOpen(true)
    if (plan.orderedIds.length) setTodayOrder(plan.orderedIds)
  }

  const runPlanAction = (kind: 'defer_carried' | 'focus_p1') => {
    if (kind === 'defer_carried') {
      const n = deferCarriedNonUrgent(today)
      window.dispatchEvent(
        new CustomEvent('boday-toast', {
          detail: n ? `Deferred ${n} task${n === 1 ? '' : 's'} to tomorrow.` : 'Nothing to defer.',
        }),
      )
    }
    if (kind === 'focus_p1') updateSettings({ focusMode: true })
    setPlanOpen(false)
  }

  return (
    <div>
      {isFriday && todayInfo?.candles && (
        <div className="mb-4 rounded-xl border border-border bg-surface/80 px-4 py-3 text-sm">
          <span className="font-medium text-accent">Shabbat prep</span>
          <span className="text-muted"> · Candles {todayInfo.candles}</span>
          <button
            type="button"
            onClick={() => bulkSkipRecurring(today, 'except_torah')}
            className="mt-2 block text-xs font-semibold text-accent hover:underline"
          >
            Skip non-Torah routines for today
          </button>
        </div>
      )}

      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-accent">{greeting()}</div>
          <h1 className="text-2xl font-bold tracking-tight">{formatDateLong(today)}</h1>
          <p className="mt-1 text-sm text-muted">
            {settings.focusMode
              ? 'Focus mode — P1 only'
              : allDone
                ? 'Everything done — beautiful work.'
                : remaining === 1
                  ? '1 thing left for today.'
                  : `${remaining} things left for today.`}
          </p>
        </div>
        {rawItems.length > 0 && (
          <div className="flex items-center gap-4">
            <button
              onClick={askBoDay}
              className="flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
            >
              <SparklesIcon className="size-3.5" />
              Ask BoDay
            </button>
            <ProgressRing value={progress} size={60}>
              <span className="text-xs font-semibold tabular-nums">
                {Math.round(progress * 100)}%
              </span>
            </ProgressRing>
          </div>
        )}
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => updateSettings({ focusMode: !settings.focusMode })}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            settings.focusMode
              ? 'bg-accent text-on-accent'
              : 'border border-border bg-surface/70 text-muted'
          }`}
        >
          Focus
        </button>
        {allTags.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => updateSettings({ todayTagFilter: null })}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                !settings.todayTagFilter
                  ? 'bg-surface-3 text-text'
                  : 'border border-border text-muted'
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => updateSettings({ todayTagFilter: tag })}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  settings.todayTagFilter === tag
                    ? 'bg-surface-3 text-text'
                    : 'border border-border text-muted'
                }`}
              >
                #{tag}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="mb-6 flex gap-2">
        <StatChip value={remaining} label="To do" delay={0.02} />
        <StatChip value={carried} label="Carried over" tone={carried ? 'text-carry' : undefined} delay={0.06} />
        <StatChip value={highPriority} label="P1" tone={highPriority ? 'text-p1' : undefined} delay={0.1} />
        <StatChip value={done} label="Done" tone={done ? 'text-success' : undefined} delay={0.14} />
      </div>

      <AnimatePresence>
        {planOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden rounded-2xl border border-accent/30 bg-accent-soft/40 p-4"
          >
            <div className="text-sm font-semibold">{plan.headline}</div>
            <p className="mt-1 text-sm text-muted">{plan.detail}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {plan.actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => runPlanAction(a.kind)}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
                >
                  {a.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {items.length === 0 ? (
        <EmptyState onAdd={() => openEditor(undefined, today)} filtered={Boolean(settings.todayTagFilter || settings.focusMode)} />
      ) : usePlanOrder ? (
        <motion.div layout className="flex flex-col gap-2">
          <p className="mb-1 px-1 text-[11px] font-medium text-accent">BoDay plan order</p>
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
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.bucket}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-faint">
                {g.label}
              </h2>
              <motion.div layout className="flex flex-col gap-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {g.items.map((item) => (
                    <TaskRow
                      key={item.task.id}
                      item={item}
                      dateStr={today}
                      streak={streaks.get(item.task.id)}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ onAdd, filtered }: { onAdd: () => void; filtered?: boolean }) {
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
      <div className="mt-4 text-lg font-semibold">{filtered ? 'No matches' : 'All clear'}</div>
      <p className="mt-1 max-w-xs text-sm text-muted">
        {filtered
          ? 'Try another tag or turn off focus mode.'
          : 'Nothing scheduled for today. Add a task or enjoy the calm.'}
      </p>
      {!filtered && (
        <button
          onClick={onAdd}
          className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-glow transition-transform hover:scale-[1.03] active:scale-95"
        >
          Add your first task
        </button>
      )}
    </motion.div>
  )
}
