// Assertion harness for the BoDay Agent app client. Run with: npm run test:agent
// Talks to a fake fetch only. Never opens a server.

import './agent-test-shim.ts'
import { agentBaseUrl, createAgentClient } from '../src/lib/agentClient.ts'
import { parseErrorBody, parseRunResponse } from '../src/lib/agentContract.ts'
import type { AgentError } from '../src/lib/agentContract.ts'
import { buildAgentSnapshot } from '../src/lib/agentSnapshot.ts'
import {
  applyProposal,
  fieldValue,
  sameValue,
  undoProposal,
  withRecurringStatus,
} from '../src/lib/agentApply.ts'
import { useStore } from '../src/store/useStore.ts'
import { readFileSync } from 'node:fs'
import {
  agentEntry,
  agentPaletteItem,
  canSend,
  chatKey,
  diffModel,
  loadChat,
  normalizeToast,
  panelMessage,
  reduce,
  saveChat,
  toHistory,
  chatOnOpen,
  acceptModelReply,
} from '../src/lib/agentChat.ts'
import { approveMessage, rejectMessage, undoMessage } from '../src/lib/agentActions.ts'
import * as chatLib from '../src/lib/agentChat.ts'
import {
  hasUsableModel,
  keyFieldPlaceholder,
  macStatus,
  nextAiPrefs,
  settingsViewModel,
  traceLoadMessage,
  traceSummary,
  onProviderPicked,
} from '../src/lib/agentSettings.ts'
import * as settingsLib from '../src/lib/agentSettings.ts'
import * as prefsLib from '../src/lib/userPrefs.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentSettings } from '../src/components/AgentSettings.tsx'

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

const OPTS = { nowIso: '2026-10-21T18:00:00.000Z', newId: () => 'new-id' }
const STALE = 'This proposal is out of date. Nothing was applied.'
const CANT = "This proposal can't be applied. Nothing was applied."

check('object key order', sameValue({ b: 1, a: { d: 2, c: 3 } }, { a: { c: 3, d: 2 }, b: 1 }))
check('missing matches null', fieldValue({}, 'endDate') === null && sameValue(fieldValue({}, 'endDate'), null))
check('present does not match null', sameValue(fieldValue({ endDate: '2026-12-31' }, 'endDate'), null) === false)

const dentist = {
  id: 'dentist', type: 'one_time', title: 'Dentist', priority: 2,
  scheduledDate: '2026-10-22', completed: false, createdAt: '2026-09-01T12:00:00Z',
  someFutureField: { x: 1 },
}
const update = {
  op: 'update', taskId: 'dentist',
  patch: { scheduledDate: '2026-10-21' },
  beforeFields: { scheduledDate: '2026-10-22' },
  warnings: [],
}
const state = { tasks: [dentist], completions: [] as Record<string, unknown>[] }
const applied = applyProposal(state, [update], ['dentist'], OPTS)
check('future field after apply', applied.ok && applied.tasks[0].someFutureField.x === 1)
check('date patched', applied.ok && applied.tasks[0].scheduledDate === '2026-10-21')
check('apply leaves the input task', dentist.scheduledDate === '2026-10-22')
const undone = undoProposal(
  { tasks: applied.tasks, completions: applied.completions }, [update], ['dentist'], OPTS,
)
check('future field after undo', undone.ok && undone.tasks[0].someFutureField.x === 1)
check('date restored', undone.ok && undone.tasks[0].scheduledDate === '2026-10-22')

const fresh = { ...update, taskId: 'other', patch: { priority: 1 }, beforeFields: { priority: 3 } }
const other = { id: 'other', type: 'one_time', title: 'Other', priority: 3, scheduledDate: '2026-10-20', completed: false, createdAt: '2026-09-01T12:00:00Z' }
const staleBatchTasks = [dentist, other]
const stale = applyProposal(
  { tasks: staleBatchTasks, completions: [] },
  [update, { ...fresh, beforeFields: { priority: 9 } }],
  ['dentist', 'other'],
  OPTS,
)
check('one stale blocks the batch', stale.ok === false && stale.message === STALE)
check('stale batch writes nothing', dentist.scheduledDate === '2026-10-22' && other.priority === 3)

const partial = applyProposal(
  { tasks: [dentist, other], completions: [] },
  [update, fresh],
  ['dentist'],
  OPTS,
)
check('unchecked task untouched', partial.ok && partial.tasks.find((t) => t.id === 'other').priority === 3)
check('unchecked update keeps future field', partial.ok && partial.tasks.find((t) => t.id === 'dentist').someFutureField.x === 1)

const gym = { id: 'gym', type: 'recurring', title: 'Gym', someFutureField: { x: 1 } }
const c1 = { id: 'c1', taskId: 'gym', completionDate: '2026-10-19', completedAt: '2026-10-19T11:00:00Z', extra: true }
const c2 = { id: 'c2', taskId: 'gym', completionDate: '2026-10-17', completedAt: '2026-10-17T11:00:00Z' }
const del = {
  op: 'delete', taskId: 'gym', reason: 'user asked',
  beforeRaw: gym, beforeCompletionsRaw: [c1], warnings: [],
}
const deleted = applyProposal({ tasks: [gym], completions: [c1, c2] }, [del], ['gym'], OPTS)
check('only listed completion removed', deleted.ok && deleted.completions.map((c) => c.id).join() === 'c2')
check('task removed', deleted.ok && deleted.tasks.length === 0)
const restored = undoProposal({ tasks: deleted.tasks, completions: deleted.completions }, [del], ['gym'], OPTS)
check('raw restored', restored.ok && restored.tasks[0].someFutureField.x === 1 && restored.completions.find((c) => c.id === 'c1').extra === true)
check('restored completion matches raw', restored.ok && JSON.stringify(restored.completions.find((c) => c.id === 'c1')) === JSON.stringify(c1))

const nullEnd = {
  op: 'update', taskId: 'dentist',
  patch: { endDate: '2026-11-01' },
  beforeFields: { endDate: null },
  warnings: [],
}
const appliedNull = applyProposal({ tasks: [dentist], completions: [] }, [nullEnd], ['dentist'], OPTS)
check('missing endDate matches null', appliedNull.ok && appliedNull.tasks[0].endDate === '2026-11-01')
const undoneNull = undoProposal({ tasks: appliedNull.tasks, completions: appliedNull.completions }, [nullEnd], ['dentist'], OPTS)
check('undo writes null endDate', undoneNull.ok && undoneNull.tasks[0].endDate === null && undoneNull.tasks[0].someFutureField.x === 1)
const dated = { ...dentist, endDate: '2026-12-31' }
const staleEnd = applyProposal({ tasks: [dated], completions: [] }, [nullEnd], ['dentist'], OPTS)
check('real endDate does not match null', staleEnd.ok === false && staleEnd.message === STALE && dated.endDate === '2026-12-31')

let newIdCalls = 0
const counting = {
  nowIso: '2026-10-21T18:00:00.000Z',
  newId: () => {
    newIdCalls += 1
    return 'row-1'
  },
}
const doneOnce = withRecurringStatus([], 'gym', '2026-10-23', 'done', counting)
const doneTwice = withRecurringStatus(doneOnce, 'gym', '2026-10-23', 'done', counting)
check(
  'second done keeps the row',
  newIdCalls === 1 && doneTwice.length === 1 && doneTwice[0].id === 'row-1' && doneTwice[0].completedAt === doneOnce[0].completedAt && doneTwice[0].completedAt === OPTS.nowIso,
)

const skip = {
  op: 'set_status', taskId: 'gym', date: '2026-10-23',
  before: { status: 'open' }, after: { status: 'skipped' },
  beforeCompletionRaw: null, warnings: [],
}
const skipped = applyProposal({ tasks: [gym], completions: [] }, [skip], ['gym'], OPTS)
check(
  'open to skipped adds one row',
  skipped.ok && skipped.completions.length === 1 && skipped.completions[0].skipped === true && skipped.completions[0].completionDate === '2026-10-23',
)
const unskipped = undoProposal({ tasks: skipped.tasks, completions: skipped.completions }, [skip], ['gym'], OPTS)
check('undo skip removes the row', unskipped.ok && unskipped.completions.length === 0)

let undoNewIds = 0
const noMint = {
  nowIso: OPTS.nowIso,
  newId: () => {
    undoNewIds += 1
    return 'minted'
  },
}
const undoneRec = {
  op: 'set_status', taskId: 'gym', date: '2026-10-19',
  before: { status: 'done' }, after: { status: 'open' },
  beforeCompletionRaw: c1, warnings: [],
}
const removed = applyProposal({ tasks: [gym], completions: [c1] }, [undoneRec], ['gym'], noMint)
check('recurring undone removes c1', removed.ok && removed.completions.length === 0 && undoNewIds === 0)
const putBack = undoProposal({ tasks: removed.tasks, completions: removed.completions }, [undoneRec], ['gym'], noMint)
const putRow = putBack.ok ? putBack.completions.find((c) => c.id === 'c1') : undefined
check('undo puts c1 back', putBack.ok && JSON.stringify(putRow) === JSON.stringify(c1) && undoNewIds === 0)

const nullRaw = { ...undoneRec, beforeCompletionRaw: null }
const nullRawState = { tasks: [gym], completions: [c1, c2] }
const nullRawApply = applyProposal(nullRawState, [nullRaw], ['gym'], OPTS)
check('null completion raw is rejected', nullRawApply.ok === false && nullRawApply.message === CANT)
check('null completion raw writes nothing', nullRawState.completions.map((c) => c.id).join() === 'c1,c2' && nullRawState.tasks.length === 1)

const c3 = { id: 'c3', taskId: 'gym', completionDate: '2026-10-19', completedAt: '2026-10-19T12:00:00Z', extra: 'keep' }
const toSkip = {
  op: 'set_status', taskId: 'gym', date: '2026-10-19',
  before: { status: 'done' }, after: { status: 'skipped' },
  beforeCompletionRaw: c1, warnings: [],
}
const marked = applyProposal({ tasks: [gym], completions: [c1, c3] }, [toSkip], ['gym'], OPTS)
const markedC1 = marked.ok ? marked.completions.find((c) => c.id === 'c1') : undefined
const markedC3 = marked.ok ? marked.completions.find((c) => c.id === 'c3') : undefined
check(
  'done to skipped touches only c1',
  marked.ok && markedC1?.skipped === true && markedC1.id === 'c1' && markedC1.completedAt === '2026-10-19T11:00:00Z' && markedC3?.extra === 'keep' && markedC3.skipped !== true,
)
const unmarked = undoProposal({ tasks: marked.tasks, completions: marked.completions }, [toSkip], ['gym'], OPTS)
const unmarkedC1 = unmarked.ok ? unmarked.completions.find((c) => c.id === 'c1') : undefined
check('undo done-to-skipped restores c1', unmarked.ok && JSON.stringify(unmarkedC1) === JSON.stringify(c1) && unmarkedC1 !== undefined && !('skipped' in unmarkedC1))

const doneDentist = { ...dentist, completed: true, completedAt: '2026-10-20T15:00:00Z' }
const oneUndo = {
  op: 'set_status', taskId: 'dentist', date: null,
  before: { status: 'done' }, after: { status: 'open' },
  beforeCompletionRaw: { completedAt: '2026-10-20T15:00:00Z' },
  warnings: [],
}
const opened = applyProposal({ tasks: [doneDentist], completions: [] }, [oneUndo], ['dentist'], OPTS)
check('one-time undone clears completedAt', opened.ok && opened.tasks[0].completed === false && opened.tasks[0].completedAt === null)
const reclosed = undoProposal({ tasks: opened.tasks, completions: opened.completions }, [oneUndo], ['dentist'], OPTS)
check(
  'one-time undo restores the old completedAt',
  reclosed.ok && reclosed.tasks[0].completed === true && reclosed.tasks[0].completedAt === '2026-10-20T15:00:00Z',
)

const bare = { ...dentist, completed: true }
delete bare.completedAt
const bareUndo = { ...oneUndo, beforeCompletionRaw: {} }
const openedBare = applyProposal({ tasks: [bare], completions: [] }, [bareUndo], ['dentist'], OPTS)
const restoredBare = undoProposal(
  { tasks: openedBare.ok ? openedBare.tasks : [], completions: openedBare.ok ? openedBare.completions : [] },
  [bareUndo],
  ['dentist'],
  OPTS,
)
check(
  'undo drops a completedAt key that was never there',
  openedBare.ok && restoredBare.ok && restoredBare.tasks[0].completed === true && !('completedAt' in restoredBare.tasks[0]),
)

const dupApply = applyProposal({ tasks: [dentist], completions: [] }, [update, { ...update }], ['dentist'], OPTS)
const dupUndo = undoProposal({ tasks: [dentist], completions: [] }, [update, { ...update }], ['dentist'], OPTS)
check('repeated task id cannot apply', dupApply.ok === false && dupApply.message === CANT && dentist.scheduledDate === '2026-10-22')
check('repeated task id cannot undo', dupUndo.ok === false && dupUndo.message === CANT)

const editedGym = { ...gym, title: 'Gym (edited)' }
const editedState = { tasks: [editedGym], completions: [c1, c2] }
const editedDel = applyProposal(editedState, [del], ['gym'], OPTS)
check('edited delete is stale', editedDel.ok === false && editedDel.message === STALE)
check('edited delete leaves completions', editedState.completions.map((c) => c.id).join() === 'c1,c2' && editedState.tasks[0].title === 'Gym (edited)')

const nullDateState = { tasks: [gym], completions: [] as typeof c1[] }
const nullDate = applyProposal(
  nullDateState,
  [{ ...skip, date: null, after: { status: 'done' } }],
  ['gym'],
  OPTS,
)
check('null date cannot apply', nullDate.ok === false && nullDate.message === CANT && nullDateState.completions.length === 0 && nullDateState.tasks.length === 1)

const createdAfter = {
  id: 'new-1', type: 'one_time', title: 'Call mom', priority: 3,
  scheduledDate: '2026-10-21', completed: false, createdAt: '2026-10-21T18:00:00Z',
}
let createMints = 0
const createOpts = {
  nowIso: OPTS.nowIso,
  newId: () => {
    createMints += 1
    return 'store-minted'
  },
}
const create = { op: 'create', taskId: 'new-1', after: createdAfter, warnings: [] }
const created = applyProposal({ tasks: [], completions: [] }, [create], ['new-1'], createOpts)
check('create keeps after.id', created.ok && created.tasks[0].id === 'new-1' && created.tasks[0].title === 'Call mom' && createMints === 0)
const uncreated = undoProposal({ tasks: created.tasks, completions: created.completions }, [create], ['new-1'], createOpts)
check('undo create removes the task', uncreated.ok && uncreated.tasks.length === 0 && createMints === 0)

useStore.setState({ tasks: [gym], completions: [c1, c2] })
const storeDeleted = useStore.getState().applyAgentProposal([del], ['gym'], OPTS)
check(
  'store delete keeps c2',
  storeDeleted.ok && useStore.getState().completions.map((c) => c.id).join() === 'c2',
)
useStore.getState().openAgent('hello')
const persisted = JSON.parse(localStorage.getItem('cadence-v1') ?? 'null')
check(
  'agent open is not persisted',
  persisted?.state?.agentOpen === undefined && localStorage.getItem('cadence-v1') !== null,
)
useStore.setState({
  tasks: [{
    id: 'dentist', type: 'one_time', title: 'Dentist', priority: 2,
    scheduledDate: '2026-10-22', completed: false, createdAt: '2026-09-01T12:00:00Z',
  }],
  completions: [],
})
useStore.getState().setOneTimeStatus('dentist', true)
const firstAt = useStore.getState().tasks.find((t) => t.id === 'dentist')?.completedAt
useStore.getState().setOneTimeStatus('dentist', true)
const secondAt = useStore.getState().tasks.find((t) => t.id === 'dentist')?.completedAt
check('second setOneTimeStatus keeps completedAt', typeof firstAt === 'string' && firstAt === secondAt)

let chatState: { messages: Record<string, unknown>[]; sending: boolean } = { messages: [], sending: false }
chatState = reduce(chatState, { type: 'send', id: 'u1', text: 'move dentist' })
chatState = reduce(chatState, { type: 'send', id: 'u2', text: 'again' })
check('one send at a time', chatState.messages.length === 1 && chatState.sending)
chatState = reduce(chatState, {
  type: 'assistant', id: 'a1',
  response: { ...contractResponse, outcome: 'proposed', changes: [update] },
})
check('all checked', (chatState.messages[1].selectedTaskIds as string[]).join() === 'dentist')
chatState = reduce(chatState, { type: 'toggle', messageId: 'a1', taskId: 'dentist' })
chatState = reduce(chatState, { type: 'resolve', messageId: 'a1', status: 'applied' })
check('applied keeps the change', (chatState.messages[1].changes as unknown[]).length === 1 && chatState.messages[1].proposalStatus === 'applied')
const hist = toHistory([...chatState.messages, { id: 'u3', role: 'user', text: 'undo that' }])
check('trailing user is not history', hist.length === 2 && hist[1].proposalStatus === 'applied')
const longHist = toHistory([
  { id: 'u9', role: 'user', text: 'x' },
  { id: 'a9', role: 'assistant', text: 'y'.repeat(5000), outcome: 'answered' },
  { id: 'u10', role: 'user', text: 'next' },
])
check('history text cut to 4000', longHist[1].text.length === 4000)
const failedHist = toHistory([
  { id: 'u', role: 'user', text: 'hi' },
  { id: 'a', role: 'assistant', text: 'no', outcome: 'failed', changes: [{ op: 'delete', taskId: 'x' }], proposalStatus: 'pending' },
])
check('failed history drops the proposal', failedHist[1].proposal === null && failedHist[1].proposalStatus === null)
check('palette copy', agentPaletteItem('move dentist', false, true)?.label === 'BoDay Agent: move dentist')
check('palette offline', agentPaletteItem('move dentist', false, true)?.disabled === true && agentPaletteItem('move dentist', false, true)?.hint === 'needs internet')
check('palette keeps the typed case', agentPaletteItem('Move It', true, true)?.label === 'BoDay Agent: Move It')
check('palette needs a model', agentPaletteItem('Move It', true, false)?.disabled === true && agentPaletteItem('Move It', true, false)?.hint === 'Connect a model')
check('palette can ask', agentPaletteItem('Move It', true, true)?.disabled === false && agentPaletteItem('Move It', true, true)?.hint === 'Ask')
check('empty query', agentPaletteItem('  ', true, true) === null)
check('chat key per user', chatKey('user-1') === 'boday-agent-chat-v1:user-1' && chatKey('user-1') !== chatKey('user-2'))
check('chat key is not cadence-v1', chatKey('user-1') !== 'cadence-v1')
check('offline wins the panel', panelMessage({ online: false, serviceConfigured: false, signedIn: false, hasModel: false }) === 'needs internet')
check('missing build', panelMessage({ online: true, serviceConfigured: false, signedIn: false, hasModel: false }) === "BoDay AI isn't configured on this build.")
check('sign in', panelMessage({ online: true, serviceConfigured: true, signedIn: false, hasModel: true }) === 'Sign in required.')
check('connect a model', panelMessage({ online: true, serviceConfigured: true, signedIn: true, hasModel: false }) === 'Connect a model to enable BoDay AI.')
check('panel ready', panelMessage({ online: true, serviceConfigured: true, signedIn: true, hasModel: true }) === null)
check('canSend offline', canSend({ online: false, serviceConfigured: true, hasModel: true, sending: false, text: 'hi' }) === false)
check('canSend blank', canSend({ online: true, serviceConfigured: true, hasModel: true, sending: false, text: '  ' }) === false)
check('canSend ready', canSend({ online: true, serviceConfigured: true, hasModel: true, sending: false, text: 'hi' }) === true)
check('entry offline', agentEntry({ online: false }).disabled === true && agentEntry({ online: false }).hint === 'needs internet')
check('entry online', agentEntry({ online: true }).disabled === false && agentEntry({ online: true }).hint === null)
check('toast undo lasts longer', normalizeToast({ message: 'Applied.', actionLabel: 'Undo' }).durationMs === 8000)
check('string toast unchanged', normalizeToast('Saved').durationMs === 5000 && normalizeToast('Saved').actionLabel === null)

const cadenceBefore = localStorage.getItem('cadence-v1')
const storedChat = reduce({ messages: [], sending: false }, { type: 'send', id: 's1', text: 'hello' })
saveChat(localStorage, 'user-1', { ...storedChat, sending: false })
check('chat round trip', loadChat(localStorage, 'user-1').messages.length === 1 && loadChat(localStorage, 'user-1').messages[0].text === 'hello')
check('other user chat is empty', loadChat(localStorage, 'user-2').messages.length === 0)
check('chat save leaves cadence-v1', localStorage.getItem('cadence-v1') === cadenceBefore)
localStorage.setItem(chatKey('user-1'), '{')
check('corrupt chat is empty', loadChat(localStorage, 'user-1').messages.length === 0 && loadChat(localStorage, 'user-1').sending === false)
saveChat(localStorage, 'user-1', storedChat)
const cleared = reduce(loadChat(localStorage, 'user-1'), { type: 'new' })
saveChat(localStorage, 'user-1', cleared)
check('new chat removes the key', localStorage.getItem('boday-agent-chat-v1:user-1') === null)

const log: string[] = []
let flow: { messages: Record<string, unknown>[]; sending: boolean } = { messages: [], sending: false }
const deps = {
  apply: () => ({ ok: true as const, tasks: [], completions: [] }),
  undo: () => ({ ok: true as const, tasks: [], completions: [] }),
  feedback: (body: { event: string }) => { log.push(`feedback:${body.event}`); return Promise.reject(new Error('offline')) },
  dispatch: (e: { type: string }) => { flow = reduce(flow, e) },
  toast: (d: string | { message: string }) => log.push(`toast:${typeof d === 'string' ? d : d.message}`),
  current: (id: string) => flow.messages.find((m) => m.id === id) as never,
}
flow = reduce(flow, { type: 'send', id: 'u1', text: 'move dentist' })
flow = reduce(flow, { type: 'assistant', id: 'a1', response: { ...contractResponse, outcome: 'proposed', changes: [update] } })
approveMessage(deps, flow.messages[1])
await new Promise((r) => setTimeout(r, 0))
check('applied even though feedback failed', flow.messages[1].proposalStatus === 'applied')
check('approve feedback sent', log.includes('feedback:approve') && log.includes('toast:Applied.'))
undoMessage(deps, flow.messages[1])
check('undo marks undone', flow.messages[1].proposalStatus === 'undone' && log.includes('feedback:undo'))
const beforeUndo = log.length
undoMessage(deps, flow.messages[1])
check('second undo is a no-op', log.length === beforeUndo)
const refused = { ...deps, apply: () => ({ ok: false as const, message: 'This proposal is out of date. Nothing was applied.' }) }
flow = reduce(flow, { type: 'send', id: 'u2', text: 'again' })
flow = reduce(flow, { type: 'assistant', id: 'a2', response: { ...contractResponse, outcome: 'proposed', changes: [update] } })
approveMessage(refused, flow.messages[3])
check('stale approve stays pending', flow.messages[3].proposalStatus === 'pending' && log.at(-1) === 'toast:This proposal is out of date. Nothing was applied.')
const pending = flow.messages[3]
rejectMessage(deps, pending)
check('reject leaves the task status rejected', flow.messages[3].proposalStatus === 'rejected' && log.includes('feedback:reject'))

const owner = settingsViewModel({ email: 'bobo.borenstein@gmail.com', prefs: null })
check('owner sees auto', owner.showAuto && owner.provider === 'auto')
const friend = settingsViewModel({ email: 'friend@example.com', prefs: { provider: 'auto', model: null, baseUrl: null, keyCiphertext: null } })
check('friend does not keep auto', friend.showAuto === false && friend.provider === 'claude')
check('owner can run auto without a saved key', hasUsableModel('bobo.borenstein@gmail.com', null) === true)
check('friend needs a key', hasUsableModel('friend@example.com', null) === false)
check('saved mark', keyFieldPlaceholder(true) === 'saved ✓')
check('empty key mark', keyFieldPlaceholder(false) === 'API key')
const saved = nextAiPrefs(null, {
  provider: 'claude', model: 'claude-haiku-5-5', baseUrl: '',
  plaintext: 'sk-ant-example', ciphertextFromEncrypt: 'opaque-blob',
})
check('plaintext not stored', JSON.stringify(saved).includes('sk-ant-example') === false && saved.keyCiphertext === 'opaque-blob')
const sameProvider = nextAiPrefs(saved, { provider: 'claude', model: 'claude-sonnet-5-5', baseUrl: '', plaintext: '', ciphertextFromEncrypt: null })
check('same provider keeps the key', sameProvider.keyCiphertext === 'opaque-blob')
const switched = nextAiPrefs(saved, { provider: 'custom', model: 'm', baseUrl: 'https://llm.example/v1', plaintext: '', ciphertextFromEncrypt: null })
check('switching provider drops the claude key', switched.keyCiphertext === null && switched.provider === 'custom')
check('form on another provider shows no saved key', settingsViewModel({ email: 'friend@example.com', prefs: saved, formProvider: 'custom' }).hasKey === false)
check('mac reachable', macStatus('auto: local reachable') === 'Mac: reachable')
check('mac unreachable', macStatus('auto: local unreachable, try later') === 'Mac: unreachable')
check('mac unchecked', macStatus(null) === 'Mac: not checked' && macStatus('models endpoint returned 200') === 'Mac: not checked')
const summary = traceSummary({
  id: 'run-1', created_at: '2026-10-21T18:00:00Z',
  data: { outcome: 'proposed', totals: { cost_usd: 0.0012 }, events: [
    { type: 'model_call', model: 'claude-haiku-5-5', stop_reason: 'end_turn' },
    { type: 'tool_call', name: 'search_tasks', ok: false, error_code: 'NOT_FOUND' },
  ] },
})
check('trace summary', summary.outcome === 'proposed' && summary.costUsd === 0.0012 && summary.createdAt === '2026-10-21T18:00:00Z' && summary.events[0].detail === 'claude-haiku-5-5 · end_turn' && summary.events[1].detail === 'NOT_FOUND' && summary.events[1].label === 'search_tasks')
check('trace error hidden', traceLoadMessage(true) === "Traces aren't available yet.")
check('trace load ok', traceLoadMessage(false) === null)
const autoClears = nextAiPrefs(saved, { provider: 'auto', model: 'claude-haiku-5-5', baseUrl: '', plaintext: 'sk-ant-example', ciphertextFromEncrypt: 'should-not-keep' })
check('auto stores no key', autoClears.keyCiphertext === null && JSON.stringify(autoClears).includes('sk-ant-example') === false)

const card = diffModel(
  [update, { op: 'delete', taskId: 'gym', reason: 'user asked', beforeRaw: { title: 'Gym' }, beforeCompletionsRaw: [], warnings: [{ code: 'EXTERNAL_TASK', message: 'Shared by someone else.' }] }],
  ['dentist'],
  [dentist],
)
check('update line', card.updates[0].lines[0] === 'scheduledDate: 2026-10-22 → 2026-10-21')
check('unchecked delete', card.deletes[0].checked === false && card.deletes[0].warnings[0] === 'Shared by someone else.')
check('delete title from raw', card.deletes[0].title === 'Gym' && card.deletes[0].lines[0] === 'user asked')
const statusCard = diffModel(
  [{ op: 'set_status', taskId: 'gym', date: '2026-10-23', before: { status: 'open' }, after: { status: 'skipped' }, warnings: [] }],
  ['gym'],
  [],
)
check('status is an update', statusCard.updates[0].lines[0] === 'status: open → skipped' && statusCard.updates[0].lines[1] === 'date: 2026-10-23' && statusCard.updates[0].title === 'gym')

const layout = readFileSync('src/components/Layout.tsx', 'utf8')
check('entry uses the helper', layout.includes('agentEntry') && layout.includes('openAgent') && layout.includes('BoDay Agent'))
const palette = readFileSync('src/components/CommandPalette.tsx', 'utf8')
check('palette uses the helper', palette.includes('agentPaletteItem') && palette.includes('label="BoDay Agent"'))
check('nlp create stays', palette.includes('Create:') && palette.includes('label="BoDay AI"'))
const today = readFileSync('src/views/TodayView.tsx', 'utf8')
check('plan-my-day button untouched', today.includes('Ask BoDay'))
const chat = readFileSync('src/components/AgentChat.tsx', 'utf8')
check('chat uses the gates', chat.includes('canSend') && chat.includes('hasUsableModel') && chat.includes('buildAgentSnapshot') && chat.includes('approveMessage') && chat.includes('loadEnv: loadUserPrefsEnvelope') && chat.includes('access_token') && !chat.includes('fetch('))
const diff = readFileSync('src/components/AgentDiffCard.tsx', 'utf8')
check('diff colors and actions', ['text-success', 'text-p3', 'text-danger', 'Deletes', 'Approve', 'Reject', 'Undo'].every((s) => diff.includes(s)))

const settings = readFileSync('src/components/AgentSettings.tsx', 'utf8')
check('settings copy', settings.includes('Test connection') && settings.includes('keyFieldPlaceholder') && settings.includes('macStatus'))
const view = readFileSync('src/views/SettingsView.tsx', 'utf8')
check('settings mounts the section', view.includes('AgentSettings'))
const traces = readFileSync('src/components/TraceViewer.tsx', 'utf8')
check('traces table', traces.includes('agent_traces') && traces.includes('traceSummary') && traces.includes('traceLoadMessage'))
const envExample = readFileSync('.env.example', 'utf8')
check('env example', envExample.includes('VITE_AGENT_URL=') && envExample.includes('VITE_SUPABASE_URL='))

const inflight = {
  messages: [{ id: 'u1', role: 'user' as const, text: 'move dentist' }],
  sending: true,
}
const storedQuiet = {
  messages: [{ id: 'u1', role: 'user' as const, text: 'move dentist' }],
  sending: false,
}
const reopened = chatOnOpen(inflight, storedQuiet, 'user-1', 'user-1')
check('reopen keeps the in-flight chat', reopened.sending === true && reopened.messages.length === 1)
const firstOpen = chatOnOpen(null, storedQuiet, null, 'user-1')
check('first open loads storage', firstOpen.sending === false && firstOpen.messages[0].text === 'move dentist')
const switchedUser = chatOnOpen(inflight, { messages: [], sending: false }, 'user-1', 'user-2')
check('a different account does not keep the chat', switchedUser.messages.length === 0)
check('a reply from an old turn is dropped', acceptModelReply(2, 1) === false)
check('a reply from the current turn is kept', acceptModelReply(2, 2) === true)
check('provider switch clears a typed key', onProviderPicked('custom').password === '' && onProviderPicked('claude').provider === 'claude')
check('panel uses the flight helpers', chat.includes('chatOnOpen') && chat.includes('acceptModelReply'))
check('settings clears the key on radio change', settings.includes('onProviderPicked'))

// ---- Review fixes (PR #9). Namespace imports so a missing helper is a ✗, not a crash.
const lib = (mod: Record<string, unknown>, name: string) =>
  (typeof mod[name] === 'function' ? mod[name] : null) as ((...args: any[]) => any) | null

// Fix 1: Save never wipes a saved key it could not read.
const savedKeyAi = { provider: 'claude', model: 'claude-haiku-5-5', baseUrl: null, keyCiphertext: 'CIPH-SAVED' }
function fakePrefsClient(opts: { session?: boolean; row?: unknown; error?: unknown; throws?: boolean }) {
  const result = () => {
    if (opts.throws) throw new Error('network')
    return { data: opts.row === undefined ? null : { data: opts.row }, error: opts.error ?? null }
  }
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result(),
    single: async () => result(),
  }
  return {
    auth: { getSession: async () => ({ data: { session: opts.session === false ? null : { user: { id: 'u1' } } } }) },
    from: () => query,
    rpc: async () => ({ error: null }),
  }
}
const loadResult = lib(prefsLib, 'loadUserPrefsResult')
const loadErr = loadResult ? await loadResult(fakePrefsClient({ error: { message: 'boom' } })) : null
check('fix1: a prefs load error is reported, not treated as empty', loadErr?.ok === false)
const loadThrow = loadResult ? await loadResult(fakePrefsClient({ throws: true })) : null
check('fix1: a thrown prefs load is reported', loadThrow?.ok === false)
const loadNone = loadResult ? await loadResult(fakePrefsClient({})) : null
check('fix1: no prefs row loads as empty', loadNone?.ok === true && JSON.stringify(loadNone.env) === '{}')
const loadSigned = loadResult ? await loadResult(fakePrefsClient({ session: false })) : null
check('fix1: signed out is not a successful load', loadSigned?.ok === false)
const canSave = lib(settingsLib, 'canSaveSettings')
check('fix1: Save is off while loading and after a failed load',
  !!canSave && canSave({ status: 'loading' }) === false && canSave({ status: 'failed', message: 'x' }) === false && canSave({ status: 'loaded', prefs: null }) === true)

const saveAi = lib(settingsLib, 'saveAiSettings')
async function runSave(read: unknown, form: Record<string, unknown>) {
  const calls = { encrypt: [] as string[], merge: [] as unknown[] }
  if (!saveAi) return { calls, outcome: null }
  const outcome = await saveAi({
    form: { provider: 'claude', model: 'claude-haiku-5-5', baseUrl: '', plaintext: '', ...form },
    readCurrent: async () => read,
    encrypt: async (plaintext: string) => { calls.encrypt.push(plaintext); return 'CIPH-NEW' },
    merge: async (patch: unknown) => { calls.merge.push(patch); return { ok: true } },
  })
  return { calls, outcome }
}
const failedSave = await runSave({ ok: false, reason: 'error' }, {})
check('fix1: Save writes nothing when the fresh read fails', !!saveAi && failedSave.outcome?.ok === false && failedSave.calls.merge.length === 0)
const keepSave = await runSave({ ok: true, env: { ai: savedKeyAi } }, { model: 'claude-sonnet-5-5' })
const keptAi = (keepSave.calls.merge[0] as { ai?: { keyCiphertext?: unknown; model?: unknown } } | undefined)?.ai
check('fix1: Save with no typed key keeps the stored key', keptAi?.keyCiphertext === 'CIPH-SAVED' && keptAi?.model === 'claude-sonnet-5-5' && keepSave.calls.encrypt.length === 0)
const switchSave = await runSave({ ok: true, env: { ai: savedKeyAi } }, { provider: 'custom', baseUrl: 'https://llm.example/v1' })
check('fix1: switching provider removes the stored key', (switchSave.calls.merge[0] as { ai?: { keyCiphertext?: unknown } } | undefined)?.ai?.keyCiphertext === null)
const typedSave = await runSave({ ok: true, env: { ai: savedKeyAi } }, { plaintext: 'sk-ant-new' })
const typedAi = (typedSave.calls.merge[0] as { ai?: { keyCiphertext?: unknown } } | undefined)?.ai
check('fix1: a typed key replaces the stored key', typedAi?.keyCiphertext === 'CIPH-NEW' && JSON.stringify(typedSave.calls.merge).includes('sk-ant-new') === false)
const settingsHtml = renderToStaticMarkup(createElement(AgentSettings, { email: 'friend@example.com' }))
check('fix1: Save renders disabled before prefs load', /<button[^>]*disabled=""[^>]*>Save<\/button>/.test(settingsHtml))

// Fix 2: the panel always leaves "Loading…", even when New chat lands mid-load.
const loadPanel = lib(chatLib, 'loadPanel')
const panelUser = { id: 'u1', email: 'friend@example.com' }
const panelEnv = { ai: savedKeyAi, cache: { windows: [{ start: 's', end: 'e', title: 'Candle lighting' }] } }
let panelGeneration = 0
const midLoad = loadPanel ? await loadPanel({
  getSessionUser: async () => panelUser,
  loadEnv: async () => { panelGeneration += 1; return panelEnv },
  isCancelled: () => false,
  generationChanged: () => panelGeneration !== 0,
}) : null
check('fix2: New chat during load still finishes loading', midLoad !== null && midLoad.account.signedIn === true && midLoad.account.prefs?.keyCiphertext === 'CIPH-SAVED' && midLoad.account.windows.length === 1)
check('fix2: New chat during load does not restore the old thread', midLoad?.restoreChat === false)
const plainLoad = loadPanel ? await loadPanel({
  getSessionUser: async () => panelUser, loadEnv: async () => panelEnv, isCancelled: () => false, generationChanged: () => false,
}) : null
check('fix2: a normal open restores the thread', plainLoad?.restoreChat === true && plainLoad.account.userId === 'u1')
const brokenLoad = loadPanel ? await loadPanel({
  getSessionUser: async () => { throw new Error('offline') }, loadEnv: async () => panelEnv, isCancelled: () => false, generationChanged: () => false,
}) : null
check('fix2: a failed session read still finishes loading', brokenLoad !== null && brokenLoad.account.signedIn === false)
const closedLoad = loadPanel ? await loadPanel({
  getSessionUser: async () => panelUser, loadEnv: async () => panelEnv, isCancelled: () => true, generationChanged: () => false,
}) : 'missing'
check('fix2: a closed panel ignores the late load', closedLoad === null)

// Fix 3: the browser must not autofill the BoDay login password into the API-key field.
const keyInput = settingsHtml.match(/<input[^>]*type="password"[^>]*>/)?.[0] ?? ''
check('fix3: API-key field asks for a new password', /autocomplete="new-password"/i.test(keyInput), keyInput)

// Fix 4: Approve and the toast's Undo read the live message, not the copy from render time.
useStore.setState({
  tasks: [{ id: 'dentist', type: 'one_time', title: 'Dentist', priority: 3, scheduledDate: '2026-10-22', completed: false, createdAt: '2026-09-01T12:00:00Z' }] as never,
  completions: [],
})
const liveUpdate = { op: 'update', taskId: 'dentist', patch: { priority: 1 }, beforeFields: { priority: 3 }, warnings: [] }
let live: { messages: Record<string, unknown>[]; sending: boolean } = { messages: [], sending: false }
live = reduce(live, { type: 'send', id: 'lu1', text: 'bump dentist' })
live = reduce(live, { type: 'assistant', id: 'la1', response: { ...contractResponse, outcome: 'proposed', changes: [liveUpdate] } })
const liveLog: string[] = []
const liveOpts = { nowIso: '2026-10-22T12:00:00.000Z', newId: () => 'unused' }
const liveDeps = {
  apply: (c: unknown[], ids: string[]) => useStore.getState().applyAgentProposal(c as Record<string, unknown>[], ids, liveOpts),
  undo: (c: unknown[], ids: string[]) => useStore.getState().undoAgentProposal(c as Record<string, unknown>[], ids, liveOpts),
  feedback: async (body: { event: string }) => { liveLog.push(`feedback:${body.event}`) },
  dispatch: (e: { type: string }) => { live = reduce(live, e as never) },
  toast: (d: string | { message: string; onAction?: () => void }) => { liveLog.push(`toast:${typeof d === 'string' ? d : d.message}`); if (typeof d !== 'string' && d.onAction) toastUndo = d.onAction },
  current: (id: string) => live.messages.find((m) => m.id === id),
}
let toastUndo: (() => void) | null = null
const renderCopy = live.messages[1]
approveMessage(liveDeps as never, renderCopy as never)
approveMessage(liveDeps as never, renderCopy as never)
const priorityNow = () => (useStore.getState().tasks.find((t) => t.id === 'dentist') as { priority?: number } | undefined)?.priority
check('fix4: a second Approve with the render copy is a silent no-op',
  priorityNow() === 1 && liveLog.filter((l) => l.startsWith('toast:')).join('|') === 'toast:Applied.' && liveLog.filter((l) => l === 'feedback:approve').length === 1,
  liveLog.join(' '))
undoMessage(liveDeps as never, live.messages[1] as never)
const afterCardUndo = liveLog.length
;(toastUndo as (() => void) | null)?.()
check('fix4: the toast Undo after the card Undo is a silent no-op', priorityNow() === 3 && liveLog.length === afterCardUndo, liveLog.slice(afterCardUndo).join(' '))
check('fix4: the card shows the proposal undone', live.messages[1].proposalStatus === 'undone')

console.log('')
if (failures === 0) {
  console.log('✅ ALL AGENT ASSERTIONS PASSED\n')
  process.exit(0)
} else {
  console.log(`❌ ${failures} assertion(s) FAILED\n`)
  process.exit(1)
}
