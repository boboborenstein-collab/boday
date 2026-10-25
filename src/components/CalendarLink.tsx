import { useState } from 'react'
import type { CalendarLinkResult } from '../lib/calendarFeed'

/** The Apple Calendar subscription URL, or why it can't be shown (nothing to copy then). */
export function CalendarLink({ link }: { link: CalendarLinkResult }) {
  const [copied, setCopied] = useState(false)
  const url = link.ok ? link.url : ''
  return (
    <>
      <p className="mb-2 text-xs text-faint">
        Subscribe once in iPhone Settings → Calendar → Add Subscription Calendar.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          placeholder={link.ok ? undefined : 'Unavailable'}
          className="flex-1 truncate rounded-lg border border-border bg-surface-2 px-2 py-2 text-[11px] text-muted"
        />
        <button
          type="button"
          disabled={!link.ok}
          onClick={async () => {
            if (!link.ok) return
            await navigator.clipboard.writeText(link.url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium disabled:opacity-40"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {!link.ok && <p className="mt-2 text-xs text-danger">{link.message}</p>}
    </>
  )
}
