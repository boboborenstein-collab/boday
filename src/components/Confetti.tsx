import { motion } from 'motion/react'

/**
 * A one-shot confetti burst rendered as absolutely-positioned DOM particles.
 * Mount it (e.g. via AnimatePresence) when something is worth celebrating;
 * it animates outward once and the parent unmounts it on completion.
 */
const COLORS = [
  'var(--color-accent)',
  'var(--color-accent-2)',
  'var(--color-success)',
  'var(--color-p2)',
  'var(--color-p3)',
]

const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  // Deterministic spread so we never call Math.random in render.
  const angle = (i / 14) * Math.PI * 2
  const dist = 34 + (i % 4) * 12
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist - 10,
    rotate: (i % 2 ? 1 : -1) * (120 + i * 18),
    color: COLORS[i % COLORS.length],
    delay: (i % 5) * 0.012,
    square: i % 3 === 0,
  }
})

export function Confetti({ onDone }: { onDone?: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-visible">
      {PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, scale: 1, opacity: 0, rotate: p.rotate }}
          transition={{ duration: 0.7, delay: p.delay, ease: [0.22, 1, 0.36, 1] }}
          onAnimationComplete={i === 0 ? onDone : undefined}
          style={{ background: p.color }}
          className={`absolute size-2 ${p.square ? 'rounded-[2px]' : 'rounded-full'}`}
        />
      ))}
    </div>
  )
}

/** SVG progress ring used in the Today header + Stats. */
export function ProgressRing({
  value,
  size = 56,
  stroke = 5,
  children,
}: {
  /** 0–1 */
  value: number
  size?: number
  stroke?: number
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface-3)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 grid place-items-center">{children}</div>
      )}
    </div>
  )
}
