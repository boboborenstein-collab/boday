import { useEffect, useState } from 'react'
import { traceLoadMessage, traceSummary, type TraceSummaryView } from '../lib/agentSettings'
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient'

export function TraceViewer() {
  const configured = isSupabaseConfigured()
  const [rows, setRows] = useState<TraceSummaryView[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!configured) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await getSupabase()
        .from('agent_traces')
        .select('id, created_at, data')
        .order('created_at', { ascending: false })
        .limit(20)
      if (cancelled) return
      if (error || !data) {
        setFailed(true)
        return
      }
      setRows(data.map((row) => traceSummary(row as { id: string; created_at: string; data: null })))
    })()
    return () => {
      cancelled = true
    }
  }, [configured])

  if (!configured) return null
  const unavailable = traceLoadMessage(failed)
  if (unavailable) return <p className="text-xs text-muted">{unavailable}</p>
  if (!rows) return <p className="text-xs text-faint">Loading…</p>
  if (rows.length === 0) return <p className="text-xs text-faint">No traces yet.</p>

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setOpenId((current) => (current === row.id ? null : row.id))}
            className="flex w-full items-center justify-between text-left text-xs"
          >
            <span className="font-medium">{row.outcome}</span>
            <span className="text-faint">{row.createdAt}</span>
          </button>
          {openId === row.id && (
            <ul className="mt-2 space-y-1">
              {row.events.map((event, index) => (
                <li key={`${event.label}-${index}`} className="text-[11px] text-muted">
                  <span className="font-medium text-text">{event.label}</span>
                  {event.detail ? ` · ${event.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
