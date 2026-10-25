import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { useStore } from '../store/useStore'
import { downloadExport, parseImport } from '../lib/dataTransfer'
import { isSyncConfigured } from '../lib/sync'
import { getCalendarSubscriptionUrl, type CalendarLinkResult } from '../lib/calendarFeed'
import { isPushConfigured, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import { getSupabase } from '../lib/supabaseClient'
import { ADMIN_EMAIL, createInvite, listInvites, type Invite } from '../lib/invites'
import { ShabbatSettings } from '../components/ShabbatSettings'
import { AgentSettings } from '../components/AgentSettings'
import { CalendarLink } from '../components/CalendarLink'
import {
  DownloadIcon,
  MoonIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
} from '../components/icons'
import type { AccentKey, ThemeMode } from '../types'

const ACCENTS: { key: AccentKey; color: string }[] = [
  { key: 'indigo', color: '#6366f1' },
  { key: 'violet', color: '#8b5cf6' },
  { key: 'emerald', color: '#10b981' },
  { key: 'rose', color: '#f43f5e' },
  { key: 'amber', color: '#f59e0b' },
  { key: 'sky', color: '#0ea5e9' },
]

const THEMES: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'System', icon: <SparklesIcon className="size-4" /> },
  { value: 'light', label: 'Light', icon: <SunIcon className="size-4" /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon className="size-4" /> },
]

export function SettingsView() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const tasks = useStore((s) => s.tasks)
  const completions = useStore((s) => s.completions)
  const importData = useStore((s) => s.importData)
  const clearAll = useStore((s) => s.clearAll)

  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [calLink, setCalLink] = useState<CalendarLinkResult | null>(null)

  useEffect(() => {
    if (!isSyncConfigured()) return
    getCalendarSubscriptionUrl()
      .then(setCalLink)
      .catch(() => setCalLink({ ok: false, message: "Couldn't load your calendar link. Try again later." }))
  }, [])

  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  useEffect(() => {
    if (!isSyncConfigured()) return
    getSupabase()
      .auth.getSession()
      .then(({ data }) => setAccountEmail(data.session?.user.email ?? null))
  }, [])
  const isAdmin = accountEmail === ADMIN_EMAIL

  const signOut = async () => {
    await unsubscribeFromPush()
    await getSupabase().auth.signOut()
    clearAll() // don't leave this account's tasks on a shared device
    window.location.reload()
  }

  const notifSupported = typeof window !== 'undefined' && 'Notification' in window
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | null>(
    notifSupported ? Notification.permission : null,
  )
  const enableNotifications = async () => {
    if (!notifSupported) return
    const perm = await Notification.requestPermission()
    setNotifPerm(perm)
    if (perm === 'granted' && isPushConfigured()) {
      try {
        await subscribeToPush()
        setMsg({ kind: 'ok', text: 'Push reminders enabled on this device.' })
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Push setup failed.' })
      }
    }
  }

  const onImport = async (file: File) => {
    try {
      const text = await file.text()
      const data = parseImport(text)
      importData(data)
      setMsg({ kind: 'ok', text: `Imported ${data.tasks.length} tasks.` })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Import failed.' })
    }
  }

  return (
    <div>
      <header className="mb-5">
        <div className="text-sm font-medium text-accent">Settings</div>
        <h1 className="text-2xl font-bold tracking-tight">Make it yours</h1>
      </header>

      {/* Appearance */}
      <Section title="Appearance">
        <Row label="Theme">
          <div className="flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs font-medium">
            {THEMES.map((t) => (
              <button
                key={t.value}
                onClick={() => update({ theme: t.value })}
                className="relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
              >
                {settings.theme === t.value && (
                  <motion.span
                    layoutId="themePill"
                    className="absolute inset-0 rounded-md bg-surface-3"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span
                  className={`relative flex items-center gap-1.5 ${
                    settings.theme === t.value ? 'text-text' : 'text-muted'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Accent">
          <div className="flex gap-2">
            {ACCENTS.map((a) => (
              <motion.button
                key={a.key}
                whileTap={{ scale: 0.85 }}
                onClick={() => update({ accent: a.key })}
                aria-label={a.key}
                className={`size-7 rounded-full ring-2 ring-offset-2 ring-offset-bg transition-all ${
                  settings.accent === a.key ? 'ring-text' : 'ring-transparent'
                }`}
                style={{ backgroundColor: a.color }}
              />
            ))}
          </div>
        </Row>
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <Toggle
          label="Sound & haptics"
          description="A soft chime when you complete a task"
          checked={settings.sound}
          onChange={(v) => update({ sound: v })}
        />
        <Toggle
          label="Reduce motion"
          description="Minimise animations across the app"
          checked={settings.reduceMotion}
          onChange={(v) => update({ reduceMotion: v })}
        />
        {notifSupported && (
          <Row label="Notifications">
            {notifPerm === 'granted' ? (
              <span className="text-xs font-medium text-accent">On</span>
            ) : notifPerm === 'denied' ? (
              <span className="text-xs text-faint">Blocked — enable in iOS Settings</span>
            ) : (
              <button
                onClick={enableNotifications}
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-border-strong"
              >
                Enable
              </button>
            )}
          </Row>
        )}
        <Row label="Week starts on">
          <div className="flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs font-medium">
            {([
              { v: 0 as const, l: 'Sunday' },
              { v: 1 as const, l: 'Monday' },
            ]).map((o) => (
              <button
                key={o.v}
                onClick={() => update({ weekStartsOn: o.v })}
                className={`rounded-md px-2.5 py-1.5 ${
                  settings.weekStartsOn === o.v ? 'bg-surface-3 text-text' : 'text-muted'
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Weekly review">
          <Link
            to="/review"
            className="text-xs font-semibold text-accent transition-colors hover:underline"
          >
            Open review →
          </Link>
        </Row>
      </Section>

      <ShabbatSettings />

      <AgentSettings email={accountEmail} />

      {isSyncConfigured() && calLink && (
        <Section title="Apple Calendar">
          <CalendarLink link={calLink} />
        </Section>
      )}

      {/* Data */}
      <Section title="Your data">
        <p className="mb-3 text-xs text-faint">
          Everything is stored privately on this device. Export a backup or move
          your data to another device.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => downloadExport(tasks, completions)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium transition-colors hover:border-border-strong"
          >
            <DownloadIcon className="size-4" /> Export
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium transition-colors hover:border-border-strong"
          >
            <UploadIcon className="size-4" /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
        </div>
        {msg && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              msg.kind === 'ok'
                ? 'bg-success-soft text-success'
                : 'bg-danger/10 text-danger'
            }`}
          >
            {msg.text}
          </div>
        )}
        <div className="mt-3">
          {confirmReset ? (
            <div className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm">
              <span className="flex-1 text-danger">Delete every task and all history?</span>
              <button
                onClick={() => {
                  clearAll()
                  setConfirmReset(false)
                  setMsg({ kind: 'ok', text: 'All data erased.' })
                }}
                className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white"
              >
                Reset
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="rounded-lg px-2 py-1.5 text-xs text-muted"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="text-xs text-faint transition-colors hover:text-muted"
            >
              Erase all data…
            </button>
          )}
        </div>
      </Section>

      {/* Invites (admin only) */}
      {isAdmin && <InvitesSection />}

      {/* Account */}
      <Section title="Account">
        <div className="rounded-xl border border-border bg-surface/70 p-4">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                isSyncConfigured() ? 'bg-success' : 'bg-faint'
              }`}
            />
            <span className="text-sm font-medium">
              {isSyncConfigured()
                ? `Signed in${accountEmail ? ` as ${accountEmail}` : ''} — syncing`
                : 'Local-first (no account needed)'}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            Your tasks sync privately to your account across devices. Signing out
            clears the tasks stored on this device.
          </p>
          {isSyncConfigured() && (
            <button
              onClick={signOut}
              className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              Sign out
            </button>
          )}
        </div>
      </Section>

      <p className="mt-8 text-center text-xs text-faint">BoDay · v0.2 · made with care</p>
    </div>
  )
}

function InvitesSection() {
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () => listInvites().then(setInvites).catch(() => setInvites([]))
  useEffect(() => {
    refresh()
  }, [])

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const code = await createInvite()
      setNewCode(code)
      setCopied(false)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code.')
    }
    setBusy(false)
  }

  const copy = async () => {
    if (!newCode) return
    await navigator.clipboard.writeText(newCode)
    setCopied(true)
  }

  return (
    <Section title="Invites">
      <p className="mb-3 text-xs text-faint">
        Generate a one-time code and text it to a friend — they'll use it to sign up.
      </p>
      <button
        onClick={generate}
        disabled={busy}
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-glow disabled:opacity-60"
      >
        {busy ? 'One moment…' : 'Generate invite code'}
      </button>
      {newCode && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
          <span className="font-mono text-base font-bold tracking-widest">{newCode}</span>
          <button
            onClick={copy}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-border-strong"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {invites && invites.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {invites.map((inv) => (
            <li key={inv.code} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-muted">{inv.code}</span>
              <span className={inv.used_by_email ? 'text-faint' : 'font-medium text-success'}>
                {inv.used_by_email
                  ? `used by ${inv.used_by_email}${inv.used_at ? ` on ${new Date(inv.used_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}`
                  : 'unused'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-faint">
        {title}
      </h2>
      <div className="rounded-2xl border border-border bg-surface/40 p-4">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
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
