import { useEffect, useReducer, useState } from 'react'
import { agentBaseUrl, createAgentClient } from '../lib/agentClient'
import { AgentError } from '../lib/agentContract'
import {
  aiFormReduce,
  canSaveSettings,
  initialAiForm,
  keyFieldPlaceholder,
  macStatus,
  saveAiSettings,
  settingsLoadFrom,
  settingsViewModel,
  typedKey,
  type AiProvider,
  type SettingsLoad,
} from '../lib/agentSettings'
import { mergeUserPrefsData, loadUserPrefsResult } from '../lib/userPrefs'
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
  const [load, setLoad] = useState<SettingsLoad>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [form, dispatch] = useReducer(aiFormReduce, initialAiForm)
  const { provider, model, baseUrl, password } = form
  const [status, setStatus] = useState<string | null>(null)
  const [testDetail, setTestDetail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next = settingsLoadFrom(await loadUserPrefsResult())
      if (cancelled) return
      setLoad(next)
      if (next.status !== 'loaded') return
      dispatch({ type: 'loaded', view: settingsViewModel({ email, prefs: next.prefs }) })
    })()
    return () => {
      cancelled = true
    }
  }, [email])

  const prefs = load.status === 'loaded' ? load.prefs : null
  const view = settingsViewModel({ email, prefs, formProvider: provider })
  const choices: AiProvider[] = view.showAuto ? ['auto', 'claude', 'custom'] : ['claude', 'custom']

  /** The service client, or an AgentError whose message the status line can show. */
  async function serviceClient() {
    const base = serviceUrl()
    if (!base) throw new AgentError('NOT_CONFIGURED', "BoDay AI isn't configured on this build.")
    const token = await readAccessToken()
    if (!token) throw new AgentError('UNAUTHORIZED', 'Sign in required.')
    return { client: createAgentClient({ baseUrl: base, fetchImpl: globalThis.fetch }), token }
  }

  async function ciphertextForTest(): Promise<string | null> {
    const key = typedKey(password)
    if (key === null) {
      return provider === prefs?.provider ? (prefs?.keyCiphertext ?? null) : null
    }
    const ready = await serviceClient()
    const encrypted = await ready.client.encrypt({ plaintext: key }, ready.token)
    return encrypted.ciphertext
  }

  async function save() {
    if (!canSaveSettings(load) || saving) return
    setStatus(null)
    setSaving(true)
    const outcome = await saveAiSettings({
      form: { provider, model: model || null, baseUrl, plaintext: password },
      readCurrent: () => loadUserPrefsResult(),
      encrypt: async (plaintext) => {
        const ready = await serviceClient()
        return (await ready.client.encrypt({ plaintext }, ready.token)).ciphertext
      },
      merge: (patch) => mergeUserPrefsData(patch),
    })
    setSaving(false)
    setStatus(outcome.message)
    if (!outcome.ok) return
    setLoad({ status: 'loaded', prefs: outcome.prefs })
    dispatch({ type: 'saved' })
  }

  async function testConnection() {
    setStatus(null)
    try {
      const keyCiphertext = await ciphertextForTest()
      const ready = await serviceClient()
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
                onChange={() => dispatch({ type: 'provider', provider: choice })}
              />
              {choice === 'auto' ? 'Auto' : choice === 'claude' ? 'Claude' : 'Custom'}
            </label>
          ))}
        </div>
        {provider === 'custom' && (
          <input
            value={baseUrl}
            onChange={(event) => dispatch({ type: 'field', field: 'baseUrl', value: event.target.value })}
            placeholder="https://llm.example/v1"
            className={inputCls}
          />
        )}
        {provider !== 'auto' && (
          <input
            value={model}
            onChange={(event) => dispatch({ type: 'field', field: 'model', value: event.target.value })}
            placeholder="Model"
            className={inputCls}
          />
        )}
        {provider !== 'auto' && (
          <input
            type="password"
            name="ai-api-key"
            value={password}
            autoComplete="new-password"
            onChange={(event) => dispatch({ type: 'field', field: 'password', value: event.target.value })}
            placeholder={keyFieldPlaceholder(view.hasKey)}
            className={inputCls}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSaveSettings(load) || saving}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-40"
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
        {load.status === 'failed' && <p className="text-xs text-danger">{load.message}</p>}
        {status && <p className="text-xs text-muted">{status}</p>}
        {view.showAuto && <p className="text-xs text-faint">{macStatus(testDetail)}</p>}
        <TraceViewer />
      </div>
    </section>
  )
}
