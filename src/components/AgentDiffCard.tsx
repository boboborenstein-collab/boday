import type { ChatMessage } from '../lib/agentChat'
import { diffModel } from '../lib/agentChat'
import type { DiffRow } from '../lib/agentChat'

export function AgentDiffCard({
  message,
  tasks,
  onToggle,
  onApprove,
  onReject,
  onUndo,
}: {
  message: ChatMessage
  tasks: readonly { id: string; title?: string }[]
  onToggle: (taskId: string) => void
  onApprove: () => void
  onReject: () => void
  onUndo: () => void
}) {
  const model = diffModel(message.changes ?? [], message.selectedTaskIds ?? [], tasks)
  const rows = [...model.creates, ...model.updates, ...model.deletes]
  const anyChecked = rows.some((row) => row.checked)
  const pending = message.proposalStatus === 'pending'
  const applied = message.proposalStatus === 'applied'
  const settled = message.proposalStatus === 'rejected' || message.proposalStatus === 'undone'

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-border bg-surface/70 p-3">
      {model.creates.length > 0 && (
        <section className="text-success">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide">Creates</h3>
          {model.creates.map((row) => (
            <DiffRowView key={row.taskId} row={row} disabled={!pending} onToggle={onToggle} />
          ))}
        </section>
      )}
      {model.updates.length > 0 && (
        <section className="text-p3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide">Updates</h3>
          {model.updates.map((row) => (
            <DiffRowView key={row.taskId} row={row} disabled={!pending} onToggle={onToggle} />
          ))}
        </section>
      )}
      {model.deletes.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-danger">Deletes</h3>
          {model.deletes.map((row) => (
            <DiffRowView key={row.taskId} row={row} disabled={!pending} onToggle={onToggle} />
          ))}
        </section>
      )}
      {pending && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={!anyChecked}
            onClick={onApprove}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-40"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted"
          >
            Reject
          </button>
        </div>
      )}
      {applied && (
        <button
          type="button"
          onClick={onUndo}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted"
        >
          Undo
        </button>
      )}
      {settled && <p className="text-xs capitalize text-faint">{message.proposalStatus}</p>}
    </div>
  )
}

function DiffRowView({
  row,
  disabled,
  onToggle,
}: {
  row: DiffRow
  disabled: boolean
  onToggle: (taskId: string) => void
}) {
  return (
    <label className="mt-1 flex items-start gap-2 text-xs text-text">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={row.checked}
        disabled={disabled}
        onChange={() => onToggle(row.taskId)}
      />
      <span>
        <span className="font-medium">{row.title}</span>
        {row.lines.map((line) => (
          <span key={line} className="block text-muted">
            {line}
          </span>
        ))}
        {row.warnings.map((warning) => (
          <span key={warning} className="block text-warning">
            {warning}
          </span>
        ))}
      </span>
    </label>
  )
}
