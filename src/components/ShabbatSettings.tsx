import { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { format } from 'date-fns'
import { useStore } from '../store/useStore'
import {
  loadQuietPrefs,
  saveQuietPrefs,
  searchLocations,
  fetchHebcalItems,
  computeQuietWindows,
} from '../lib/hebcal'
import type { QuietPrefs, QuietWindow } from '../lib/hebcal'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-faint">
        {title}
      </h2>
      <div className="rounded-2xl border border-border bg-surface/70 p-4 divide-y divide-border">
        {children}
      </div>
    </section>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-faint">{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-surface-3'
        }`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm ${
            checked ? 'left-[1.375rem]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}

export function ShabbatSettings() {
  const updateSettings = useStore((s) => s.updateSettings)
  const showShabbatOnCalendar = useStore((s) => s.settings.showShabbatOnCalendar)
  const showHolidaysOnCalendar = useStore((s) => s.settings.showHolidaysOnCalendar)

  const [prefs, setPrefs] = useState<QuietPrefs>({ enabled: false, geonameid: null, locationName: '' })
  const [nextWindow, setNextWindow] = useState<QuietWindow | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ geonameid: number; name: string }[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadQuietPrefs().then((p) => {
      if (p) setPrefs(p)
    })
  }, [])

  useEffect(() => {
    if (prefs.enabled && prefs.geonameid) {
      const today = new Date()
      const start = today.toISOString().split('T')[0]
      const plus9 = new Date(today)
      plus9.setDate(plus9.getDate() + 9)
      const end = plus9.toISOString().split('T')[0]

      fetchHebcalItems(start, end, prefs.geonameid).then((items) => {
        const windows = computeQuietWindows(items)
        const now = Date.now()
        const upcoming = windows.find((w) => Date.parse(w.end) > now)
        setNextWindow(upcoming ?? null)
      })
    } else {
      setNextWindow(null)
    }
  }, [prefs.enabled, prefs.geonameid])

  const handleQuietToggle = (enabled: boolean) => {
    const nextPrefs = { ...prefs, enabled }
    setPrefs(nextPrefs)
    saveQuietPrefs(nextPrefs)
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setSearchQuery(q)

    if (searchTimeout.current) clearTimeout(searchTimeout.current)

    if (!q.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    searchTimeout.current = setTimeout(async () => {
      const results = await searchLocations(q)
      setSearchResults(results)
      setSearching(false)
    }, 300)
  }

  const handleSelectLocation = (geonameid: number, locationName: string) => {
    const nextPrefs = { ...prefs, geonameid, locationName }
    setPrefs(nextPrefs)
    saveQuietPrefs(nextPrefs)
    setSearchQuery('')
    setSearchResults([])
  }

  return (
    <Section title="Shabbat & holidays">
      <Toggle
        label="Quiet mode"
        description="Pause all notifications & the app from candle-lighting to havdalah"
        checked={prefs.enabled}
        onChange={handleQuietToggle}
      />

      <div className="flex flex-col gap-2 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Location</span>
          <span className="text-sm text-muted">{prefs.locationName || 'Not set'}</span>
        </div>
        <input
          type="text"
          placeholder="Search for a city…"
          value={searchQuery}
          onChange={handleSearchChange}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        {searching && <div className="px-1 text-xs text-faint">Searching…</div>}
        {searchResults.length > 0 && (
          <div className="mt-1 flex flex-col gap-1 rounded-lg border border-border bg-surface bg-opacity-50 p-1">
            {searchResults.map((r) => (
              <button
                key={r.geonameid}
                onClick={() => handleSelectLocation(r.geonameid, r.name)}
                className="rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <Toggle
        label="Shabbat times on calendar"
        checked={showShabbatOnCalendar}
        onChange={(v) => updateSettings({ showShabbatOnCalendar: v })}
      />

      <Toggle
        label="Holidays on calendar"
        checked={showHolidaysOnCalendar}
        onChange={(v) => updateSettings({ showHolidaysOnCalendar: v })}
      />

      {prefs.enabled && prefs.geonameid && nextWindow && (
        <div className="py-2.5">
          <div className="text-xs text-muted">
            🕯️ Next: {format(new Date(nextWindow.start), 'EEE h:mmaaa')} →{' '}
            {format(new Date(nextWindow.end), 'EEE h:mmaaa')}
          </div>
        </div>
      )}
    </Section>
  )
}
