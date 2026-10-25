import type { ChatEvent, ChatMessage } from './agentChat'

export type ProposalResult =
  | { ok: true; tasks?: unknown[]; completions?: unknown[] }
  | { ok: false; message: string }

export interface FeedbackBody {
  runId: string
  event: 'approve' | 'reject' | 'undo'
  taskIds: string[]
}

export interface AgentActionDeps {
  apply: (changes: unknown[], selectedTaskIds: string[]) => ProposalResult
  undo: (changes: unknown[], appliedTaskIds: string[]) => ProposalResult
  feedback: (body: FeedbackBody) => Promise<unknown>
  dispatch: (event: ChatEvent) => void
  toast: (detail: string | { message: string; actionLabel: string; onAction?: () => void }) => void
  /** The message as it is now. Clicks hold the copy from render time, which can be stale. */
  current: (messageId: string) => ChatMessage | undefined
  /** Clock for the card Undo guard; defaults to Date.now. */
  now?: () => number
}

/** The card's Undo ignores clicks this long after Approve, so a double-click can't undo. */
export const UNDO_ARM_MS = 600

function nowMs(deps: AgentActionDeps): number {
  return deps.now ? deps.now() : Date.now()
}

function fireFeedback(deps: AgentActionDeps, body: FeedbackBody): void {
  void deps.feedback(body).catch(() => {})
}

/** Prefer the live message; a toast can outlive it (New chat), so fall back to the copy. */
function latest(deps: AgentActionDeps, message: ChatMessage): ChatMessage {
  return deps.current(message.id) ?? message
}

export function approveMessage(deps: AgentActionDeps, clicked: ChatMessage): void {
  const message = latest(deps, clicked)
  if (message.proposalStatus !== 'pending') return
  const selected = message.selectedTaskIds ?? []
  const result = deps.apply(message.changes ?? [], selected)
  if (!result.ok) {
    deps.toast(result.message)
    return
  }
  deps.dispatch({ type: 'resolve', messageId: message.id, status: 'applied', at: nowMs(deps) })
  const applied: ChatMessage = { ...message, proposalStatus: 'applied', appliedTaskIds: [...selected] }
  deps.toast({
    message: 'Applied.',
    actionLabel: 'Undo',
    onAction: () => undoMessage(deps, applied),
  })
  fireFeedback(deps, { runId: message.traceId ?? '', event: 'approve', taskIds: selected })
}

export function rejectMessage(deps: AgentActionDeps, clicked: ChatMessage): void {
  const message = latest(deps, clicked)
  if (message.proposalStatus !== 'pending') return
  deps.dispatch({ type: 'resolve', messageId: message.id, status: 'rejected' })
  fireFeedback(deps, { runId: message.traceId ?? '', event: 'reject', taskIds: [] })
}

export function undoMessage(deps: AgentActionDeps, clicked: ChatMessage): void {
  const message = latest(deps, clicked)
  if (message.proposalStatus !== 'applied') return
  const applied = message.appliedTaskIds ?? []
  const result = deps.undo(message.changes ?? [], applied)
  if (!result.ok) {
    deps.toast(result.message)
    return
  }
  deps.dispatch({ type: 'resolve', messageId: message.id, status: 'undone' })
  deps.toast('Undone.')
  fireFeedback(deps, { runId: message.traceId ?? '', event: 'undo', taskIds: applied })
}

/** Undo from the diff card. Inert for UNDO_ARM_MS after Approve; the toast's Undo is not. */
export function cardUndo(deps: AgentActionDeps, clicked: ChatMessage): void {
  const message = latest(deps, clicked)
  if (message.proposalStatus !== 'applied') return
  if (typeof message.appliedAt === 'number' && nowMs(deps) - message.appliedAt < UNDO_ARM_MS) return
  undoMessage(deps, message)
}
