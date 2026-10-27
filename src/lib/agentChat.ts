import type { RunResponse } from './agentContract'
import type { AgentAiPrefs, UserPrefsEnvelope } from './userPrefs'
import type { TimeFormat } from '../types'
import { formatTime, formatTimesInText } from './format'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  outcome?: string | null
  changes?: unknown[]
  question?: string | null
  options?: string[]
  traceId?: string
  parseWarnings?: string[]
  proposalStatus?: 'pending' | 'applied' | 'rejected' | 'undone' | null
  selectedTaskIds?: string[]
  appliedTaskIds?: string[]
  /** Epoch ms when the proposal was applied; the card's Undo stays inert briefly after. */
  appliedAt?: number
}

export interface ChatState {
  messages: ChatMessage[]
  sending: boolean
}

export type ChatEvent =
  | { type: 'send'; id: string; text: string }
  | { type: 'assistant'; id: string; response: RunResponse }
  | { type: 'fail'; id: string; text: string }
  | { type: 'toggle'; messageId: string; taskId: string }
  | { type: 'resolve'; messageId: string; status: 'applied' | 'rejected' | 'undone'; at?: number }
  | { type: 'new' }

export interface HistoryTurn {
  role: 'user' | 'assistant'
  text: string
  proposal: unknown[] | null
  proposalStatus: ChatMessage['proposalStatus'] | null
}

const EMPTY: ChatState = { messages: [], sending: false }

function taskIdsOf(changes: unknown[]): string[] {
  const ids: string[] = []
  for (const change of changes) {
    if (change && typeof change === 'object' && 'taskId' in change) {
      const id = (change as { taskId?: unknown }).taskId
      if (typeof id === 'string') ids.push(id)
    }
  }
  return ids
}

export function reduce(state: ChatState, event: ChatEvent): ChatState {
  if (event.type === 'send') {
    if (state.sending) return state
    return {
      messages: [...state.messages, { id: event.id, role: 'user', text: event.text }],
      sending: true,
    }
  }
  if (event.type === 'assistant') {
    const { response } = event
    return {
      messages: [
        ...state.messages,
        {
          id: event.id,
          role: 'assistant',
          text: response.text,
          outcome: response.outcome,
          changes: response.changes,
          question: response.question,
          options: response.options,
          traceId: response.traceId,
          parseWarnings: response.parseWarnings,
          proposalStatus: response.outcome === 'proposed' ? 'pending' : null,
          selectedTaskIds: taskIdsOf(response.changes),
        },
      ],
      sending: false,
    }
  }
  if (event.type === 'fail') {
    return {
      messages: [
        ...state.messages,
        {
          id: event.id,
          role: 'assistant',
          text: event.text,
          outcome: 'failed',
          changes: [],
          proposalStatus: null,
        },
      ],
      sending: false,
    }
  }
  if (event.type === 'toggle') {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.id !== event.messageId || message.proposalStatus !== 'pending') return message
        const selected = message.selectedTaskIds ?? []
        const next = selected.includes(event.taskId)
          ? selected.filter((id) => id !== event.taskId)
          : [...selected, event.taskId]
        return { ...message, selectedTaskIds: next }
      }),
    }
  }
  if (event.type === 'resolve') {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.id !== event.messageId) return message
        const fromPending = event.status === 'applied' || event.status === 'rejected'
        if (fromPending && message.proposalStatus !== 'pending') return message
        if (event.status === 'undone' && message.proposalStatus !== 'applied') return message
        return {
          ...message,
          proposalStatus: event.status,
          appliedTaskIds: event.status === 'applied' ? [...(message.selectedTaskIds ?? [])] : message.appliedTaskIds,
          appliedAt: event.status === 'applied' ? event.at : message.appliedAt,
        }
      }),
    }
  }
  return EMPTY
}

export function toHistory(messages: ChatMessage[]): HistoryTurn[] {
  const source = messages.at(-1)?.role === 'user' ? messages.slice(0, -1) : messages
  return source.map((message) => {
    const dropProposal = message.role === 'user' || message.outcome === 'failed' || message.outcome === 'asked'
    return {
      role: message.role,
      text: message.text.slice(0, 4000),
      proposal: dropProposal ? null : (message.changes ?? []),
      proposalStatus: dropProposal ? null : (message.proposalStatus ?? null),
    }
  })
}

export function chatKey(userId: string): string {
  return `boday-agent-chat-v1:${userId}`
}

export interface ChatStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Keep an in-flight thread when the same account reopens the panel. */
export function chatOnOpen(
  current: ChatState | null,
  stored: ChatState,
  previousUserId: string | null,
  nextUserId: string | null,
): ChatState {
  const sameUser = previousUserId !== null && previousUserId === nextUserId
  if (sameUser && current && (current.sending || current.messages.length > 0)) return current
  return stored
}

export interface PanelAccount {
  signedIn: boolean
  userId: string | null
  email: string | null
  prefs: AgentAiPrefs | null
  windows: { start: string; end: string; title: string }[]
}

/**
 * Read the account and prefs for an opening panel. Returns null only when the panel closed
 * meanwhile; otherwise loading must end. New chat during the load keeps the account but
 * skips restoring the stored thread. A failed read leaves the panel signed out.
 */
export async function loadPanel(deps: {
  getSessionUser: () => Promise<{ id: string; email: string | null } | null>
  loadEnv: () => Promise<UserPrefsEnvelope>
  isCancelled: () => boolean
  generationChanged: () => boolean
}): Promise<{ account: PanelAccount; restoreChat: boolean } | null> {
  let account: PanelAccount = { signedIn: false, userId: null, email: null, prefs: null, windows: [] }
  try {
    const user = await deps.getSessionUser()
    const env = await deps.loadEnv()
    account = {
      signedIn: user !== null,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      prefs: env.ai ?? null,
      windows: env.cache?.windows ?? [],
    }
  } catch {
    // Signed out is the safe reading of a failed load.
  }
  if (deps.isCancelled()) return null
  return { account, restoreChat: !deps.generationChanged() }
}

/** A model reply belongs to the turn that sent it. New chat bumps the generation. */
export function acceptModelReply(currentGeneration: number, sentGeneration: number): boolean {
  return currentGeneration === sentGeneration
}

export function loadChat(storage: ChatStorage, userId: string): ChatState {
  try {
    const raw = storage.getItem(chatKey(userId))
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as { messages?: unknown; sending?: unknown }
    if (!parsed || !Array.isArray(parsed.messages)) return EMPTY
    return { messages: parsed.messages as ChatMessage[], sending: false }
  } catch {
    return EMPTY
  }
}

export function saveChat(storage: ChatStorage, userId: string, state: ChatState): void {
  try {
    const key = chatKey(userId)
    if (state.messages.length === 0) {
      storage.removeItem(key)
      return
    }
    storage.setItem(key, JSON.stringify({ messages: state.messages, sending: false }))
  } catch {
    // A full localStorage must not crash the panel.
  }
}

export function agentEntry({ online }: { online: boolean }): { disabled: boolean; hint: string | null } {
  return { disabled: !online, hint: online ? null : 'needs internet' }
}

export function agentPaletteItem(
  query: string,
  online: boolean,
  configured: boolean,
): { label: string; disabled: boolean; hint: string } | null {
  if (query.trim() === '') return null
  if (!online) return { label: `BoDay Agent: ${query}`, disabled: true, hint: 'needs internet' }
  if (!configured) return { label: `BoDay Agent: ${query}`, disabled: true, hint: 'Connect a model' }
  return { label: `BoDay Agent: ${query}`, disabled: false, hint: 'Ask' }
}

export function canSend({
  online,
  serviceConfigured,
  hasModel,
  sending,
  text,
}: {
  online: boolean
  serviceConfigured: boolean
  hasModel: boolean
  sending: boolean
  text: string
}): boolean {
  return online && serviceConfigured && hasModel && !sending && text.trim().length > 0
}

export function panelMessage({
  online,
  serviceConfigured,
  signedIn,
  hasModel,
}: {
  online: boolean
  serviceConfigured: boolean
  signedIn: boolean
  hasModel: boolean
}): string | null {
  if (!online) return 'needs internet'
  if (!serviceConfigured) return "BoDay AI isn't configured on this build."
  if (!signedIn) return 'Sign in required.'
  if (!hasModel) return 'Connect a model to enable BoDay AI.'
  return null
}

export function normalizeToast(
  detail: string | { message: string; actionLabel: string | null; onAction?: () => void },
): { message: string; actionLabel: string | null; durationMs: number; onAction?: () => void } {
  if (typeof detail === 'string') return { message: detail, actionLabel: null, durationMs: 5000 }
  return {
    message: detail.message,
    actionLabel: detail.actionLabel,
    durationMs: 8000,
    onAction: detail.onAction,
  }
}

export interface DiffRow {
  taskId: string
  title: string
  lines: string[]
  warnings: string[]
  checked: boolean
}

function plain(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function show(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

/** One diff line. A reminder time is shown in the user's format; other fields as stored. */
function fieldLine(key: string, values: unknown[], fmt: TimeFormat): string {
  if (key !== 'reminderTime') return `${key}: ${values.map(show).join(' → ')}`
  const times = values.map((value) => (typeof value === 'string' ? formatTime(value, fmt) : 'none'))
  return `Reminder: ${times.join(' → ')}`
}

function changeTitle(change: Record<string, unknown>, tasks: readonly { id: string; title?: string }[]): string {
  const taskId = typeof change.taskId === 'string' ? change.taskId : ''
  const task = tasks.find((item) => item.id === taskId)
  if (task?.title) return task.title
  const beforeRaw = plain(change.beforeRaw)
  const after = plain(change.after)
  if (typeof beforeRaw?.title === 'string' && beforeRaw.title) return beforeRaw.title
  if (change.op === 'create' && typeof after?.title === 'string' && after.title) return after.title
  return taskId
}

function warningMessages(change: Record<string, unknown>, fmt: TimeFormat): string[] {
  if (!Array.isArray(change.warnings)) return []
  const messages: string[] = []
  for (const warning of change.warnings) {
    const row = plain(warning)
    // The server writes times as HH:mm inside the sentence.
    if (row && typeof row.message === 'string') messages.push(formatTimesInText(row.message, fmt))
  }
  return messages
}

export function diffModel(
  changes: readonly unknown[],
  selectedTaskIds: readonly string[],
  tasks: readonly { id: string; title?: string }[],
  fmt: TimeFormat = '24h',
): { creates: DiffRow[]; updates: DiffRow[]; deletes: DiffRow[] } {
  const selected = new Set(selectedTaskIds)
  const creates: DiffRow[] = []
  const updates: DiffRow[] = []
  const deletes: DiffRow[] = []
  for (const change of changes) {
    const rec = plain(change)
    if (!rec || typeof rec.taskId !== 'string') continue
    const row: DiffRow = {
      taskId: rec.taskId,
      title: changeTitle(rec, tasks),
      lines: [],
      warnings: warningMessages(rec, fmt),
      checked: selected.has(rec.taskId),
    }
    if (rec.op === 'create') {
      const after = plain(rec.after) ?? {}
      row.lines = Object.keys(after)
        .filter((key) => key !== 'id')
        .map((key) => fieldLine(key, [after[key]], fmt))
      creates.push(row)
    } else if (rec.op === 'delete') {
      row.lines = [typeof rec.reason === 'string' ? rec.reason : '']
      deletes.push(row)
    } else if (rec.op === 'set_status') {
      const before = plain(rec.before) ?? {}
      const after = plain(rec.after) ?? {}
      row.lines = [`status: ${show(before.status)} → ${show(after.status)}`]
      if (typeof rec.date === 'string') row.lines.push(`date: ${rec.date}`)
      updates.push(row)
    } else if (rec.op === 'update') {
      const patch = plain(rec.patch) ?? {}
      const beforeFields = plain(rec.beforeFields) ?? {}
      row.lines = Object.keys(patch).map((key) => fieldLine(key, [beforeFields[key], patch[key]], fmt))
      updates.push(row)
    }
  }
  return { creates, updates, deletes }
}
