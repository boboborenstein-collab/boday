import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { useStore } from '../store/useStore'
import { buildWeeklyReview } from '../lib/weeklyReview'
import { todayStr } from '../lib/date'
import { ProgressRing } from '../components/Confetti'
import { FlameIcon } from '../components/icons'

export function WeeklyReviewView() {
  const tasks = useStore((s) => s.tasks)
  const completions = useStore((s) => s.completions)
  const today = todayStr()

  const review = useMemo(
    () => buildWeeklyReview(tasks, completions, today),
    [tasks, completions, today],
  )

  return (
    <div>
      <header className="mb-5">
        <Link to="/stats" className="text-xs font-medium text-accent">
          ← Insights
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Weekly review</h1>
        <p className="mt-1 text-sm text-muted">{review.weekLabel}</p>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4 flex items-center gap-5 rounded-2xl border border-border bg-surface/70 p-5"
      >
        <ProgressRing value={review.ratio} size={88} stroke={8}>
          <div className="text-center">
            <div className="text-lg font-bold tabular-nums">{Math.round(review.ratio * 100)}%</div>
            <div className="text-[10px] text-muted">done</div>
          </div>
        </ProgressRing>
        <div>
          <div className="text-sm text-muted">This week</div>
          <div className="text-lg font-semibold">
            {review.completed} of {review.scheduled} completed
          </div>
          <div className="mt-1 text-xs text-muted">{review.perfectDays} perfect days</div>
        </div>
      </motion.div>

      <ul className="mb-4 flex flex-col gap-2">
        {review.highlights.map((h) => (
          <li
            key={h}
            className="rounded-xl border border-border bg-surface/60 px-4 py-3 text-sm text-text"
          >
            {h}
          </li>
        ))}
      </ul>

      {review.topStreak && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm">
          <FlameIcon className="size-4 text-warning" />
          <span className="text-muted">Strongest streak:</span>
          <span className="font-medium">{review.topStreak.title}</span>
          <span className="ml-auto font-semibold text-warning">{review.topStreak.streak}d</span>
        </div>
      )}

      {review.mostSkipped && (
        <p className="text-center text-xs text-faint">
          Most skipped: {review.mostSkipped.title} ({review.mostSkipped.count}×)
        </p>
      )}
    </div>
  )
}
