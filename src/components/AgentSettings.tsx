import { useEffect, useState } from 'react'
import { agentBaseUrl, createAgentClient } from '../lib/agentClient'
import { AgentError } from '../lib/agentContract'
import {
  keyFieldPlaceholder,
  macStatus,
  nextAiPrefs,
  onProviderPicked,
  settingsViewModel,
  type AiProvider,
} from '../lib/agentSettings'
import { mergeUserPrefsData, loadUserPrefsEnvelope } from '../lib/userPrefs'
import type { AgentAiPrefs } from '../lib/userPrefs'
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { TraceViewer } from './TraceViewer'

const inputCls =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition-colors focus:border-accent'

function serviceUrl(): string | null {
  return agentBaseUrl({ VITE_AGENT_URL: import.meta.env.VITE_AGENT_URL as string | undefined })
}

async function readAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  const { data } = await getSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

export function AgentSettings({ email }: { email: string | null }) {
  const [prefs, setPrefs] = useState<AgentAiPrefs | null>(null)
  const [provider, setProvider] = useState<AiProvider>('claude')
  const [model, setModel] = useState('claude-haiku-5-5')
  const [baseUrl, setBaseUrl] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [testDetail, setTestDetail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const env = await loadUserPrefsEnvelope()
      if (cancelled) return
      const loaded = env.ai ?? null
      const view = settingsViewModel({ email, prefs: loaded })
      setPrefs(loaded)
      setProvider(view.provider)
      setModel(view.model)
      setBaseUrl(view.baseUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [email])

  const view = settingsViewModel({ email, prefs, formProvider: provider })
  const choices: AiProvider[] = view.showAuto ? ['auto', 'claude', 'custom'] : ['claude', 'custom']

  async function clientOrStatus() {
    const base = serviceUrl()
    if (!base) {
      setStatus("BoDay AI isn't configured on this build.")
      return null
    }
    const token = await readAccessToken()
    if (!token) {
      setStatus('Sign in required.')
      return null
    }
    return { client: createAgentClient({ baseUrl: base, fetchImpl: globalThis.fetch }), token }
  }

  async function ciphertextForTest(): Promise<string | null | undefined> {
    if (!password.trim()) {
      return provider === prefs?.provider ? (prefs?.keyCiphertext ?? null) : null
    }
    const ready = await clientOrStatus()
    if (!ready) return undefined
    const encrypted = await ready.client.encrypt({ plaintext: password }, ready.token)
    return encrypted.ciphertext
  }

  async function save() {
    setStatus(null)
    try {
      let ciphertextFromEncrypt: string | null = null
      if (password.trim()) {
        const ready = await clientOrStatus()
        if (!ready) return
        const encrypted = await ready.client.encrypt({ plaintext: password }, ready.token)
        ciphertextFromEncrypt = encrypted.ciphertext
      }
      const ai = nextAiPrefs(prefs, {
        provider,
        model: model || null,
        baseUrl,
        plaintext: password,
        ciphertextFromEncrypt,
      })
      await mergeUserPrefsData({ ai })
      setPrefs(ai)
      setPassword('')
      setStatus('Saved.')
    } catch (error) {
      setStatus(error instanceof AgentError ? error.message : "Couldn't reach BoDay AI.")
    }
  }

  async function testConnection() {
    setStatus(null)
    try {
      const keyCiphertext = await ciphertextForTest()
      if (keyCiphertext === undefined) return
      const ready = await clientOrStatus()
      if (!ready) return
      const result = await ready.client.test(
        {
          settings: {
            provider,
            model: model || null,
            baseUrl: baseUrl || null,
            keyCiphertext,
          },
        },
        ready.token,
      )
      setTestDetail(result.detail)
      setStatus(result.detail)
    } catch (error) {
      setTestDetail(null)
      setStatus(error instanceof AgentError ? error.message : "Couldn't reach BoDay AI.")
    }
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-faint">AI</h2>
      <div className="space-y-3 rounded-2xl border border-border bg-surface/70 p-4">
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <label key={choice} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="agent-provider"
                checked={provider === choice}
                onChange={() => {
                  const picked = onProviderPicked(choice)
                  setProvider(picked.provider)
                  setPassword(picked.password)
                }}
              />
              {choice === 'auto' ? 'Auto' : choice === 'claude' ? 'Claude' : 'Custom'}
            </label>
          ))}
        </div>
        {provider === 'custom' && (
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://llm.example/v1"
            className={inputCls}
          />
        )}
        {provider !== 'auto' && (
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Model"
            className={inputCls}
          />
        )}
        {provider !== 'auto' && (
          <input
            type="password"
            value={password}
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
            placeholder={keyFieldPlaceholder(view.hasKey)}
            className={inputCls}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void testConnection()}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted"
          >
            Test connection
          </button>
        </div>
        {status && <p className="text-xs text-muted">{status}</p>}
        {view.showAuto && <p className="text-xs text-faint">{macStatus(testDetail)}</p>}
        <TraceViewer />
      </div>
    </section>
  )
}
