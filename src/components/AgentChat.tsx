import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../store/useStore'
import { ADMIN_EMAIL } from '../lib/invites'
import { agentBaseUrl, createAgentClient } from '../lib/agentClient'
import { AgentError } from '../lib/agentContract'
import { buildAgentSnapshot } from '../lib/agentSnapshot'
import {
  approveMessage,
  cardUndo,
  rejectMessage,
  type AgentActionDeps,
} from '../lib/agentActions'
import {
  acceptModelReply,
  canSend,
  chatOnOpen,
  loadChat,
  loadPanel,
  panelMessage,
  reduce,
  saveChat,
  toHistory,
  type ChatEvent,
  type ChatState,
} from '../lib/agentChat'
import { hasUsableModel } from '../lib/agentSettings'
import { loadUserPrefsEnvelope } from '../lib/userPrefs'
import type { AgentAiPrefs } from '../lib/userPrefs'
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { AgentDiffCard } from './AgentDiffCard'
import { randomId } from '../lib/randomId'

const EMPTY: ChatState = { messages: [], sending: false }

function serviceUrl(): string | null {
  return agentBaseUrl({ VITE_AGENT_URL: import.meta.env.VITE_AGENT_URL as string | undefined })
}

async function readAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  const { data } = await getSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

export function AgentChat() {
  const open = useStore((s) => s.agentOpen)
  const seed = useStore((s) => s.agentSeed)
  const closeAgent = useStore((s) => s.closeAgent)
  const tasks = useStore((s) => s.tasks)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [loading, setLoading] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<AgentAiPrefs | null>(null)
  const [windows, setWindows] = useState<{ start: string; end: string; title: string }[]>([])
  const [chat, setChat] = useState<ChatState>(EMPTY)
  const [draft, setDraft] = useState('')
  const chatRef = useRef(chat)
  const loadedFor = useRef<string | null>(null)
  const generation = useRef(0)
  const userIdRef = useRef(userId)
  const prefsRef = useRef(prefs)
  const windowsRef = useRef(windows)
  const emailRef = useRef(email)
  chatRef.current = chat
  userIdRef.current = userId
  prefsRef.current = prefs
  windowsRef.current = windows
  emailRef.current = email

  const serviceConfigured = serviceUrl() !== null
  const hasModel = hasUsableModel(email, prefs)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    if (open && seed) setDraft(seed)
  }, [open, seed])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const seenGeneration = generation.current
    setLoading(true)
    ;(async () => {
      const result = await loadPanel({
        getSessionUser: async () => {
          if (!isSupabaseConfigured()) return null
          const { data } = await getSupabase().auth.getSession()
          const user = data.session?.user
          return user ? { id: user.id, email: user.email ?? null } : null
        },
        loadEnv: loadUserPrefsEnvelope,
        isCancelled: () => cancelled,
        generationChanged: () => generation.current !== seenGeneration,
      })
      if (!result) return
      const { account } = result
      setSignedIn(account.signedIn)
      setEmail(account.email)
      setUserId(account.userId)
      setPrefs(account.prefs)
      setWindows(account.windows)
      if (result.restoreChat) {
        const stored = account.userId ? loadChat(localStorage, account.userId) : EMPTY
        const loaded = chatOnOpen(chatRef.current, stored, loadedFor.current, account.userId)
        chatRef.current = loaded
        setChat(loaded)
      }
      loadedFor.current = account.userId
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  function dispatch(event: ChatEvent) {
    const next = reduce(chatRef.current, event)
    chatRef.current = next
    setChat(next)
    const id = userIdRef.current
    if (id) saveChat(localStorage, id, next)
    return next
  }

  function deps(): AgentActionDeps {
    const opts = { nowIso: new Date().toISOString(), newId: () => randomId() }
    return {
      apply: (changes, ids) =>
        useStore.getState().applyAgentProposal(changes as Record<string, unknown>[], ids, opts),
      undo: (changes, ids) =>
        useStore.getState().undoAgentProposal(changes as Record<string, unknown>[], ids, opts),
      feedback: async (body) => {
        const base = serviceUrl()
        if (!base) return
        const token = await readAccessToken()
        if (!token) return
        const client = createAgentClient({ baseUrl: base, fetchImpl: globalThis.fetch })
        return client.feedback(body, token)
      },
      dispatch,
      toast: (detail) => window.dispatchEvent(new CustomEvent('boday-toast', { detail })),
      current: (messageId) => chatRef.current.messages.find((message) => message.id === messageId),
    }
  }

  async function submit(text: string) {
    const modelReady = hasUsableModel(emailRef.current, prefsRef.current)
    const gates = {
      online,
      serviceConfigured,
      hasModel: modelReady,
      sending: chatRef.current.sending,
      text,
    }
    if (!canSend(gates)) return
    if (panelMessage({ online, serviceConfigured, signedIn, hasModel: modelReady })) return
    const sentGeneration = generation.current
    dispatch({ type: 'send', id: randomId(), text: text.trim() })
    const base = serviceUrl()
    if (!base) return
    const client = createAgentClient({ baseUrl: base, fetchImpl: globalThis.fetch })
    try {
      const token = await readAccessToken()
      if (!acceptModelReply(generation.current, sentGeneration)) return
      if (!token) {
        dispatch({ type: 'fail', id: randomId(), text: 'Sign in required.' })
        return
      }
      const ai = prefsRef.current ?? {
        provider: emailRef.current === ADMIN_EMAIL ? ('auto' as const) : ('claude' as const),
        model: null,
        baseUrl: null,
        keyCiphertext: null,
      }
      const response = await client.run(
        {
          message: text.trim(),
          history: toHistory(chatRef.current.messages),
          snapshot: buildAgentSnapshot({
            tasks: useStore.getState().tasks,
            completions: useStore.getState().completions,
            quietWindows: windowsRef.current,
            now: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          settings: ai,
        },
        token,
      )
      if (!acceptModelReply(generation.current, sentGeneration)) return
      dispatch({ type: 'assistant', id: randomId(), response })
    } catch (error) {
      if (!acceptModelReply(generation.current, sentGeneration)) return
      const textOut = error instanceof AgentError ? error.message : "Couldn't reach BoDay AI."
      dispatch({ type: 'fail', id: randomId(), text: textOut })
    }
  }

  const gate = panelMessage({ online, serviceConfigured, signedIn, hasModel })
  const composerOff = loading || Boolean(gate) || !canSend({
    online,
    serviceConfigured,
    hasModel,
    sending: chat.sending,
    text: draft,
  })

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close BoDay Agent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeAgent}
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
          />
          <motion.aside
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-bg-elev shadow-lg md:inset-y-0 md:right-0 md:left-auto md:top-0 md:h-dvh md:w-[400px] md:max-h-none md:rounded-none"
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">BoDay Agent</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    generation.current += 1
                    dispatch({ type: 'new' })
                    setDraft('')
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted"
                >
                  New chat
                </button>
                <button type="button" onClick={closeAgent} className="text-xs text-faint">
                  Close
                </button>
              </div>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {loading && <p className="text-sm text-muted">Loading…</p>}
              {!loading && gate && <p className="text-sm text-muted">{gate}</p>}
              {!loading && chat.messages.length === 0 && !chat.sending && (
                <p className="text-sm text-faint">Ask about your tasks.</p>
              )}
              {chat.messages.map((message) => (
                <div key={message.id} className={message.role === 'user' ? 'text-right' : ''}>
                  <p className="inline-block max-w-full whitespace-pre-wrap rounded-2xl bg-surface px-3 py-2 text-left text-sm text-text">
                    {message.text}
                  </p>
                  {message.outcome === 'proposed' && (
                    <AgentDiffCard
                      message={message}
                      tasks={tasks}
                      onToggle={(taskId) => dispatch({ type: 'toggle', messageId: message.id, taskId })}
                      onApprove={() => approveMessage(deps(), message)}
                      onReject={() => rejectMessage(deps(), message)}
                      onUndo={() => cardUndo(deps(), message)}
                    />
                  )}
                  {message.outcome === 'asked' &&
                    message.options?.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => void submit(option)}
                        className="mr-2 mt-2 rounded-full border border-border px-3 py-1 text-xs text-muted"
                      >
                        {option}
                      </button>
                    ))}
                  {(message.outcome === 'refused' || message.outcome === 'failed') && message.traceId && (
                    <p className="mt-1 text-[11px] text-faint">Trace {message.traceId}</p>
                  )}
                  {message.parseWarnings && message.parseWarnings.length > 0 && (
                    <p className="mt-1 text-[11px] text-warning">
                      {message.parseWarnings.length} task(s) could not be read and were left unchanged.
                    </p>
                  )}
                </div>
              ))}
              {chat.sending && <p className="text-sm text-muted">Thinking…</p>}
            </div>
            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={(event) => {
                event.preventDefault()
                void submit(draft)
                if (canSend({ online, serviceConfigured, hasModel, sending: chat.sending, text: draft }) && !gate && !loading) {
                  setDraft('')
                }
              }}
            >
              <input
                value={draft}
                disabled={loading || Boolean(gate)}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={loading ? 'Loading…' : 'Ask about your tasks'}
                className="flex-1 rounded-full border border-border bg-surface px-3 py-2 text-sm outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={composerOff}
                className="rounded-full bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
