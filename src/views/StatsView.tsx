import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { format } from 'date-fns'
import { useStore } from '../store/useStore'
import { dailyStats, overview, lifetimeCompleted } from '../lib/stats'
import { fromDateStr, todayStr } from '../lib/date'
import { ProgressRing } from '../components/Confetti'
import { FlameIcon, TrophyIcon, TargetIcon, RepeatIcon } from '../components/icons'

export function StatsView() {
  const tasks = useStore((s) => s.tasks)
  const completions = useStore((s) => s.completions)
  const today = todayStr()
  const [windowDays, setWindowDays] = useState<7 | 30>(7)

  const days = useMemo(
    () => dailyStats(tasks, completions, today, windowDays),
    [tasks, completions, today, windowDays],
  )
  const ov = useMemo(
    () => overview(tasks, completions, today, windowDays),
    [tasks, completions, today, windowDays],
  )
  const lifetime = useMemo(() => lifetimeCompleted(tasks, completions), [tasks, completions])

  const maxTotal = Math.max(1, ...days.map((d) => d.total))

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-accent">Insights</div>
          <h1 className="text-2xl font-bold tracking-tight">Your momentum</h1>
          <Link to="/review" className="mt-1 inline-block text-xs font-medium text-accent">
            Weekly review →
          </Link>
        </div>
        <div className="flex rounded-lg border border-border bg-surface/60 p-0.5 text-xs font-medium">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className="relative rounded-md px-2.5 py-1"
            >
              {windowDays === d && (
                <motion.span
                  layoutId="statRange"
                  className="absolute inset-0 rounded-md bg-surface-3"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className={`relative ${windowDays === d ? 'text-text' : 'text-muted'}`}>
                {d}d
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* Hero card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
        className="mb-4 flex items-center gap-5 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-2 p-5"
      >
        <ProgressRing value={ov.windowRatio} size={92} stroke={8}>
          <div className="text-center">
            <div className="text-xl font-bold tabular-nums">{Math.round(ov.windowRatio * 100)}%</div>
            <div className="text-[10px] text-muted">done</div>
          </div>
        </ProgressRing>
        <div className="flex-1">
          <div className="text-sm text-muted">Last {windowDays} days</div>
          <div className="mt-0.5 text-lg font-semibold">
            {ov.completedInWindow} of {ov.scheduledInWindow} completed
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-carry-soft px-2.5 py-1 text-xs font-medium text-carry">
            <FlameIcon className="size-3.5" />
            {ov.perfectStreak > 0
              ? `${ov.perfectStreak}-day perfect streak`
              : 'Start a perfect streak today'}
          </div>
        </div>
      </motion.div>

      {/* Stat tiles */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <StatTile icon={<TargetIcon className="size-4" />} label="Perfect days" value={ov.perfectDays} delay={0.02} />
        <StatTile icon={<RepeatIcon className="size-4" />} label="Active routines" value={ov.activeRecurring} delay={0.06} />
        <StatTile icon={<TrophyIcon className="size-4" />} label="Lifetime completed" value={lifetime} delay={0.1} />
        <StatTile icon={<FlameIcon className="size-4" />} label="Best streak" value={ov.topStreak?.streak ?? 0} delay={0.14} />
      </div>

      {ov.topStreak && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-surface/70 px-4 py-3 text-sm">
          <FlameIcon className="size-4 text-warning" />
          <span className="text-muted">Longest active streak:</span>
          <span className="font-medium">{ov.topStreak.title}</span>
          <span className="ml-auto font-semibold tabular-nums text-warning">
            {ov.topStreak.streak}d
          </span>
        </div>
      )}

      {/* Activity chart */}
      <section className="rounded-2xl border border-border bg-surface/70 p-4">
        <h2 className="mb-3 text-sm font-semibold">Daily completion</h2>
        {ov.scheduledInWindow === 0 ? (
          <p className="py-6 text-center text-sm text-faint">
            No activity yet — completed tasks will show up here.
          </p>
        ) : (
          <div className="flex h-32 items-stretch gap-1">
            {days.map((d, i) => {
              const heightPct = Math.max(4, (d.total / maxTotal) * 100)
              const donePct = d.total ? (d.completed / d.total) * 100 : 0
              return (
                <div key={d.dateStr} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPct}%` }}
                    transition={{ delay: i * 0.01, type: 'spring', stiffness: 200, damping: 26 }}
                    className="relative w-full overflow-hidden rounded-md bg-surface-3"
                    title={`${format(fromDateStr(d.dateStr), 'MMM d')}: ${d.completed}/${d.total}`}
                  >
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-md bg-gradient-to-t from-accent to-accent-2"
                      style={{ height: `${donePct}%` }}
                    />
                  </motion.div>
                  {windowDays === 7 && (
                    <span className="text-[9px] text-faint">
                      {format(fromDateStr(d.dateStr), 'EEEEE')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  delay,
}: {
  icon: React.ReactNode
  label: string
  value: number
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 280, damping: 24 }}
      className="rounded-xl border border-border bg-surface/70 p-3"
    >
      <div className="flex items-center gap-1.5 text-muted">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </motion.div>
  )
}
