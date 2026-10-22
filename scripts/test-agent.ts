// Assertion harness for the BoDay Agent app client. Run with: npm run test:agent
// Talks to a fake fetch only. Never opens a server.

import './agent-test-shim.ts'
import { agentBaseUrl, createAgentClient } from '../src/lib/agentClient.ts'
import { parseErrorBody, parseRunResponse } from '../src/lib/agentContract.ts'
import type { AgentError } from '../src/lib/agentContract.ts'
import { buildAgentSnapshot } from '../src/lib/agentSnapshot.ts'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// Pasted from the plan's API contract (POST /agent/run). Do not retype fields.
const contractRun = {
  "message": "move my dentist to tomorrow",
  "history": [
    {
      "role": "assistant",
      "text": "Moved dentist to Wednesday.",
      "proposal": [
        {
          "op": "update",
          "taskId": "dentist",
          "patch": {"scheduledDate": "2026-10-21"},
          "beforeFields": {"scheduledDate": "2026-10-22"},
          "warnings": []
        }
      ],
      "proposalStatus": "applied"
    }
  ],
  "snapshot": {
    "tasks": [],
    "completions": [],
    "quietWindows": [
      {
        "start": "2026-10-23T17:52:00-04:00",
        "end": "2026-10-24T18:51:00-04:00",
        "title": "Candle lighting"
      }
    ],
    "now": "2026-10-21T18:00:00Z",
    "timezone": "America/New_York"
  },
  "settings": {
    "provider": "claude",
    "model": "claude-haiku-5-5",
    "baseUrl": null,
    "keyCiphertext": "<ciphertext from POST /encrypt>"
  }
}

const contractResponse = {
  "traceId": "2b0c1c3e-7c1a-4f0e-9c2a-6e5d8a1b4c70",
  "outcome": "proposed",
  "text": "Moved dentist to Wednesday.",
  "changes": [],
  "question": null,
  "options": [],
  "parseWarnings": []
}

check('empty env has no agent url', agentBaseUrl({}) === null)
check('slash stripped', agentBaseUrl({ VITE_AGENT_URL: 'https://agent.example/' }) === 'https://agent.example')
check('blank env has no agent url', agentBaseUrl({ VITE_AGENT_URL: '   ' }) === null)
check(
  'trimmed url keeps one remaining slash',
  agentBaseUrl({ VITE_AGENT_URL: '  https://agent.example//  ' }) === 'https://agent.example/',
)

const calls: { url: string; init: RequestInit }[] = []
const fetchImpl = (async (url: string, init?: RequestInit) => {
  calls.push({ url, init: init ?? {} })
  const path = url.replace('https://agent.example', '')
  if (path === '/encrypt') return new Response(JSON.stringify({ ciphertext: 'opaque' }), { status: 200 })
  if (path === '/feedback') return new Response(JSON.stringify({ ok: true }), { status: 200 })
  if (path === '/agent/test') {
    return new Response(JSON.stringify({ ok: true, provider: 'openai_compat', model: 'local', detail: 'models endpoint returned 200' }), { status: 200 })
  }
  return new Response(JSON.stringify(contractResponse), { status: 200 })
}) as typeof fetch
const client = createAgentClient({ baseUrl: 'https://agent.example/', fetchImpl })
const res = await client.run(contractRun, 'token-1')
check('run path', calls[0].url === 'https://agent.example/agent/run')
check('bearer', (calls[0].init.headers as Record<string, string>).Authorization === 'Bearer token-1')
check('json content type', (calls[0].init.headers as Record<string, string>)['Content-Type'] === 'application/json')
check('credentials omit', calls[0].init.credentials === 'omit')
check('run timeout signal', calls[0].init.signal instanceof AbortSignal)
check('body is the contract json', JSON.parse(String(calls[0].init.body)).message === 'move my dentist to tomorrow')
check('outcome', res.outcome === 'proposed' && res.traceId === contractResponse.traceId)

await client.encrypt({ plaintext: 'sk-ant-example' }, 'token-1')
check('encrypt path', calls[1].url === 'https://agent.example/encrypt')
await client.feedback({ runId: contractResponse.traceId, event: 'approve', taskIds: ['dentist'] }, 'token-1')
check('feedback path', calls[2].url === 'https://agent.example/feedback')
await client.test({ settings: { provider: 'custom', model: 'local', baseUrl: 'https://llm.example/v1', keyCiphertext: null } }, 'token-1')
check('test path', calls[3].url === 'https://agent.example/agent/test')

const failed = parseRunResponse({ ...contractResponse, outcome: 'failed', changes: [{ op: 'delete' }] })
check('failed drops changes', failed.changes.length === 0)
const asked = parseRunResponse({ ...contractResponse, outcome: 'asked', changes: [{ op: 'delete' }] })
check('asked drops changes', asked.changes.length === 0)
const kept = parseRunResponse({
  ...contractResponse,
  changes: [{ op: 'update', taskId: 'dentist', patch: {}, beforeFields: {}, warnings: [], beforeCompletionRaw: { id: 'c1' } }],
})
check('unknown change key kept', kept.changes[0].beforeCompletionRaw.id === 'c1')

const denied = parseErrorBody(403, { error: { code: 'MODEL_NOT_CONFIGURED', message: 'Connect a model to enable BoDay AI.' } })
check('error message', denied.code === 'MODEL_NOT_CONFIGURED' && denied.message === 'Connect a model to enable BoDay AI.')

let missing: AgentError | null = null
try {
  parseRunResponse({})
} catch (e) {
  missing = e as AgentError
}
check('missing run keys throw', missing?.code === 'HTTP' && missing.message === "Couldn't reach BoDay AI.")

const plain = createAgentClient({
  baseUrl: 'https://agent.example',
  fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
})
let plainErr: AgentError | null = null
try {
  await plain.run(contractRun, 'token-1')
} catch (e) {
  plainErr = e as AgentError
}
check('plain 500', plainErr?.code === 'HTTP' && plainErr.message === "Couldn't reach BoDay AI.")

const offline = createAgentClient({
  baseUrl: 'https://agent.example',
  fetchImpl: (async () => {
    throw new Error('offline')
  }) as typeof fetch,
})
let netErr: AgentError | null = null
try {
  await offline.run(contractRun, 'token-1')
} catch (e) {
  netErr = e as AgentError
}
check('network error', netErr?.code === 'NETWORK' && netErr.message === "Couldn't reach BoDay AI.")

const task = { id: 'dentist', type: 'one_time', title: 'Dentist', someFutureField: { x: 1 } }
const snapTasks = [task]
const snapCompletions: never[] = []
const snapWindows = [{ start: '2026-10-23T17:52:00-04:00', end: '2026-10-24T18:51:00-04:00', title: 'Candle lighting' }]
const snap = buildAgentSnapshot({
  tasks: snapTasks,
  completions: snapCompletions,
  quietWindows: snapWindows,
  now: new Date('2026-10-21T22:00:00.000Z'),
  timeZone: 'America/New_York',
})
check('snapshot keys', Object.keys(snap).sort().join() === 'completions,now,quietWindows,tasks,timezone')
check('now is iso', snap.now === '2026-10-21T22:00:00.000Z')
check('timezone kept', snap.timezone === 'America/New_York')
check('future field kept', snap.tasks[0].someFutureField.x === 1)
check('same task array', snap.tasks === snapTasks)
check('same completion array', snap.completions === snapCompletions)
check('same quiet windows', snap.quietWindows === snapWindows)
check('no secrets', JSON.stringify(snap).includes('sk-') === false)

console.log('')
if (failures === 0) {
  console.log('✅ ALL AGENT ASSERTIONS PASSED\n')
  process.exit(0)
} else {
  console.log(`❌ ${failures} assertion(s) FAILED\n`)
  process.exit(1)
}
