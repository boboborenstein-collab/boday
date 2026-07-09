// Gates the app behind Supabase email+password auth. Sessions persist in
// localStorage and auto-refresh, so each device signs in once. When Supabase
// isn't configured (local dev without .env), the gate is a pass-through.

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { signUpWithInvite } from '../lib/invites'

export function AuthGate({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(configured)

  useEffect(() => {
    if (!configured) return
    const supabase = getSupabase()
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [configured])

  if (!configured) return <>{children}</>
  if (loading) return <div className="grid min-h-dvh place-items-center text-sm text-muted">Loading…</div>
  if (!session) return <SignIn />
  return <>{children}</>
}

function SignIn() {
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      setError('Enter your email and a password of at least 6 characters.')
      return
    }
    if (mode === 'sign_up' && !inviteCode.trim()) {
      setError('Enter your invite code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const supabase = getSupabase()
      if (mode === 'sign_up') {
        await signUpWithInvite(email.trim(), password, inviteCode)
      }
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (err) throw new Error(err.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
    setBusy(false)
  }

  const inputCls =
    'w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent'

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold tracking-tight text-gradient">BoDay</div>
          <p className="mt-1 text-sm text-muted">
            {mode === 'sign_in'
              ? 'Welcome back — sign in to your tasks.'
              : 'Create your account — you need an invite code.'}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <input
            type="password"
            autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className={inputCls}
          />
          {mode === 'sign_up' && (
            <input
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="Invite code (e.g. BODAY-K7F3)"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className={inputCls}
            />
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={busy}
            onClick={submit}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-glow disabled:opacity-60"
          >
            {busy ? 'One moment…' : mode === 'sign_in' ? 'Sign in' : 'Sign up'}
          </motion.button>
        </div>

        <button
          onClick={() => {
            setMode((m) => (m === 'sign_in' ? 'sign_up' : 'sign_in'))
            setError(null)
          }}
          className="mt-4 w-full text-center text-xs text-faint transition-colors hover:text-muted"
        >
          {mode === 'sign_in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </motion.div>
    </div>
  )
}
