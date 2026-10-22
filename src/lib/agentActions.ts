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
}

function fireFeedback(deps: AgentActionDeps, body: FeedbackBody): void {
  void deps.feedback(body).catch(() => {})
}

export function approveMessage(deps: AgentActionDeps, message: ChatMessage): void {
  if (message.proposalStatus !== 'pending') return
  const selected = message.selectedTaskIds ?? []
  const result = deps.apply(message.changes ?? [], selected)
  if (!result.ok) {
    deps.toast(result.message)
    return
  }
  deps.dispatch({ type: 'resolve', messageId: message.id, status: 'applied' })
  const applied: ChatMessage = { ...message, proposalStatus: 'applied', appliedTaskIds: [...selected] }
  deps.toast({
    message: 'Applied.',
    actionLabel: 'Undo',
    onAction: () => undoMessage(deps, applied),
  })
  fireFeedback(deps, { runId: message.traceId ?? '', event: 'approve', taskIds: selected })
}

export function rejectMessage(deps: AgentActionDeps, message: ChatMessage): void {
  if (message.proposalStatus !== 'pending') return
  deps.dispatch({ type: 'resolve', messageId: message.id, status: 'rejected' })
  fireFeedback(deps, { runId: message.traceId ?? '', event: 'reject', taskIds: [] })
}

export function undoMessage(deps: AgentActionDeps, message: ChatMessage): void {
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
