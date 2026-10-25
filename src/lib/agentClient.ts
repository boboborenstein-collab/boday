import {
  AgentError,
  parseEncryptResponse,
  parseErrorBody,
  parseRunResponse,
  parseTestResponse,
  type RunResponse,
  type TestResponse,
} from './agentContract'

export function agentBaseUrl(env: { VITE_AGENT_URL?: string }): string | null {
  const raw = env.VITE_AGENT_URL
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\/$/, '')
  return trimmed.length === 0 ? null : trimmed
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export function createAgentClient({
  baseUrl,
  fetchImpl,
}: {
  baseUrl: string
  fetchImpl: typeof fetch
}) {
  const root = baseUrl.replace(/\/$/, '')

  async function post(path: string, body: unknown, token: string, withTimeout: boolean): Promise<unknown> {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'omit',
      body: JSON.stringify(body),
    }
    if (withTimeout && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(130_000)
    }
    let res: Response
    try {
      res = await fetchImpl(root + path, init)
    } catch {
      throw new AgentError('NETWORK', "Couldn't reach BoDay AI.")
    }
    const data = await readJson(res)
    if (!res.ok) throw parseErrorBody(res.status, data)
    return data
  }

  return {
    run(body: unknown, token: string): Promise<RunResponse> {
      return post('/agent/run', body, token, true).then((data) => parseRunResponse(data))
    },
    encrypt(body: unknown, token: string): Promise<{ ciphertext: string }> {
      return post('/encrypt', body, token, false).then(parseEncryptResponse)
    },
    feedback(body: unknown, token: string): Promise<{ ok: boolean }> {
      return post('/feedback', body, token, false) as Promise<{ ok: boolean }>
    },
    test(body: unknown, token: string): Promise<TestResponse> {
      return post('/agent/test', body, token, false).then(parseTestResponse)
    },
  }
}
