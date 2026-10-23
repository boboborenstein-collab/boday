import { ADMIN_EMAIL } from './invites'
import { AgentError } from './agentContract'
import type { AgentAiPrefs, PrefsWrite, UserPrefsEnvelope, UserPrefsLoad } from './userPrefs'

export type AiProvider = AgentAiPrefs['provider']

const DEFAULT_MODEL = 'claude-haiku-5-5'

export interface AiSettingsForm {
  provider: AiProvider
  model: string | null
  baseUrl: string
  plaintext: string
  ciphertextFromEncrypt: string | null
}

export interface SettingsView {
  showAuto: boolean
  provider: AiProvider
  hasKey: boolean
  model: string
  baseUrl: string
}

function ownerEmail(email: string | null | undefined): boolean {
  return email === ADMIN_EMAIL
}

function providerAllowed(email: string | null | undefined, provider: string | null | undefined): provider is AiProvider {
  if (provider === 'claude' || provider === 'custom') return true
  return provider === 'auto' && ownerEmail(email)
}

export function settingsViewModel({
  email,
  prefs,
  formProvider,
}: {
  email: string | null
  prefs: AgentAiPrefs | null
  formProvider?: AiProvider
}): SettingsView {
  const showAuto = ownerEmail(email)
  const provider = prefs && providerAllowed(email, prefs.provider) ? prefs.provider : showAuto ? 'auto' : 'claude'
  const switched = formProvider !== undefined && formProvider !== prefs?.provider
  return {
    showAuto,
    provider,
    hasKey: !switched && Boolean(prefs?.keyCiphertext),
    model: prefs?.model || DEFAULT_MODEL,
    baseUrl: prefs?.baseUrl || '',
  }
}

export function hasUsableModel(email: string | null, prefs: AgentAiPrefs | null): boolean {
  if (ownerEmail(email) && (prefs === null || prefs.provider === 'auto')) return true
  if (!prefs || prefs.provider === 'auto') return false
  if (prefs.provider === 'claude') return Boolean(prefs.keyCiphertext)
  return Boolean(prefs.baseUrl) && Boolean(prefs.model)
}

export function keyFieldPlaceholder(hasKey: boolean): string {
  return hasKey ? 'saved ✓' : 'API key'
}

export interface AiFormState {
  provider: AiProvider
  model: string
  baseUrl: string
  password: string
}

export type AiFormAction =
  | { type: 'loaded'; view: SettingsView }
  | { type: 'provider'; provider: AiProvider }
  | { type: 'field'; field: 'model' | 'baseUrl' | 'password'; value: string }
  | { type: 'saved' }

export const initialAiForm: AiFormState = { provider: 'claude', model: DEFAULT_MODEL, baseUrl: '', password: '' }

/** Settings → AI form. A typed key belongs to the provider it was typed for: switching clears it. */
export function aiFormReduce(state: AiFormState, action: AiFormAction): AiFormState {
  if (action.type === 'loaded') {
    const { provider, model, baseUrl } = action.view
    return { provider, model, baseUrl, password: '' }
  }
  if (action.type === 'provider') {
    return action.provider === state.provider ? state : { ...state, provider: action.provider, password: '' }
  }
  if (action.type === 'field') return { ...state, [action.field]: action.value }
  return { ...state, password: '' }
}

/** The API key as pasted, without surrounding whitespace; blank means no key. */
export function typedKey(plaintext: string): string | null {
  const key = plaintext.trim()
  return key === '' ? null : key
}

export function nextAiPrefs(current: AgentAiPrefs | null, form: AiSettingsForm): AgentAiPrefs {
  let keyCiphertext: string | null = null
  if (form.provider !== 'auto') {
    if (typedKey(form.plaintext) !== null) keyCiphertext = form.ciphertextFromEncrypt
    else if (current && form.provider === current.provider) keyCiphertext = current.keyCiphertext
  }
  return {
    provider: form.provider,
    model: form.model,
    baseUrl: form.baseUrl || null,
    keyCiphertext,
  }
}

export type SettingsLoad =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'loaded'; prefs: AgentAiPrefs | null }

const LOAD_FAILED = "Couldn't load your AI settings. Try again later."

export function settingsLoadFrom(result: UserPrefsLoad): SettingsLoad {
  if (result.ok) return { status: 'loaded', prefs: result.env.ai ?? null }
  return { status: 'failed', message: result.reason === 'signed-out' ? 'Sign in required.' : LOAD_FAILED }
}

/** Save is only safe once the stored settings were read; an empty form would wipe the saved key. */
export function canSaveSettings(load: SettingsLoad): boolean {
  return load.status === 'loaded'
}

export type SaveOutcome =
  | { ok: true; prefs: AgentAiPrefs; message: string }
  | { ok: false; message: string }

/**
 * Re-read the stored settings, then write `ai`. The merge RPC replaces `ai` whole, so the
 * stored key is carried over unless a new key was typed or the provider changed.
 */
export async function saveAiSettings({
  form,
  readCurrent,
  encrypt,
  merge,
}: {
  form: Omit<AiSettingsForm, 'ciphertextFromEncrypt'>
  readCurrent: () => Promise<UserPrefsLoad>
  encrypt: (plaintext: string) => Promise<string>
  merge: (patch: Partial<UserPrefsEnvelope>) => Promise<PrefsWrite>
}): Promise<SaveOutcome> {
  try {
    const current = await readCurrent()
    if (!current.ok) {
      const failed = settingsLoadFrom(current)
      return { ok: false, message: failed.status === 'failed' ? failed.message : LOAD_FAILED }
    }
    const key = form.provider === 'auto' ? null : typedKey(form.plaintext)
    const ciphertextFromEncrypt = key === null ? null : await encrypt(key)
    const prefs = nextAiPrefs(current.env.ai ?? null, { ...form, ciphertextFromEncrypt })
    const written = await merge({ ai: prefs })
    if (!written.ok) return { ok: false, message: written.message }
    return { ok: true, prefs, message: 'Saved.' }
  } catch (error) {
    return { ok: false, message: error instanceof AgentError ? error.message : "Couldn't reach BoDay AI." }
  }
}

export function macStatus(detail: string | null): string {
  if (detail?.startsWith('auto: local reachable')) return 'Mac: reachable'
  if (detail?.startsWith('auto: local unreachable')) return 'Mac: unreachable'
  return 'Mac: not checked'
}

export interface TraceEventView {
  label: string
  detail: string
}

export interface TraceSummaryView {
  id: string
  createdAt: string
  outcome: string
  costUsd: number | null
  events: TraceEventView[]
}

export function traceSummary(row: {
  id: string
  created_at?: string | null
  data?: {
    outcome?: unknown
    totals?: { cost_usd?: unknown } | null
    events?: unknown[] | null
  } | null
}): TraceSummaryView {
  const data = row.data ?? {}
  const events: TraceEventView[] = []
  for (const event of data.events ?? []) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    if (rec.type === 'model_call') {
      events.push({
        label: 'model',
        detail: `${typeof rec.model === 'string' ? rec.model : ''} · ${typeof rec.stop_reason === 'string' ? rec.stop_reason : ''}`,
      })
    } else if (rec.type === 'tool_call') {
      const failed = rec.ok === false && typeof rec.error_code === 'string'
      events.push({
        label: typeof rec.name === 'string' ? rec.name : 'tool',
        detail: failed ? rec.error_code as string : 'ok',
      })
    }
  }
  const cost = data.totals?.cost_usd
  return {
    id: row.id,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    outcome: typeof data.outcome === 'string' ? data.outcome : 'unknown',
    costUsd: typeof cost === 'number' ? cost : null,
    events,
  }
}

export function traceLoadMessage(failed: boolean): string | null {
  return failed ? "Traces aren't available yet." : null
}
