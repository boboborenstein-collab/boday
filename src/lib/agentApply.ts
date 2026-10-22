export interface ApplyOpts {
  nowIso: string
  newId: () => string
}

export type ApplyResult<T, C> =
  | { ok: true; tasks: T[]; completions: C[] }
  | { ok: false; message: string }

const STALE = 'This proposal is out of date. Nothing was applied.'
const INVALID = "This proposal can't be applied. Nothing was applied."

type Rec = Record<string, unknown>
type Phase = 'apply' | 'undo'
type Issue = 'invalid' | 'stale'
type Status = 'open' | 'done' | 'skipped'

export function sameValue(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true
  if (expected === null) return actual === undefined
  if (typeof expected !== 'object') return false
  if (typeof actual !== 'object' || actual === null) return false
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || actual.length !== expected.length) return false
    return expected.every((item, index) => sameValue(actual[index], item))
  }
  const exp = expected as Rec
  const act = actual as Rec
  return Object.keys(exp).every((key) => sameValue(key in act ? act[key] : undefined, exp[key]))
}

export function fieldValue(task: object, key: string): unknown {
  const rec = task as Rec
  if (!(key in rec) || rec[key] === undefined) return null
  return rec[key]
}

export function currentStatus(
  task: object,
  completions: readonly object[],
  date: string | null,
): Status | null {
  const row = task as Rec
  if (row.type === 'one_time') return row.completed === true ? 'done' : 'open'
  if (row.type !== 'recurring') return null
  if (date === null) return null
  const found = completions.find((completion) => {
    const item = completion as Rec
    return item.taskId === row.id && item.completionDate === date
  }) as Rec | undefined
  if (!found) return 'open'
  return found.skipped === true ? 'skipped' : 'done'
}

type CompletionLike = {
  id: string
  taskId: string
  completionDate: string
  completedAt: string
  skipped?: boolean
}

export function withRecurringStatus<C extends CompletionLike>(
  completions: C[],
  taskId: string,
  date: string,
  status: 'done' | 'skipped' | 'none',
  opts: ApplyOpts,
): C[] {
  const matches = (row: C) => row.taskId === taskId && row.completionDate === date
  if (status === 'none') {
    if (!completions.some(matches)) return completions
    return completions.filter((row) => !matches(row))
  }
  const index = completions.findIndex(matches)
  if (index === -1) {
    const created = {
      id: opts.newId(),
      taskId,
      completionDate: date,
      completedAt: opts.nowIso,
      ...(status === 'skipped' ? { skipped: true as const } : {}),
    } as C
    return [...completions, created]
  }
  const existing = completions[index]
  if (status === 'done' && existing.skipped !== true) return completions
  if (status === 'skipped' && existing.skipped === true) return completions
  const next = { ...existing }
  if (status === 'done') delete next.skipped
  else next.skipped = true
  return completions.map((row, i) => (i === index ? next : row))
}

export function withOneTimeStatus<T extends { id: string; type: string }>(
  tasks: T[],
  id: string,
  completed: boolean,
  nowIso: string,
): T[] {
  const index = tasks.findIndex((task) => task.id === id)
  if (index === -1) return tasks
  const task = tasks[index] as T & { completed?: boolean; completedAt?: string | null }
  if (task.type !== 'one_time') return tasks
  if ((task.completed === true) === completed) return tasks
  const next = { ...task, completed, completedAt: completed ? nowIso : null } as T
  return tasks.map((item, i) => (i === index ? next : item))
}

function isRec(value: unknown): value is Rec {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asStatus(value: unknown): Status | null {
  return value === 'open' || value === 'done' || value === 'skipped' ? value : null
}

function findById<T extends { id: string }>(items: readonly T[], id: string): T | undefined {
  return items.find((item) => item.id === id)
}

function repeatedTaskId(changes: readonly unknown[]): boolean {
  const seen = new Set<string>()
  for (const change of changes) {
    if (!isRec(change) || typeof change.taskId !== 'string') continue
    if (seen.has(change.taskId)) return true
    seen.add(change.taskId)
  }
  return false
}

function completionId(value: unknown): string | null {
  if (!isRec(value) || typeof value.id !== 'string') return null
  return value.id
}

function inspect<T extends { id: string }, C extends { id: string }>(
  state: { tasks: readonly T[]; completions: readonly C[] },
  change: Rec,
  phase: Phase,
): Issue | null {
  const taskId = change.taskId
  if (typeof taskId !== 'string') return 'invalid'
  const task = findById(state.tasks, taskId)
  if (change.op === 'update') return inspectUpdate(task, change, phase)
  if (change.op === 'create') return inspectCreate(state.tasks, task, change, phase)
  if (change.op === 'delete') return inspectDelete(state, task, change, phase)
  if (change.op === 'set_status') return inspectStatus(state, task, change, phase)
  return 'invalid'
}

function inspectUpdate(task: object | undefined, change: Rec, phase: Phase): Issue | null {
  const patch = isRec(change.patch) ? change.patch : null
  const beforeFields = isRec(change.beforeFields) ? change.beforeFields : null
  if (!patch || !beforeFields) return 'invalid'
  for (const key of Object.keys(patch)) {
    if (!(key in beforeFields)) return 'invalid'
  }
  if (!task) return 'stale'
  const compared = phase === 'apply' ? beforeFields : patch
  for (const key of Object.keys(patch)) {
    if (!sameValue(fieldValue(task, key), compared[key])) return 'stale'
  }
  return null
}

function inspectCreate<T extends { id: string }>(
  tasks: readonly T[],
  task: T | undefined,
  change: Rec,
  phase: Phase,
): Issue | null {
  const after = isRec(change.after) ? change.after : null
  if (!after || after.id !== change.taskId) return 'invalid'
  if (phase === 'apply') return task || tasks.some((item) => item.id === after.id) ? 'stale' : null
  if (!task) return 'stale'
  for (const key of Object.keys(after)) {
    if (!sameValue(fieldValue(task, key), after[key])) return 'stale'
  }
  return null
}

function inspectDelete<T extends { id: string }, C extends { id: string }>(
  state: { tasks: readonly T[]; completions: readonly C[] },
  task: T | undefined,
  change: Rec,
  phase: Phase,
): Issue | null {
  const raw = isRec(change.beforeRaw) ? change.beforeRaw : null
  if (!raw || !Array.isArray(change.beforeCompletionsRaw)) return 'invalid'
  if (phase === 'undo') {
    for (const item of change.beforeCompletionsRaw) {
      if (completionId(item) === null) return 'invalid'
    }
    if (task) return 'stale'
    for (const item of change.beforeCompletionsRaw) {
      const id = completionId(item)
      if (id && state.completions.some((completion) => completion.id === id)) return 'stale'
    }
    return null
  }
  if (!task) return 'stale'
  if (!(sameValue(task, raw) && sameValue(raw, task))) return 'stale'
  return null
}

function inspectStatus<T extends { id: string }, C extends { id: string }>(
  state: { tasks: readonly T[]; completions: readonly C[] },
  task: T | undefined,
  change: Rec,
  phase: Phase,
): Issue | null {
  const before = isRec(change.before) ? change.before : null
  const after = isRec(change.after) ? change.after : null
  const beforeStatus = before ? asStatus(before.status) : null
  const afterStatus = after ? asStatus(after.status) : null
  if (!beforeStatus || !afterStatus) return 'invalid'
  if (!task) return 'stale'
  const kind = (task as Rec).type
  if (kind === 'recurring') {
    if (typeof change.date !== 'string') return 'invalid'
    if (beforeStatus === 'open' && change.beforeCompletionRaw !== null) return 'invalid'
    if ((beforeStatus === 'done' || beforeStatus === 'skipped') && completionId(change.beforeCompletionRaw) === null) {
      return 'invalid'
    }
  } else if (kind === 'one_time') {
    if (beforeStatus === 'skipped' || afterStatus === 'skipped') return 'invalid'
    if (beforeStatus === 'open' && change.beforeCompletionRaw !== null) return 'invalid'
    if (beforeStatus === 'done' && !isRec(change.beforeCompletionRaw)) return 'invalid'
  } else {
    return 'invalid'
  }
  const date = kind === 'recurring' ? (change.date as string) : null
  const actual = currentStatus(task, state.completions, date)
  const expected = phase === 'apply' ? beforeStatus : afterStatus
  if (actual !== expected) return 'stale'
  if (
    phase === 'apply' &&
    kind === 'recurring' &&
    (beforeStatus === 'done' || beforeStatus === 'skipped')
  ) {
    const id = completionId(change.beforeCompletionRaw)
    if (!id || !state.completions.some((completion) => completion.id === id)) return 'stale'
  }
  return null
}

function applyChange<T extends { id: string; type: string }, C extends CompletionLike>(
  tasks: T[],
  completions: C[],
  change: Rec,
  opts: ApplyOpts,
): { tasks: T[]; completions: C[] } {
  const taskId = change.taskId as string
  if (change.op === 'update') {
    const patch = change.patch as Rec
    return {
      tasks: tasks.map((task) => (task.id === taskId ? ({ ...task, ...patch } as T) : task)),
      completions,
    }
  }
  if (change.op === 'create') {
    return { tasks: [...tasks, structuredClone(change.after) as T], completions }
  }
  if (change.op === 'delete') {
    const ids = new Set(
      (change.beforeCompletionsRaw as unknown[]).map(completionId).filter((id): id is string => id !== null),
    )
    return {
      tasks: tasks.filter((task) => task.id !== taskId),
      completions: completions.filter((completion) => !ids.has(completion.id)),
    }
  }
  return applyStatus(tasks, completions, change, opts)
}

function applyStatus<T extends { id: string; type: string }, C extends CompletionLike>(
  tasks: T[],
  completions: C[],
  change: Rec,
  opts: ApplyOpts,
): { tasks: T[]; completions: C[] } {
  const taskId = change.taskId as string
  const task = findById(tasks, taskId) as (T & Rec) | undefined
  const beforeStatus = (change.before as Rec).status as Status
  const afterStatus = (change.after as Rec).status as Status
  if (!task) return { tasks, completions }
  if (beforeStatus === 'open') {
    if (task.type === 'recurring') {
      if (afterStatus === 'open') return { tasks, completions }
      return {
        tasks,
        completions: withRecurringStatus(
          completions,
          taskId,
          change.date as string,
          afterStatus === 'skipped' ? 'skipped' : 'done',
          opts,
        ),
      }
    }
    if (afterStatus === 'open') return { tasks, completions }
    return { tasks: withOneTimeStatus(tasks, taskId, true, opts.nowIso), completions }
  }
  if (task.type === 'recurring') {
    const rawId = completionId(change.beforeCompletionRaw) as string
    if (afterStatus === 'open') {
      return { tasks, completions: completions.filter((completion) => completion.id !== rawId) }
    }
    if (afterStatus === 'skipped') {
      return {
        tasks,
        completions: completions.map((completion) =>
          completion.id === rawId ? { ...completion, skipped: true } : completion,
        ),
      }
    }
    return {
      tasks,
      completions: completions.map((completion) => {
        if (completion.id !== rawId) return completion
        const next = { ...completion }
        delete next.skipped
        return next
      }),
    }
  }
  if (afterStatus === 'open') {
    return {
      tasks: tasks.map((item) =>
        item.id === taskId ? ({ ...item, completed: false, completedAt: null } as T) : item,
      ),
      completions,
    }
  }
  return { tasks, completions }
}

function undoChange<T extends { id: string; type: string }, C extends CompletionLike>(
  tasks: T[],
  completions: C[],
  change: Rec,
  opts: ApplyOpts,
): { tasks: T[]; completions: C[] } {
  const taskId = change.taskId as string
  if (change.op === 'update') {
    const beforeFields = change.beforeFields as Rec
    return {
      tasks: tasks.map((task) => (task.id === taskId ? ({ ...task, ...beforeFields } as T) : task)),
      completions,
    }
  }
  if (change.op === 'create') {
    return { tasks: tasks.filter((task) => task.id !== taskId), completions }
  }
  if (change.op === 'delete') {
    const raws = change.beforeCompletionsRaw as unknown[]
    return {
      tasks: [...tasks, structuredClone(change.beforeRaw) as T],
      completions: [...completions, ...raws.map((item) => structuredClone(item) as C)],
    }
  }
  return undoStatus(tasks, completions, change, opts)
}

function undoStatus<T extends { id: string; type: string }, C extends CompletionLike>(
  tasks: T[],
  completions: C[],
  change: Rec,
  opts: ApplyOpts,
): { tasks: T[]; completions: C[] } {
  const taskId = change.taskId as string
  const task = findById(tasks, taskId) as (T & Rec) | undefined
  const beforeStatus = (change.before as Rec).status as Status
  if (!task) return { tasks, completions }
  if (beforeStatus === 'open') {
    if (task.type === 'recurring') {
      return {
        tasks,
        completions: withRecurringStatus(completions, taskId, change.date as string, 'none', opts),
      }
    }
    return { tasks: withOneTimeStatus(tasks, taskId, false, opts.nowIso), completions }
  }
  if (task.type === 'recurring') {
    const raw = structuredClone(change.beforeCompletionRaw) as C
    const exists = completions.some((completion) => completion.id === raw.id)
    return {
      tasks,
      completions: exists
        ? completions.map((completion) => (completion.id === raw.id ? raw : completion))
        : [...completions, raw],
    }
  }
  const raw = change.beforeCompletionRaw as Rec
  return {
    tasks: tasks.map((item) => {
      if (item.id !== taskId) return item
      const next = { ...item, completed: true } as T & { completedAt?: string | null }
      if ('completedAt' in raw) next.completedAt = raw.completedAt as string | null
      else delete next.completedAt
      return next as T
    }),
    completions,
  }
}

function run<T extends { id: string; type: string }, C extends CompletionLike>(
  state: { tasks: T[]; completions: C[] },
  changes: readonly Record<string, unknown>[],
  selectedTaskIds: readonly string[],
  opts: ApplyOpts,
  phase: Phase,
): ApplyResult<T, C> {
  if (repeatedTaskId(changes)) return { ok: false, message: INVALID }
  const selected = new Set(selectedTaskIds)
  const chosen: Rec[] = []
  for (const change of changes) {
    if (!isRec(change) || typeof change.taskId !== 'string' || !selected.has(change.taskId)) continue
    const problem = inspect(state, change, phase)
    if (problem === 'invalid') return { ok: false, message: INVALID }
    if (problem === 'stale') return { ok: false, message: STALE }
    chosen.push(change)
  }
  let tasks = state.tasks
  let completions = state.completions
  for (const change of chosen) {
    const next = phase === 'apply'
      ? applyChange(tasks, completions, change, opts)
      : undoChange(tasks, completions, change, opts)
    tasks = next.tasks
    completions = next.completions
  }
  return { ok: true, tasks, completions }
}

export function applyProposal<T extends { id: string; type: string }, C extends CompletionLike>(
  state: { tasks: T[]; completions: C[] },
  changes: readonly Record<string, unknown>[],
  selectedTaskIds: readonly string[],
  opts: ApplyOpts,
): ApplyResult<T, C> {
  return run(state, changes, selectedTaskIds, opts, 'apply')
}

export function undoProposal<T extends { id: string; type: string }, C extends CompletionLike>(
  state: { tasks: T[]; completions: C[] },
  changes: readonly Record<string, unknown>[],
  appliedTaskIds: readonly string[],
  opts: ApplyOpts,
): ApplyResult<T, C> {
  return run(state, changes, appliedTaskIds, opts, 'undo')
}
