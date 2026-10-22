import { ADMIN_EMAIL } from './invites'
import type { AgentAiPrefs } from './userPrefs'

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

export function nextAiPrefs(current: AgentAiPrefs | null, form: AiSettingsForm): AgentAiPrefs {
  let keyCiphertext: string | null = null
  if (form.provider !== 'auto') {
    if (form.plaintext.trim() !== '') keyCiphertext = form.ciphertextFromEncrypt
    else if (current && form.provider === current.provider) keyCiphertext = current.keyCiphertext
  }
  return {
    provider: form.provider,
    model: form.model,
    baseUrl: form.baseUrl || null,
    keyCiphertext,
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
