import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store/useStore'
import {
  CalendarIcon,
  ChartIcon,
  ListIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from './icons'
import { priorityMeta } from '../lib/priority'
import { parseNaturalLanguage } from '../lib/nlp'

interface Cmd {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  run: () => void
}

export function CommandPalette() {
  const open = useStore((s) => s.commandOpen)
  const openCmd = useStore((s) => s.openCommand)
  const close = useStore((s) => s.closeCommand)
  const openEditor = useStore((s) => s.openEditor)
  const addTask = useStore((s) => s.addTask)
  const tasks = useStore((s) => s.tasks)
  const theme = useStore((s) => s.settings.theme)
  const update = useStore((s) => s.updateSettings)
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useStore.getState().commandOpen ? close() : openCmd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openCmd, close])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // focus after the mount animation kicks off
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const actions: Cmd[] = useMemo(() => {
    const go = (to: string) => () => {
      navigate(to)
      close()
    }
    return [
      { id: 'new', label: 'New task', hint: 'Create', icon: <PlusIcon className="size-4" />, run: () => { close(); openEditor() } },
      { id: 'today', label: 'Go to Today', icon: <ListIcon className="size-4" />, run: go('/') },
      { id: 'calendar', label: 'Go to Calendar', icon: <CalendarIcon className="size-4" />, run: go('/calendar') },
      { id: 'stats', label: 'Go to Insights', icon: <ChartIcon className="size-4" />, run: go('/stats') },
      { id: 'review', label: 'Weekly review', icon: <ChartIcon className="size-4" />, run: go('/review') },
      { id: 'settings', label: 'Go to Settings', icon: <SettingsIcon className="size-4" />, run: go('/settings') },
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />,
        run: () => update({ theme: theme === 'dark' ? 'light' : 'dark' }),
      },
    ]
  }, [navigate, close, openEditor, theme, update])

  const q = query.trim().toLowerCase()

  const filteredActions = useMemo(
    () => (q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions),
    [actions, q],
  )

  const taskResults: Cmd[] = useMemo(() => {
    if (!q) return []
    return tasks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.notes?.toLowerCase().includes(q) ||
          t.tags?.some((tag) => tag.includes(q)),
      )
      .slice(0, 6)
      .map((t) => ({
        id: `task-${t.id}`,
        label: t.title,
        hint: priorityMeta(t.priority).short,
        icon: <SearchIcon className="size-4" />,
        run: () => {
          close()
          openEditor(t.id)
        },
      }))
  }, [tasks, q, close, openEditor])

  const aiAction: Cmd | null = useMemo(() => {
    if (!q) return null
    return {
      id: 'ai-add',
      label: `Create: "${query}"`,
      hint: 'BoDay AI',
      icon: <PlusIcon className="size-4 text-accent" />,
      run: () => {
        addTask(parseNaturalLanguage(query))
        close()
      }
    }
  }, [q, query, addTask, close])

  const all = useMemo(() => [...(aiAction ? [aiAction] : []), ...filteredActions, ...taskResults], [aiAction, filteredActions, taskResults])

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, all.length - 1)))
  }, [all.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % Math.max(1, all.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + all.length) % Math.max(1, all.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      all[active]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={close}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-bg-elev shadow-lg"
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <SearchIcon className="size-4 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search tasks or type a command…"
                className="flex-1 bg-transparent py-3.5 text-sm text-text outline-none placeholder:text-faint"
              />
              <kbd className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-faint">esc</kbd>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {all.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-faint">No matches</div>
              ) : (
                <>
                  {aiAction && (
                    <Group label="BoDay AI">
                      <Item cmd={aiAction} active={0 === active} onHover={() => setActive(0)} />
                    </Group>
                  )}
                  {filteredActions.length > 0 && (
                    <Group label="Actions">
                      {filteredActions.map((c) => {
                        const idx = all.indexOf(c)
                        return <Item key={c.id} cmd={c} active={idx === active} onHover={() => setActive(idx)} />
                      })}
                    </Group>
                  )}
                  {taskResults.length > 0 && (
                    <Group label="Tasks">
                      {taskResults.map((c) => {
                        const idx = all.indexOf(c)
                        return <Item key={c.id} cmd={c} active={idx === active} onHover={() => setActive(idx)} />
                      })}
                    </Group>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
        {label}
      </div>
      {children}
    </div>
  )
}

function Item({ cmd, active, onHover }: { cmd: Cmd; active: boolean; onHover: () => void }) {
  return (
    <button
      onMouseEnter={onHover}
      onClick={cmd.run}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
        active ? 'bg-accent-soft text-text' : 'text-muted'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-faint'}>{cmd.icon}</span>
      <span className="flex-1 truncate">{cmd.label}</span>
      {cmd.hint && <span className="text-[11px] text-faint">{cmd.hint}</span>}
    </button>
  )
}
