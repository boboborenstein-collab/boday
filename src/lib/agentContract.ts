export type AgentOutcome = 'proposed' | 'answered' | 'asked' | 'refused' | 'failed'

export type AgentChange = Record<string, unknown>

export interface RunResponse {
  traceId: string
  outcome: AgentOutcome
  text: string
  changes: AgentChange[]
  question: string | null
  options: string[]
  parseWarnings: string[]
}

const OUTCOMES: readonly AgentOutcome[] = ['proposed', 'answered', 'asked', 'refused', 'failed']

export class AgentError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentError'
    this.code = code
  }
}

const UNREACHABLE = "Couldn't reach BoDay AI."

export function parseErrorBody(status: number, data: unknown): AgentError {
  void status
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: unknown }).error
    if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
      const code = (err as { code: unknown }).code
      const message = (err as { message: unknown }).message
      if (typeof code === 'string' && typeof message === 'string') {
        return new AgentError(code, message)
      }
    }
  }
  return new AgentError('HTTP', UNREACHABLE)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function parseRunResponse(data: unknown): RunResponse {
  if (!data || typeof data !== 'object') throw new AgentError('HTTP', UNREACHABLE)
  const row = data as Record<string, unknown>
  const outcome = row.outcome
  if (typeof row.traceId !== 'string') throw new AgentError('HTTP', UNREACHABLE)
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as AgentOutcome)) {
    throw new AgentError('HTTP', UNREACHABLE)
  }
  if (typeof row.text !== 'string') throw new AgentError('HTTP', UNREACHABLE)
  if (!Array.isArray(row.changes)) throw new AgentError('HTTP', UNREACHABLE)
  if (!(typeof row.question === 'string' || row.question === null)) {
    throw new AgentError('HTTP', UNREACHABLE)
  }
  if (!isStringArray(row.options)) throw new AgentError('HTTP', UNREACHABLE)
  if (!isStringArray(row.parseWarnings)) throw new AgentError('HTTP', UNREACHABLE)

  const parsedOutcome = outcome as AgentOutcome
  const changes =
    parsedOutcome === 'failed' || parsedOutcome === 'asked' ? [] : (row.changes as AgentChange[])

  return {
    traceId: row.traceId,
    outcome: parsedOutcome,
    text: row.text,
    changes,
    question: row.question,
    options: row.options,
    parseWarnings: row.parseWarnings,
  }
}

export interface TestResponse {
  ok: boolean
  provider: string
  model: string
  detail: string
}

export function parseEncryptResponse(data: unknown): { ciphertext: string } {
  const ciphertext = (data as { ciphertext?: unknown } | null)?.ciphertext
  if (typeof ciphertext !== 'string' || ciphertext === '') throw new AgentError('HTTP', UNREACHABLE)
  return { ciphertext }
}

export function parseTestResponse(data: unknown): TestResponse {
  const row = (data ?? {}) as Partial<Record<keyof TestResponse, unknown>>
  if (typeof row.ok !== 'boolean' || typeof row.detail !== 'string') throw new AgentError('HTTP', UNREACHABLE)
  return {
    ok: row.ok,
    provider: typeof row.provider === 'string' ? row.provider : '',
    model: typeof row.model === 'string' ? row.model : '',
    detail: row.detail,
  }
}
