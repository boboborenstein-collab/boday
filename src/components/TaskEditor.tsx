import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useStore } from '../store/useStore'
import { todayStr } from '../lib/date'
import { PRIORITIES } from '../lib/priority'
import { PRIORITY_STYLES } from './priorityStyles'
import { RepeatIcon, TrashIcon, XIcon } from './icons'
import type { Priority, Recurrence, Task } from '../types'

const DOW = [
  { i: 0, label: 'S' },
  { i: 1, label: 'M' },
  { i: 2, label: 'T' },
  { i: 3, label: 'W' },
  { i: 4, label: 'T' },
  { i: 5, label: 'F' },
  { i: 6, label: 'S' },
]

/** Outer shell: handles open/close + backdrop + the show/hide animation. */
export function TaskEditor() {
  const open = useStore((s) => s.editorOpen)
  const editingId = useStore((s) => s.editingTaskId)
  const defaultDate = useStore((s) => s.editorDefaultDate)
  const closeEditor = useStore((s) => s.closeEditor)
  const existing = useStore((s) =>
    editingId ? (s.tasks.find((t) => t.id === editingId) ?? null) : null,
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={closeEditor}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.5, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-border bg-bg-elev p-5 shadow-lg sm:m-4 sm:max-w-lg sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          >
            {/* Grab handle (mobile sheet affordance) */}
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border-strong sm:hidden" />
            <EditorForm
              key={editingId ?? `new-${defaultDate ?? ''}`}
              existing={existing}
              defaultDate={defaultDate}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function EditorForm({ existing, defaultDate }: { existing: Task | null; defaultDate: string | null }) {
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const deleteTask = useStore((s) => s.deleteTask)
  const closeEditor = useStore((s) => s.closeEditor)

  const initialDate = defaultDate ?? todayStr()

  const [type, setType] = useState<'one_time' | 'recurring'>(existing?.type ?? 'one_time')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 3)
  const [reminderTime, setReminderTime] = useState(existing?.reminderTime ?? '')
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [tagInput, setTagInput] = useState('')

  const [scheduledDate, setScheduledDate] = useState(
    existing?.type === 'one_time' ? existing.scheduledDate : initialDate,
  )
  const [startDate, setStartDate] = useState(
    existing?.type === 'recurring' ? existing.startDate : initialDate,
  )
  const [endDate, setEndDate] = useState(
    existing?.type === 'recurring' ? (existing.endDate ?? '') : '',
  )
  const [recKind, setRecKind] = useState<Recurrence['kind']>(
    existing?.type === 'recurring' ? existing.recurrence.kind : 'daily',
  )
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    existing?.type === 'recurring' && existing.recurrence.kind === 'weekly'
      ? existing.recurrence.daysOfWeek
      : [1, 2, 3, 4, 5],
  )
  const [everyN, setEveryN] = useState(
    existing?.type === 'recurring' && existing.recurrence.kind === 'everyNDays'
      ? existing.recurrence.n
      : 2,
  )
  const [dateOfMonth, setDateOfMonth] = useState(
    existing?.type === 'recurring' && existing.recurrence.kind === 'monthly'
      ? existing.recurrence.dateOfMonth
      : 1,
  )

  const toggleDay = (i: number) =>
    setDaysOfWeek((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))

  const commitTag = () => {
    const t = tagInput.trim().replace(/^#/, '').toLowerCase()
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  const valid =
    title.trim().length > 0 &&
    (type === 'one_time' || recKind !== 'weekly' || daysOfWeek.length > 0) &&
    (type === 'one_time' || recKind !== 'everyNDays' || everyN >= 1) &&
    (type === 'one_time' || recKind !== 'monthly' || (dateOfMonth >= 1 && dateOfMonth <= 31))

  const save = () => {
    if (!valid) return
    const common = {
      title: title.trim(),
      notes: notes.trim() || undefined,
      priority,
      tags: tags.length ? tags : undefined,
      reminderTime: reminderTime || null,
    }

    if (type === 'one_time') {
      const fields = {
        ...common,
        type: 'one_time' as const,
        scheduledDate,
        completed: existing?.type === 'one_time' ? existing.completed : false,
        completedAt: existing?.type === 'one_time' ? (existing.completedAt ?? null) : null,
      }
      if (existing) updateTask({ ...fields, id: existing.id, createdAt: existing.createdAt })
      else addTask(fields)
    } else {
      const recurrence: Recurrence =
        recKind === 'daily'
          ? { kind: 'daily' }
          : recKind === 'weekly'
            ? { kind: 'weekly', daysOfWeek: [...daysOfWeek].sort((a, b) => a - b) }
            : recKind === 'everyNDays'
              ? { kind: 'everyNDays', n: everyN }
              : { kind: 'monthly', dateOfMonth }
      const fields = {
        ...common,
        type: 'recurring' as const,
        recurrence,
        startDate,
        endDate: endDate || null,
      }
      if (existing) updateTask({ ...fields, id: existing.id, createdAt: existing.createdAt })
      else addTask(fields)
    }
    closeEditor()
  }

  const remove = () => {
    if (existing) deleteTask(existing.id)
    closeEditor()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{existing ? 'Edit task' : 'New task'}</h2>
        <button
          onClick={closeEditor}
          aria-label="Close"
          className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <XIcon className="size-5" />
        </button>
      </div>

      {/* Type toggle — disabled while editing to avoid semantic drift */}
      <Segmented
        value={type}
        onChange={(v) => setType(v as typeof type)}
        disabled={!!existing}
        options={[
          { value: 'one_time', label: 'One-time' },
          { value: 'recurring', label: 'Recurring' },
        ]}
      />
      <p className="mb-4 mt-1.5 text-[11px] text-faint">
        {type === 'one_time'
          ? 'Carries over each day until you complete it.'
          : 'Resets every scheduled day — never piles up.'}
      </p>

      <Field label="Title">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              save()
            }
          }}
          placeholder="What needs doing?"
          className={inputCls}
        />
      </Field>

      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Details…"
          className={`${inputCls} resize-none`}
        />
      </Field>

      <Field label="Priority">
        <div className="grid grid-cols-4 gap-2">
          {PRIORITIES.map((p) => {
            const active = priority === p.value
            const ps = PRIORITY_STYLES[p.value]
            return (
              <motion.button
                key={p.value}
                whileTap={{ scale: 0.94 }}
                onClick={() => setPriority(p.value)}
                className={`rounded-xl border px-2 py-2 text-xs font-medium transition-colors ${
                  active
                    ? `${ps.softBg} ${ps.text} border-current`
                    : 'border-border text-muted hover:border-border-strong'
                }`}
              >
                <span className="block">{p.short}</span>
                <span className="block text-[10px] opacity-80">{p.label}</span>
              </motion.button>
            )
          })}
        </div>
      </Field>

      <Field label="Tags (optional)">
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-2 py-2">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-xs text-text"
            >
              #{t}
              <button
                onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                className="text-faint hover:text-text"
                aria-label={`Remove ${t}`}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commitTag()
              } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                setTags((prev) => prev.slice(0, -1))
              }
            }}
            onBlur={commitTag}
            placeholder={tags.length ? 'Add…' : 'work, health, errands…'}
            className="min-w-[6rem] flex-1 bg-transparent px-1 text-sm text-text outline-none placeholder:text-faint"
          />
        </div>
      </Field>

      {type === 'one_time' ? (
        <Field label="Scheduled date">
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className={inputCls}
          />
        </Field>
      ) : (
        <>
          <Field label="Repeats">
            <Segmented
              value={recKind}
              onChange={(v) => setRecKind(v as Recurrence['kind'])}
              options={[
                { value: 'daily', label: 'Every day' },
                { value: 'weekly', label: 'Days of week' },
                { value: 'everyNDays', label: 'Every N days' },
                { value: 'monthly', label: 'Monthly' },
              ]}
            />
          </Field>

          {recKind === 'weekly' && (
            <Field label="On these days">
              <div className="flex gap-1.5">
                {DOW.map((d) => {
                  const active = daysOfWeek.includes(d.i)
                  return (
                    <motion.button
                      key={d.i}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => toggleDay(d.i)}
                      className={`grid size-9 flex-1 place-items-center rounded-lg border text-sm font-medium transition-colors ${
                        active
                          ? 'border-accent bg-accent text-on-accent'
                          : 'border-border text-muted hover:border-border-strong'
                      }`}
                    >
                      {d.label}
                    </motion.button>
                  )
                })}
              </div>
            </Field>
          )}

          {recKind === 'everyNDays' && (
            <Field label="Interval">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">Every</span>
                <input
                  type="number"
                  min={1}
                  value={everyN}
                  onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
                  className={`${inputCls} w-20 text-center`}
                />
                <span className="text-muted">days</span>
              </div>
            </Field>
          )}

          {recKind === 'monthly' && (
            <Field label="Date of month">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">On the</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dateOfMonth}
                  onChange={(e) => setDateOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                  className={`${inputCls} w-20 text-center`}
                />
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="End date (optional)">
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
        </>
      )}

      <Field label="Reminder time (optional)">
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={reminderTime}
            onChange={(e) => setReminderTime(e.target.value)}
            className={`${inputCls} w-40`}
          />
          {reminderTime && (
            <button
              onClick={() => setReminderTime('')}
              className="text-xs text-faint hover:text-muted"
            >
              Clear
            </button>
          )}
        </div>
      </Field>

      <div className="mt-6 flex items-center gap-3">
        {existing && (
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={remove}
            aria-label="Delete task"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-border text-danger transition-colors hover:bg-danger/10"
          >
            <TrashIcon className="size-5" />
          </motion.button>
        )}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={save}
          disabled={!valid}
          className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-on-accent shadow-glow transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {existing ? 'Save changes' : 'Add task'}
        </motion.button>
      </div>

      {type === 'recurring' && !existing && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-faint">
          <RepeatIcon className="size-3.5" />
          Completions are tracked per day, so you keep streaks &amp; history.
        </p>
      )}
    </div>
  )
}

const inputCls =
  'w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-accent'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className={`flex rounded-xl border border-border p-1 ${disabled ? 'opacity-50' : ''}`}>
      {options.map((o) => (
        <button
          key={o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className="relative flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors"
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join('-')}`}
              className="absolute inset-0 rounded-lg bg-surface-3"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          )}
          <span className={`relative ${value === o.value ? 'text-text' : 'text-muted'}`}>
            {o.label}
          </span>
        </button>
      ))}
    </div>
  )
}
