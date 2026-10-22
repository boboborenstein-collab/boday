import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { useStore } from '../store/useStore'
import { agentEntry } from '../lib/agentChat'
import {
  CalendarIcon,
  ChartIcon,
  ListIcon,
  ChecklistIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
} from './icons'

const NAV = [
  { to: '/', label: 'Today', icon: ListIcon },
  { to: '/tasks', label: 'Tasks', icon: ChecklistIcon },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { to: '/stats', label: 'Stats', icon: ChartIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function NavItem({
  to,
  label,
  Icon,
  active,
}: {
  to: string
  label: string
  Icon: (p: { className?: string }) => ReactNode
  active: boolean
}) {
  return (
    <NavLink
      to={to}
      className="relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium"
    >
      <span className="relative grid place-items-center">
        {active && (
          <motion.span
            layoutId="navGlow"
            className="absolute -inset-x-3 -inset-y-1.5 rounded-full bg-accent-soft"
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          />
        )}
        <Icon className={`relative size-5 ${active ? 'text-accent' : 'text-faint'}`} />
      </span>
      <span className={active ? 'text-accent' : 'text-faint'}>{label}</span>
    </NavLink>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const openEditor = useStore((s) => s.openEditor)
  const openCommand = useStore((s) => s.openCommand)
  const openAgent = useStore((s) => s.openAgent)
  const [online, setOnline] = useState(() => navigator.onLine)
  const { pathname } = useLocation()
  const entry = agentEntry({ online })

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-on-accent shadow-glow">
            <span className="text-sm font-black">C</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-gradient">BoDay</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openAgent()}
            disabled={entry.disabled}
            aria-label="BoDay Agent"
            title={entry.hint ?? undefined}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-muted backdrop-blur-sm transition-colors hover:text-text disabled:opacity-50"
          >
            <SparklesIcon className="size-4" />
            <span className="hidden sm:inline">BoDay Agent</span>
            {entry.disabled && entry.hint && <span>{entry.hint}</span>}
          </button>
          <button
            onClick={openCommand}
            aria-label="Search and commands"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-muted backdrop-blur-sm transition-colors hover:text-text"
          >
            <SearchIcon className="size-4" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-faint sm:inline">
              ⌘K
            </kbd>
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-3">{children}</main>

      {/* Bottom navigation */}
      <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border">
        <div
          className="mx-auto flex max-w-2xl items-center px-2"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <NavItem to={NAV[0].to} label={NAV[0].label} Icon={NAV[0].icon} active={pathname === '/'} />
          <NavItem
            to={NAV[1].to}
            label={NAV[1].label}
            Icon={NAV[1].icon}
            active={pathname.startsWith('/tasks')}
          />

          <motion.button
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            onClick={() => openEditor()}
            aria-label="Add task"
            className="mx-1 -mt-6 grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-on-accent shadow-glow"
          >
            <PlusIcon className="size-7" />
          </motion.button>

          <NavItem
            to={NAV[2].to}
            label={NAV[2].label}
            Icon={NAV[2].icon}
            active={pathname.startsWith('/calendar')}
          />
          <NavItem
            to={NAV[3].to}
            label={NAV[3].label}
            Icon={NAV[3].icon}
            active={pathname.startsWith('/stats')}
          />
          <NavItem
            to={NAV[4].to}
            label={NAV[4].label}
            Icon={NAV[4].icon}
            active={pathname.startsWith('/settings')}
          />
        </div>
      </nav>
    </div>
  )
}
