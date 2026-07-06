import { useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store/useStore'
import { todayStr } from '../lib/date'
import { carryOverDays } from '../lib/recurrence'
import { TaskRow } from '../components/TaskRow'
import { SparklesIcon } from '../components/icons'
import type { OneTimeTask } from '../types'

interface SectionProps {
  title: string
  tasks: OneTimeTask[]
  today: string
  isOverdue?: boolean
}

function TaskSection({ title, tasks, today, isOverdue = false }: SectionProps) {
  if (tasks.length === 0) return null

  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-faint">
        {title} ({tasks.length})
      </h2>
      <motion.div layout className="flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              item={{
                task,
                completed: task.completed,
                carriedOverFromDays: isOverdue ? carryOverDays(task, today) : 0,
              }}
              dateStr={today}
              overdue={isOverdue}
            />
          ))}
        </AnimatePresence>
      </motion.div>
    </section>
  )
}

export function TasksView() {
  const tasks = useStore((s) => s.tasks)
  const openEditor = useStore((s) => s.openEditor)
  const today = todayStr()

  const oneTimeTasks = useMemo(() => {
    return tasks.filter((t) => t.type === 'one_time') as OneTimeTask[]
  }, [tasks])

  const overdue = useMemo(() => {
    return oneTimeTasks.filter((t) => !t.completed && t.scheduledDate < today)
  }, [oneTimeTasks, today])

  const todayTasks = useMemo(() => {
    return oneTimeTasks.filter((t) => !t.completed && t.scheduledDate === today)
  }, [oneTimeTasks, today])

  const upcoming = useMemo(() => {
    return oneTimeTasks.filter((t) => !t.completed && t.scheduledDate > today)
  }, [oneTimeTasks, today])

  const done = useMemo(() => {
    return oneTimeTasks
      .filter((t) => t.completed)
      .sort((a, b) => {
        const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0
        const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0
        return timeB - timeA
      })
      .slice(0, 20)
  }, [oneTimeTasks])

  const isEmpty =
    overdue.length === 0 &&
    todayTasks.length === 0 &&
    upcoming.length === 0 &&
    done.length === 0

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-muted">
          Master list of one-time tasks
        </p>
      </header>

      {isEmpty ? (
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
          <div className="mt-4 text-lg font-semibold">No tasks yet</div>
          <p className="mt-1 max-w-xs text-sm text-muted">
            Your master task list is clear. Add a one-time task to get started!
          </p>
          <button
            onClick={() => openEditor(undefined, today)}
            className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-glow transition-transform hover:scale-[1.03] active:scale-95"
          >
            Add a task
          </button>
        </motion.div>
      ) : (
        <>
          <TaskSection title="Overdue" tasks={overdue} today={today} isOverdue />
          <TaskSection title="Today" tasks={todayTasks} today={today} />
          <TaskSection title="Upcoming" tasks={upcoming} today={today} />
          <TaskSection title="Done" tasks={done} today={today} />
        </>
      )}
    </div>
  )
}
