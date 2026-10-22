# BoDay Agent — Phase 5b: App Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BoDay can ask the agent from the existing app, show the proposal as a diff, and apply or undo the approved changes on the device, including model settings and a list of the user's own traces.

**Architecture:** The UI talks to the phase 5a service only through `src/lib/agentClient.ts`. Tests pass a fake `fetch` and never open a server. Apply and undo are pure functions over the task and completion arrays, committed with one `setState` so sync sees a single change. Chat history lives in its own per-user `localStorage` key (`boday-agent-chat-v1:<userId>`) until "New chat". It is not part of the zustand persist blob.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 4, Zustand, the existing `tsx` assertion script (`npm run test:logic`'s style). No new test runner. No component-test library: behavior sits in pure functions, components call those functions, and `tsc` plus a browser pass cover the markup.

**Spec:** `docs/superpowers/specs/2026-10-20-boday-agent-design.md` (§6 App integration, §4 trace viewer and feedback, §3 Settings → AI, §7 the app's `VITE_AGENT_URL`). Payload rules: `agent/README.md` "Payload contract" and the API contract section below.

**Prerequisite:** Phase 2 is on `main`. Branch `agent/phase5b-app` from that `main`. Do not wait for the phase 5a service to be deployed. Do not edit `agent/`, the spec, or existing plans.

**Parallel service plan:** `docs/superpowers/plans/2026-10-21-agent-phase5a-service.md`. The API contract section below is copied verbatim from that plan. If you change it, change both files in the same commit.

## Global Constraints

- Branch `agent/phase5b-app`. Push after every task. PR title: `Agent phase 5b: app chat UI`. Do not merge.
- Never rename the zustand persist key `cadence-v1`, never change its `version` (it stays `2`), and never add keys to `partialize`. Persisted state remains `tasks`, `completions`, and `settings` only. Chat and the AI ciphertext do not go in that blob.
- Do not change `setOneTimeCompleted`, `toggleRecurringCompletion`, `toggleRecurringSkip`, or `deleteTask`. Apply does not call them. `deleteTask` drops every completion for a task; the agent path deletes only the ids in `beforeCompletionsRaw` (FOLLOWUPS, "Before phase 5", the app item).
- The app does not decrypt keys, does not call Anthropic or a custom model itself, and does not read `agent/` Python. A missing `VITE_AGENT_URL` disables the assistant.
- **Name (owner decision, 2026-10-21; overrides the spec's "✨ Ask"):** the entry is called **BoDay Agent** everywhere it appears: the header button's visible text and accessible name, the panel title, the palette row label `BoDay Agent: ${query}` (query as typed), and the palette group `BoDay Agent`. The existing Today-view "Ask BoDay" button (plan my day) and the palette's NLP `Create: "<query>"` row are a different feature and stay exactly as they are, including their labels.
- Copy is exact: offline hint `needs internet`, empty-model sentence `Connect a model to enable BoDay AI.`, key placeholder `saved ✓`, buttons `Approve`, `Reject`, `Undo`, `Test connection`.
- Tests are `npm run test:agent` (`tsx scripts/test-agent.ts`), plus `npm run test:logic` and `npm run typecheck` on tasks that touch the store or components. `scripts/test-agent.ts` imports `./agent-test-shim.ts` before any module that imports the store.
- Commit messages end with a blank line and `Co-Authored-By: <model name> <noreply@...>`.
- A step whose title contains **owner step** needs the owner's machine (the app is built and deployed from the owner's Mac with `npm run build && npx wrangler deploy`). Do not deploy. Leave the box unchecked.
- Out of scope: streaming, MCP, task sharing, editing the Python service, a metrics dashboard.

## Review Focus

- **One selected change is stale** — nothing is written, including the changes that were still fresh. Test in Task 3.
- **A delete lists some of the task's completion ids** — only those ids are removed; undo puts `beforeRaw` back, including `someFutureField`. Test in Task 3.
- **`beforeFields` is null** — a missing key matches, a real value does not. Test in Task 3.
- **The device is offline** — BoDay Agent is disabled, the palette item is disabled, and `fetch` is not called. Test in Task 4.
- **A change is unchecked** — it is not applied. An updated task keeps `someFutureField` through apply and undo. Test in Task 3.
- **Undo of an "undone"** — the recurring completion row comes back with its own id, and a one-time task gets its exact `completedAt` back (or loses the key when it never had one). Test in Task 3.
- **A Claude key, then the provider switched to Custom** — the saved prefs hold `keyCiphertext: null`, so the Anthropic key is never sent to the custom URL. Test in Task 5.
- **`/feedback` fails after Approve** — the tasks stay applied, the message is still `applied`, and Undo still works. Test in Task 4.

## API contract

This section is the shared contract between the phase 5a service and the phase 5b app. The two plans are built in parallel. 5b tests against a mock of this contract and never against a live server. A change to this section must be made in both plan files in the same commit.

Wire format is JSON, camelCase keys. `changes` is the list returned by `RunContext.draft_payload()`, passed through with unknown keys kept. The server does not rebuild those objects.

### Auth

Every endpoint, including `GET /health`, requires:

```
Authorization: Bearer <supabase access token>
```

A missing, expired, bad-signature, `alg: none`, wrong-audience, wrong-issuer, or algorithm-confused token is `401` with the error shape. `sub` is the user id and must be a non-empty string. `aud` must be the string `authenticated`. When `SUPABASE_JWT_ISSUER` is set, `iss` must equal it. `email` is the address used for the Auto owner check; a missing email is not the owner. Comparison with the admin email is case-sensitive.

Cloud Run IAM does not authenticate the browser (`--allow-unauthenticated`). This header is the only auth.

### Error shape

Every non-2xx JSON body is exactly:

```json
{"error": {"code": "UNAUTHORIZED", "message": "Sign in required."}}
```

`message` is shown in the app. It never includes a secret, a resolved IP, a DSN, a stack trace, or an exception class name. Use these codes and messages verbatim:

| HTTP | code | message |
|---|---|---|
| 401 | UNAUTHORIZED | Sign in required. |
| 403 | AUTO_OWNER_ONLY | Auto is only available on the owner's account. |
| 403 | MODEL_NOT_CONFIGURED | Connect a model to enable BoDay AI. |
| 400 | INVALID_REQUEST | Check the message, snapshot, and model settings. |
| 400 | URL_REJECTED | That URL can't be used. |
| 400 | KEY_DECRYPT_FAILED | The saved API key could not be read. Save it again in Settings. |
| 413 | PAYLOAD_TOO_LARGE | That request is too large. |
| 404 | NOT_FOUND | Trace not found. |
| 500 | TRACE_WRITE_FAILED | Could not record the trace. |
| 500 | INTERNAL_ERROR | Something went wrong. Try again. |
| 503 | NOT_CONFIGURED | Key saving isn't available right now. |

`outcome: "failed"` is HTTP 200, not one of these codes. FastAPI's default `{"detail": ...}` body is never returned.

When each code applies:

- `UNAUTHORIZED` — the `Authorization` header does not carry an acceptable Supabase access token.
- `AUTO_OWNER_ONLY` — `settings.provider` is `auto` and `email` is not the admin email.
- `MODEL_NOT_CONFIGURED` — `claude` without `keyCiphertext`, or `custom` without both `baseUrl` and `model`. This applies to the owner too. `auto` does not use this code.
- `INVALID_REQUEST` — the JSON is not the documented object, `message` is empty or longer than 4000 characters, a history `text` is longer than 4000 characters, `snapshot` is not a JSON object, or `Snapshot.from_app` rejects `now` / `timezone`.
- `URL_REJECTED` — the custom URL, or the server's local URL, failed the SSRF guard.
- `KEY_DECRYPT_FAILED` — `keyCiphertext` does not decrypt for this user id.
- `PAYLOAD_TOO_LARGE` — the raw body is larger than 4194304 bytes (4 MiB).
- `NOT_FOUND` — `POST /feedback` names a run that is missing or belongs to another user. Same message either way.
- `TRACE_WRITE_FAILED` — the loop finished but the trace row was not written. The body is only the error shape: no `changes`, no `text`.
- `INTERNAL_ERROR` — any exception no other code covers. The body is only the error shape and still carries the CORS headers, so the app can read it.
- `NOT_CONFIGURED` — `POST /encrypt` while the server has no encryption key.

### POST /agent/run

Request:

```json
{
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
```

- `history[].role` is `user` or `assistant`.
- `history[].proposal` is an array of change objects or null.
- `history[].proposalStatus` is `pending`, `approved`, `rejected`, `applied`, `undone`, or null. There is no `partial` status. A partial approve is still `applied`; which ids were applied is recorded only on `POST /feedback`.
- The loop keeps the last 10 history turns (`build_messages`). The server does not trim history first and does not replace `snapshot.now` with the server clock.
- `message` is 1 to 4000 characters. Each history `text` is 0 to 4000 characters. The server rejects a longer one with `INVALID_REQUEST`; the app cuts each history `text` to its first 4000 characters before sending, so one long answer cannot block the rest of a chat.
- `snapshot` is the object `Snapshot.from_app` already accepts (`tasks`, `completions`, `quietWindows`, `now`, `timezone`). A non-object is `400` before `from_app` is called. A malformed task inside an otherwise valid snapshot is skipped by `from_app` and listed in `parseWarnings`; the run still happens.
- `settings.provider` is `auto`, `claude`, or `custom`.
- `settings.model` is a string or null. For `claude`, null means `claude-haiku-5-5`.
- `settings.baseUrl` is a string or null. Required for `custom`. Ignored for `auto` (the server uses `BODAY_LOCAL_BASE_URL`).
- `settings.keyCiphertext` is the opaque string from `POST /encrypt`, or null. Required for `claude`, for every user including the owner. Optional for `custom`. Ignored for `auto`. `auto` uses the server Anthropic key for its fallback and never the ciphertext.
- `custom` requires `baseUrl` and `model` for every user.
- Owner `auto` ignores `keyCiphertext`, `baseUrl`, and `model` from the body.

Response, HTTP 200:

```json
{
  "traceId": "2b0c1c3e-7c1a-4f0e-9c2a-6e5d8a1b4c70",
  "outcome": "proposed",
  "text": "Moved dentist to Wednesday.",
  "changes": [],
  "question": null,
  "options": [],
  "parseWarnings": []
}
```

- `outcome` is `proposed`, `answered`, `asked`, `refused`, or `failed`.
- `failed` and `asked` have `changes: []`.
- `changes` keeps unknown keys. The server passes `RunContext.draft_payload()` through and does not add or remove keys. The shapes the app reads:

```json
{"op": "create", "taskId": "new-1", "after": {"id": "new-1", "type": "one_time", "title": "Call mom", "priority": 3, "scheduledDate": "2026-10-21", "completed": false, "createdAt": "2026-10-21T18:00:00Z"}, "warnings": [{"code": "POSSIBLE_DUPLICATE", "message": "Possible duplicate."}]}
{"op": "update", "taskId": "dentist", "patch": {"scheduledDate": "2026-10-21"}, "beforeFields": {"scheduledDate": "2026-10-22"}, "warnings": [{"code": "TIME_CLASH", "message": "Overlaps Standup at 09:00."}]}
{"op": "set_status", "taskId": "gym", "date": "2026-10-23", "before": {"status": "open"}, "after": {"status": "skipped"}, "beforeCompletionRaw": null, "warnings": []}
{"op": "set_status", "taskId": "gym", "date": "2026-10-19", "before": {"status": "done"}, "after": {"status": "open"}, "beforeCompletionRaw": {"id": "c-gym-1019", "taskId": "gym", "completionDate": "2026-10-19", "completedAt": "2026-10-19T11:00:00Z"}, "warnings": []}
{"op": "set_status", "taskId": "dentist", "date": null, "before": {"status": "done"}, "after": {"status": "open"}, "beforeCompletionRaw": {"completedAt": "2026-10-20T15:00:00Z"}, "warnings": []}
{"op": "delete", "taskId": "gym", "reason": "user asked", "beforeRaw": {"id": "gym", "someFutureField": {"x": 1}}, "beforeCompletionsRaw": [{"id": "c-gym-1019", "taskId": "gym"}], "warnings": [{"code": "EXTERNAL_TASK", "message": "Shared by someone else."}]}
```

- Status values are `open`, `done`, and `skipped`. An "undone" request arrives as `after.status` `open`. `date` is the occurrence date for a recurring task and `null` for a one-time task.
- `beforeCompletionRaw` follows `agent/README.md` "Payload contract" exactly. It is what undo restores:
  - `null` when `before.status` is `open` (open → done, open → skipped). Nothing existed before; undo removes what apply created.
  - Recurring task, `before.status` `done` or `skipped` (undone, done → skipped, skipped → done): the completion row for that task and `date`, exactly as received (it has a string `id`; unknown keys kept). Apply changes or deletes only the row with that `id`; undo writes this row back verbatim. If the snapshot had several rows for one task and date, only the first is carried and only it may be touched.
  - One-time task, `before.status` `done` (only undone is possible; one-time tasks cannot be skipped): `{"completedAt": <raw value>}` when the task had that key (the value may be `null`), or `{}` when it did not. Undo sets `completed` back to `true` and restores `completedAt` exactly: the value, or no key for `{}`.
- Each change in one response has a distinct `taskId`. The service allows one change per task per proposal (`CONFLICTING_CHANGE`). The app treats a response that repeats a `taskId` as a proposal it cannot apply.
- `beforeFields` uses null both when the raw key held null and when the key was absent. The app's stale check treats a missing key as null, and undo writes `null` back rather than deleting the key.
- `question` is a string or null. `options` is an array of strings, empty when there are none.
- `parseWarnings` is the snapshot's warning strings, in order.
- `text` on `failed` is the redacted error string. `traceId` is `Trace.run_id`.

### POST /encrypt

Request: `{"plaintext": "sk-ant-example"}`

`plaintext` is 1 to 500 characters.

Response, HTTP 200: `{"ciphertext": "<opaque>"}`

The ciphertext is opaque. The app stores it on `user_prefs.data.ai.keyCiphertext` and sends it back unchanged. The app does not decrypt. Two calls with the same plaintext and user produce different ciphertext. The blob decrypts only for the user id that created it.

### POST /feedback

Request:

```json
{"runId": "2b0c1c3e-7c1a-4f0e-9c2a-6e5d8a1b4c70", "event": "approve", "taskIds": ["dentist"]}
```

- `event` is `approve`, `reject`, or `undo`.
- `taskIds` is an array of strings, the change `taskId` values. An empty array is valid.
- The server appends `{"event": "approve", "taskIds": ["dentist"], "at": "2026-10-21T18:00:00Z"}` to that user's trace. `at` is UTC, set by the server, format `YYYY-MM-DDTHH:MM:SSZ`. The client does not send `at`.

Response, HTTP 200: `{"ok": true}`

### POST /agent/test

Not named in the spec's route list. It exists so Settings → AI "Test connection" can run the SSRF guard and the owner's Cloudflare token on the server. It does not generate tokens and does not write a trace.

Request:

```json
{"settings": {"provider": "custom", "model": "local", "baseUrl": "https://llm.example/v1", "keyCiphertext": null}}
```

`settings` follows the same rules as `POST /agent/run`.

Response, HTTP 200:

```json
{"ok": true, "provider": "openai_compat", "model": "local", "detail": "models endpoint returned 200"}
```

- `ok: false` is still HTTP 200. `detail` is one short sentence the app shows as-is.
- `provider` is `anthropic` or `openai_compat`.
- Auth failures, SSRF rejection, a missing model, and a bad ciphertext use the error shape above, not this body.
- Auto reports the Mac, not the Claude fallback. Local up: `ok: true`, `provider: "openai_compat"`, `detail: "auto: local reachable"`. Local down or unset: `ok: false`, `provider: "anthropic"`, `model: "claude-haiku-5-5"`, `detail` starts with `auto: local unreachable`. Claude is not called.

### GET /health

Response, HTTP 200: `{"ok": true}`

Requires the same `Authorization` header. Does not touch the database or a provider.

### Trace row

The app reads `public.agent_traces` with the user's Supabase session. There is no list-traces HTTP route.

| column | meaning |
|---|---|
| `id` text primary key | `traceId` |
| `user_id` text | JWT `sub` |
| `data` jsonb | redacted `Trace` JSON. `data.request` has `message`, `history_length`, `task_count`, `snapshot_hash`, and no `tasks` array. `data.feedback` is the array of `{event, taskIds, at}` |
| `created_at` timestamptz | default `now()`, used for ordering |

Signed-in users can only `select` their own rows (RLS). `anon` and `authenticated` have no insert, update, or delete grant. The service's `agent_tracer` role has `insert` on the table and `execute` on `public.append_agent_feedback`, and nothing else: no select, update, or delete.

Rows are retained 30 days. The migration does not delete anything; the scheduled delete is an owner step.

### Settings object the app stores

`user_prefs.data.ai`, replaced as a whole object on save:

```json
{"provider": "claude", "model": "claude-haiku-5-5", "baseUrl": null, "keyCiphertext": null}
```

The plaintext API key is never stored and is never sent except as `plaintext` to `POST /encrypt`.

`keyCiphertext` belongs to the provider it was saved with. Saving a different `provider` without typing a new key stores `keyCiphertext: null`, so a key saved for Claude is never sent to a custom URL.

### Limits and environment

- Body cap: 4194304 bytes (4 MiB). The app sends its full snapshot and does not trim it.
- Model responses from a custom or local URL are capped at 2097152 bytes (2 MiB). A bigger one ends the run as `outcome: "failed"`.
- Admin email default: `bobo.borenstein@gmail.com` (the same constant as `src/lib/invites.ts` `ADMIN_EMAIL`), overridable with `ADMIN_EMAIL`.
- Env vars, exact names: `AGENT_ENCRYPTION_KEY` (standard base64 of 32 bytes), `SUPABASE_JWKS_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ISSUER` (`https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1` in production), `ADMIN_EMAIL`, `ANTHROPIC_API_KEY`, `BODAY_LOCAL_BASE_URL`, `BODAY_LOCAL_MODEL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `AGENT_TRACES_DSN`, `AGENT_ALLOWED_ORIGINS` (comma-separated origins, trimmed), `PORT` (default `8080`).
- JWT: if `SUPABASE_JWKS_URL` is set, accept only ES256 or RS256, verified with the JWKS key whose `kid` matches the token's `kid`. The project's JWKS (`https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1/.well-known/jwks.json`) publishes an ES256 P-256 key. Otherwise accept only HS256 against `SUPABASE_JWT_SECRET`. If both are set, JWKS wins and an HS256 token is `401`. If neither is set, `create_app` raises. A token's `alg` header only picks between ES256 and RS256 inside JWKS mode; it never switches modes.

## File map

- Create `src/lib/agentContract.ts` — wire types, `parseRunResponse`, `parseErrorBody`.
- Create `src/lib/agentClient.ts` — `createAgentClient`. The only `fetch` in this feature.
- Create `src/lib/agentSnapshot.ts` — `buildAgentSnapshot`.
- Create `src/lib/agentApply.ts` — equality, apply, undo. Does not import the store.
- Create `src/lib/agentChat.ts` — reducer, history, storage, entry, palette, send gate, toast normalizer.
- Create `src/lib/agentActions.ts` — `approveMessage`, `rejectMessage`, `undoMessage`, with their dependencies injected. The diff card and the toast both call these; no component writes this flow itself.
- Create `src/lib/agentSettings.ts` — settings view-model, saved-key placeholder, Mac status, trace summary.
- Create `src/components/AgentDiffCard.tsx`, `AgentChat.tsx`, `AgentSettings.tsx`, `TraceViewer.tsx`.
- Create `scripts/agent-test-shim.ts`, `scripts/test-agent.ts`.
- Modify `src/store/useStore.ts` — `setRecurringStatus`, `setOneTimeStatus`, `applyAgentProposal`, `undoAgentProposal`, and the open/close flags for the panel. Not persisted.
- Modify `src/components/Layout.tsx`, `CommandPalette.tsx`, `ToastContainer.tsx`, `src/App.tsx`, `src/views/SettingsView.tsx`, `src/lib/userPrefs.ts`, `package.json`, `.env.example`.
- Read before editing, and match: `Layout.tsx` (header button next to Search), `CommandPalette.tsx` (the `Cmd` rows and the existing "Create:" NLP action, which stays), `SettingsView.tsx` / `ShabbatSettings.tsx` (section markup), `useStore.ts` (actions are `set` over the arrays), `userPrefs.ts` (`mergeUserPrefsData` replaces a top-level key), `sync.ts` (the subscriber pushes whatever `tasks` and `completions` are after a `setState`).

---

### Task 1: Contract types and the HTTP client

**Files:**
- Create: `src/lib/agentContract.ts`, `src/lib/agentClient.ts`, `scripts/agent-test-shim.ts`, `scripts/test-agent.ts`
- Modify: `package.json` (`"test:agent": "tsx scripts/test-agent.ts"`)
- Test: `scripts/test-agent.ts`

**Interfaces:**
- `parseErrorBody(status: number, data: unknown): AgentError`. `AgentError` has `code` and `message`. When `data` is the contract error object, use its `code` and `message`. Otherwise `code` is `HTTP` and `message` is `Couldn't reach BoDay AI.`
- `parseRunResponse(data: unknown): RunResponse`. Requires `traceId` string, `outcome` one of the five, `text` string, `changes` array, `question` string or null, `options` string array, `parseWarnings` string array. For `failed` and `asked`, the returned `changes` is `[]` even if the JSON included some. Other outcomes keep `changes` as given, including unknown keys on each change (`beforeCompletionRaw`, `someFutureField`).
- `createAgentClient({ baseUrl, fetchImpl }): { run, encrypt, feedback, test }`. `baseUrl` has one trailing slash stripped. Paths are `/agent/run`, `/encrypt`, `/feedback`, `/agent/test`. Every call sends `Authorization: Bearer <token>`, `Content-Type: application/json`, and `credentials: 'omit'`. `run` passes `AbortSignal.timeout(130_000)` when that constructor exists. Non-2xx becomes `AgentError`. A thrown `fetch` becomes `AgentError` with code `NETWORK` and message `Couldn't reach BoDay AI.`
- `agentBaseUrl(env: { VITE_AGENT_URL?: string }): string | null` — trim, strip one trailing slash, empty becomes null.

The shim installs a `localStorage` on `globalThis` and `global` before any store import. `scripts/test-agent.ts` imports `./agent-test-shim.ts` as its first import. The harness matches `scripts/test-logic.ts`: `check(name, cond)`, a failure count, exit 0 or 1.

- [ ] **Step 1: Write the failing tests**

Use the `POST /agent/run` request example and the success response example from the API contract section as the fixtures `contractRun` and `contractResponse` (paste them, do not retype the fields).

```ts
check('empty env has no agent url', agentBaseUrl({}) === null)
check('slash stripped', agentBaseUrl({ VITE_AGENT_URL: 'https://agent.example/' }) === 'https://agent.example')

const calls: { url: string; init: RequestInit }[] = []
const fetchImpl = (async (url: string, init?: RequestInit) => {
  calls.push({ url, init: init ?? {} })
  return new Response(JSON.stringify(contractResponse), { status: 200 })
}) as typeof fetch
const client = createAgentClient({ baseUrl: 'https://agent.example/', fetchImpl })
const res = await client.run(contractRun, 'token-1')
check('run path', calls[0].url === 'https://agent.example/agent/run')
check('bearer', (calls[0].init.headers as Record<string, string>).Authorization === 'Bearer token-1')
check('body is the contract json', JSON.parse(String(calls[0].init.body)).message === 'move my dentist to tomorrow')
check('outcome', res.outcome === 'proposed' && res.traceId === contractResponse.traceId)

const failed = parseRunResponse({ ...contractResponse, outcome: 'failed', changes: [{ op: 'delete' }] })
check('failed drops changes', failed.changes.length === 0)
const kept = parseRunResponse({
  ...contractResponse,
  changes: [{ op: 'update', taskId: 'dentist', patch: {}, beforeFields: {}, warnings: [], beforeCompletionRaw: { id: 'c1' } }],
})
check('unknown change key kept', kept.changes[0].beforeCompletionRaw.id === 'c1')

const denied = parseErrorBody(403, { error: { code: 'MODEL_NOT_CONFIGURED', message: 'Connect a model to enable BoDay AI.' } })
check('error message', denied.code === 'MODEL_NOT_CONFIGURED' && denied.message === 'Connect a model to enable BoDay AI.')
```

Add a call that returns status 500 with a plain-text body and checks the message is `Couldn't reach BoDay AI.` Add `encrypt`, `feedback`, and `test` calls and check the paths `/encrypt`, `/feedback`, and `/agent/test`.

- [ ] **Step 2: Run** — `npm run test:agent` → FAIL (modules missing).
- [ ] **Step 3: Implement** the two modules and the harness. Do not add a dependency. `parseRunResponse` throws `AgentError` (`code: 'HTTP'`) when required keys are missing.
- [ ] **Step 4: Run** — `npm run test:agent` → PASS.
- [ ] **Step 5: Commit + push** — `git commit -m "app: agent HTTP client against the phase 5 contract"`.

---

### Task 2: Snapshot builder

**Files:**
- Create: `src/lib/agentSnapshot.ts`
- Modify: `src/lib/userPrefs.ts` (type `cache` and add `ai`)
- Test: `scripts/test-agent.ts`

**Interfaces:**
- `buildAgentSnapshot({ tasks, completions, quietWindows, now, timeZone })` returns a plain object whose keys are exactly `tasks`, `completions`, `quietWindows`, `now`, `timezone`. `now` is `now.toISOString()`. `tasks` and `completions` are the same arrays, not remapped, so unknown fields stay. `quietWindows` is the array passed in (possibly empty).
- `UserPrefsEnvelope.cache` is `{ fetchedAt?: string; windows?: { start: string; end: string; title: string }[] }`. `ai` is `AgentAiPrefs | undefined` with `provider`, `model`, `baseUrl`, `keyCiphertext` (each `model` / `baseUrl` / `keyCiphertext` is `string | null`). `mergeUserPrefsData` already replaces a top-level key other than `snoozes`; do not special-case `ai`.

- [ ] **Step 1: Write the failing tests**

```ts
const task = { id: 'dentist', type: 'one_time', title: 'Dentist', someFutureField: { x: 1 } }
const snap = buildAgentSnapshot({
  tasks: [task],
  completions: [],
  quietWindows: [{ start: '2026-10-23T17:52:00-04:00', end: '2026-10-24T18:51:00-04:00', title: 'Candle lighting' }],
  now: new Date('2026-10-21T22:00:00.000Z'),
  timeZone: 'America/New_York',
})
check('snapshot keys', Object.keys(snap).sort().join() === 'completions,now,quietWindows,tasks,timezone')
check('now is iso', snap.now === '2026-10-21T22:00:00.000Z')
check('timezone kept', snap.timezone === 'America/New_York')
check('future field kept', snap.tasks[0].someFutureField.x === 1)
check('no secrets', JSON.stringify(snap).includes('sk-') === false)
```

- [ ] **Step 2: Run** — `npm run test:agent` → FAIL.
- [ ] **Step 3: Implement.** This task only types the envelope and builds the object. `loadUserPrefsEnvelope()` is `async` (it reads `user_prefs` from Supabase), so the chat panel in Task 6 awaits it: `const env = await loadUserPrefsEnvelope()`, then `env.cache?.windows ?? []` and `env.ai ?? null`. The time zone comes from `Intl.DateTimeFormat().resolvedOptions().timeZone`. The window shape matches what the push worker writes (`worker-push/src/index.ts`, `cache: { fetchedAt, windows }`).
- [ ] **Step 4: Run** — `npm run test:agent` → PASS.
- [ ] **Step 5: Commit + push** — `git commit -m "app: build the agent snapshot from local tasks"`.

---

### Task 3: Apply, undo, and the store actions

**Files:**
- Create: `src/lib/agentApply.ts`
- Modify: `src/store/useStore.ts`
- Test: `scripts/test-agent.ts`

**Interfaces:**
- `sameValue(actual, expected): boolean` — object key order does not matter; arrays compare by index; `expected === null` matches `null` or `undefined`.
- `fieldValue(task, key)` — missing key or `undefined` returns `null`, otherwise the value.
- `currentStatus(task, completions, date: string | null): 'open' | 'done' | 'skipped' | null`. One-time: `completed` → `done`, else `open` (`date` ignored). Recurring: the completion with that `taskId` and `completionDate` is `skipped` or `done`, or `open` when absent. Recurring with `date === null` returns `null`.
- `withRecurringStatus(completions, taskId, date, status, { nowIso, newId })`. `none` drops that date's row. `done` / `skipped`: a second call with the same status returns the same id and the same `completedAt` and does not call `newId` again. A skipped row upgraded to `done` keeps `completedAt` and drops `skipped`. A done row marked `skipped` keeps id and `completedAt` and sets `skipped: true`.
- `withOneTimeStatus(tasks, id, completed, nowIso)`. Already in the requested state → the same `completedAt` and the same array entry. Becoming done sets `completedAt` to `nowIso`. Becoming not done sets `completedAt` to `null`.
- `applyProposal(state, changes, selectedTaskIds, opts): ApplyResult` and `undoProposal(...)`. `ApplyResult` is `{ ok: true, tasks, completions }` or `{ ok: false, message }`. Messages, exact: `This proposal is out of date. Nothing was applied.` and `This proposal can't be applied. Nothing was applied.`
- Check every selected change against the original state. Any stale or invalid result returns before a copy is made. Then copy the arrays and apply in list order.
- Invalid proposal: two changes in `changes` share a `taskId` (the service never sends that; see the contract). Both `applyProposal` and `undoProposal` return the can't-be-applied message for it, before looking at the selection.
- Stale update: task missing, or any `patch` key whose `fieldValue` is not `sameValue` to `beforeFields[key]`. Invalid update: `beforeFields` is missing a patch key.
- Stale create: a task with `after.id` already exists. Invalid create: `after` is not an object or `after.id !== taskId`.
- Stale delete: the task id is absent, or the current task is not `sameValue` to `beforeRaw` (the task changed after the snapshot, and undo would silently put the old version back). Compare with `sameValue(current, beforeRaw)` and `sameValue(beforeRaw, current)` both true, so an added key also counts as a change. Invalid delete: `beforeRaw` is not an object.
- Apply delete: remove the task; remove completions whose `id` is a string id in `beforeCompletionsRaw`; leave every other completion, including ones with the same `taskId`.
- Stale `set_status`: `currentStatus` is not `before.status`, or (recurring, `before.status` `done` / `skipped`) no completion with `beforeCompletionRaw.id` exists. Invalid: recurring with a null `date`; one-time with `before` or `after` `skipped`; `before` / `after` missing; `before.status` `open` with a non-null `beforeCompletionRaw`; recurring with `before.status` `done` / `skipped` and `beforeCompletionRaw` not an object with a string `id`; one-time with `before.status` `done` and `beforeCompletionRaw` not an object.
- Apply `set_status` (`beforeCompletionRaw` follows the contract and `agent/README.md` "Payload contract"):
  - `before.status` `open`: `withRecurringStatus` (`done` → `done`, `skipped` → `skipped`) or `withOneTimeStatus(…, true)`. This creates the row or flag.
  - Recurring, `before.status` `done` / `skipped`: touch only the completion whose `id` is `beforeCompletionRaw.id`. `after` `open` deletes that row. `done` → `skipped` sets `skipped: true` on it and keeps `id` and `completedAt`. `skipped` → `done` removes the `skipped` key and keeps `id` and `completedAt`. Other rows for the same task and date are left alone.
  - One-time, `before.status` `done`: `completed: false`, `completedAt: null`.
- Undo update: every patch key still `sameValue` to the patch value, then write each `beforeFields` key (null is written, the key is not deleted). Other keys stay.
- Undo create: every key in `after` still matches; then remove the task and do not remove completions.
- Undo delete: the task id is absent, and no string id in `beforeCompletionsRaw` is already present. Then insert `beforeRaw` and those completion objects verbatim. A completion object without a string `id` makes the undo invalid.
- Undo `set_status`: current status equals `after.status` (else stale), then:
  - `before.status` `open` (`beforeCompletionRaw` is `null`): remove what apply created. Recurring: `withRecurringStatus(…, 'none')` for that task and `date`. One-time: `completed: false`, `completedAt: null`.
  - Recurring, `before.status` `done` / `skipped`: write `beforeCompletionRaw` back verbatim (same id, `completedAt`, `skipped`, unknown keys). If a row with that `id` exists (done ↔ skipped), replace it; if not (it was deleted by an undone), insert it. Never call `newId`.
  - One-time, `before.status` `done`: set `completed: true`. If `beforeCompletionRaw` has the key `completedAt`, set the task's `completedAt` to that value exactly (it may be `null`); if it is `{}`, remove the `completedAt` key. Do not use `nowIso`.
- Store, same file as the other actions, not persisted: `setRecurringStatus(taskId, date, status)`, `setOneTimeStatus(id, completed)`, `applyAgentProposal(changes, selectedTaskIds, opts): ApplyResult`, `undoAgentProposal(changes, appliedTaskIds, opts): ApplyResult`, `agentOpen: boolean`, `agentSeed: string | null`, `openAgent(seed?: string)`, `closeAgent()`. The proposal actions call the pure functions and `set` only when `ok` is true. `partialize` is unchanged.

- [ ] **Step 1: Write the failing tests**

Import `useStore` from `../src/store/useStore.ts` after the shim import. The default persist storage writes synchronously, so read `localStorage` on the next line.

```ts
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
const state = { tasks: [dentist], completions: [] }
const applied = applyProposal(state, [update], ['dentist'], OPTS)
check('future field after apply', applied.ok && applied.tasks[0].someFutureField.x === 1)
check('date patched', applied.ok && applied.tasks[0].scheduledDate === '2026-10-21')
const undone = undoProposal(
  { tasks: applied.tasks, completions: applied.completions }, [update], ['dentist'], OPTS,
)
check('future field after undo', undone.ok && undone.tasks[0].someFutureField.x === 1)
check('date restored', undone.ok && undone.tasks[0].scheduledDate === '2026-10-22')

const fresh = { ...update, taskId: 'other', patch: { priority: 1 }, beforeFields: { priority: 3 } }
const other = { id: 'other', type: 'one_time', title: 'Other', priority: 3, scheduledDate: '2026-10-20', completed: false, createdAt: '2026-09-01T12:00:00Z' }
const stale = applyProposal(
  { tasks: [dentist, other], completions: [] },
  [update, { ...fresh, beforeFields: { priority: 9 } }],
  ['dentist', 'other'],
  OPTS,
)
check('one stale blocks the batch', stale.ok === false && stale.message === 'This proposal is out of date. Nothing was applied.')

const partial = applyProposal(
  { tasks: [dentist, other], completions: [] },
  [update, fresh],
  ['dentist'],
  OPTS,
)
check('unchecked task untouched', partial.ok && partial.tasks.find((t) => t.id === 'other').priority === 3)

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
```

`OPTS` is `{ nowIso: '2026-10-21T18:00:00.000Z', newId: () => 'new-id' }` with a counter when a test needs two ids. Add the cases next to these, each with `check`:

- Update whose `beforeFields` is `{ endDate: null }` against a task that has no `endDate` applies, and undo leaves `endDate === null`.
- The same before-value against a task that has `endDate: '2026-12-31'` is stale.
- `withRecurringStatus` done, then done again: one id, one `completedAt`, `newId` called once.
- `set_status` on recurring gym, `before.status` `open`, `after.status` `skipped`, `date` `2026-10-23`, `beforeCompletionRaw: null`: apply adds one skipped row; undo removes it.
- Recurring undone: gym with `c1` on `2026-10-19`, change `before` `done`, `after` `open`, `date` `2026-10-19`, `beforeCompletionRaw: c1`. Apply removes `c1`. Undo puts back an object deep-equal to `c1` (id `c1`, `extra: true`) and `newId` is never called.
- The same recurring undone with `beforeCompletionRaw: null` is the can't-be-applied message on apply, and nothing is written.
- Recurring done → skipped on gym `2026-10-19` with `beforeCompletionRaw: c1`, plus a second row `c3` for the same date: apply sets `skipped: true` on `c1` only (same id and `completedAt`), `c3` is unchanged; undo puts back an object deep-equal to `c1` (no `skipped` key).
- One-time undone: dentist with `completed: true, completedAt: '2026-10-20T15:00:00Z'`, `date: null`, `before` `done`, `after` `open`, `beforeCompletionRaw: { completedAt: '2026-10-20T15:00:00Z' }`. Apply leaves `completed: false, completedAt: null`; undo leaves `completed: true, completedAt: '2026-10-20T15:00:00Z'` (not `OPTS.nowIso`).
- One-time undone of a task that had no `completedAt` key, `beforeCompletionRaw: {}`: after undo, `'completedAt' in task === false` and `completed === true`.
- Two changes with `taskId: 'dentist'` in one list: apply and undo both return the can't-be-applied message.
- Delete of `gym` when the current gym has `title: 'Gym (edited)'` but `beforeRaw.title` is `'Gym'`: the out-of-date message, and `c1` / `c2` are untouched.
- Recurring `set_status` with `date: null` returns the can't-be-applied message and does not write.
- Create inserts `after` with its own `id` (`new-1`), not a store-minted id. Undo removes that task.
- `applyAgentProposal` on the store with the delete fixture leaves `c2` in `useStore.getState().completions`.
- `openAgent('hello')` then `JSON.parse(localStorage.getItem('cadence-v1')).state.agentOpen === undefined`, and the key `cadence-v1` exists.
- `setOneTimeStatus('dentist', true)` twice keeps the first `completedAt`.

- [ ] **Step 2: Run** — `npm run test:agent` → FAIL.
- [ ] **Step 3: Implement** the pure helpers and the store actions. Apply builds the next arrays itself; it does not call `addTask` or `deleteTask`. One `set` inside `applyAgentProposal` / `undoAgentProposal` is what `src/lib/sync.ts` already subscribes to.
- [ ] **Step 4: Run** — `npm run test:agent && npm run test:logic` → PASS.
- [ ] **Step 5: Commit + push** — `git commit -m "app: atomic apply and undo for agent proposals"`.

---

### Task 4: Chat state, history, offline, palette, approve / undo flow

**Files:**
- Create: `src/lib/agentChat.ts`, `src/lib/agentActions.ts`
- Modify: `scripts/test-agent.ts`
- Test: `scripts/test-agent.ts`

**Interfaces:**
- `ChatMessage` fields: `id`, `role` (`user` | `assistant`), `text`, optional `outcome`, `changes`, `question`, `options`, `traceId`, `parseWarnings`, `proposalStatus`, `selectedTaskIds`, `appliedTaskIds`.
- `reduce(state, event)`:
  - `{ type: 'send', id, text }` while `sending` is false appends a user message and sets `sending` true. A second `send` while `sending` is ignored.
  - `{ type: 'assistant', id, response }` appends the assistant message, `sending` false, `proposalStatus: 'pending'` when `outcome` is `proposed`, otherwise null. `selectedTaskIds` starts as every change `taskId`.
  - `{ type: 'fail', id, text }` appends an assistant message with `outcome: 'failed'`, `text`, empty changes, `sending` false.
  - `{ type: 'toggle', messageId, taskId }` flips that id inside `selectedTaskIds`.
  - `{ type: 'resolve', messageId, status }` sets `proposalStatus` to `applied`, `rejected`, or `undone`. When `status` is `applied`, `appliedTaskIds` becomes the current `selectedTaskIds`. The `changes` array is not filtered. `rejected` and `applied` are accepted only from `pending`; `undone` only from `applied`. Any other transition is ignored.
  - `{ type: 'new' }` returns `{ messages: [], sending: false }`.
- `toHistory(messages)` maps to the contract history objects (`proposalStatus`, camelCase). A trailing user message with no assistant reply after it is omitted (that text is the `message` field, not history). `failed` and `asked` turns send `proposal: null` and `proposalStatus: null`. Each `text` is cut to its first 4000 characters (`text.slice(0, 4000)`), because the server rejects longer history text.
- `chatKey(userId: string)` is `` `boday-agent-chat-v1:${userId}` ``, so a second account on the same browser never sees the first account's chat. `loadChat(storage, userId)` / `saveChat(storage, userId, state)` use it. `new` deletes that key. Corrupt JSON loads as an empty chat. Signed out there is no user id, so nothing is loaded or saved.
- `agentEntry({ online })` → `{ disabled: !online, hint: online ? null : 'needs internet' }`.
- `agentPaletteItem(query, online, configured)` → `null` when `query.trim()` is empty. Otherwise `{ label: 'BoDay Agent: ' + query, disabled: !online || !configured, hint }` with hint `needs internet` when offline, `Connect a model` when online but not configured, and `Ask` when it can run. The query is not lowercased.
- `canSend({ online, serviceConfigured, hasModel, sending, text })` is true only when all of the gates are open and `text.trim()` is non-empty.
- `panelMessage({ online, serviceConfigured, signedIn, hasModel })` returns the first match: offline → `needs internet`; no service URL → `BoDay AI isn't configured on this build.`; no session → `Sign in required.`; no usable model → `Connect a model to enable BoDay AI.`; otherwise null.
- `normalizeToast(detail)`: a string → `{ message: detail, actionLabel: null, durationMs: 5000 }`. An object `{ message, actionLabel }` → that label and `durationMs: 8000`.
- `src/lib/agentActions.ts`. Every function takes `deps: { apply, undo, feedback, dispatch, toast }`, where `apply` / `undo` are the store's `applyAgentProposal` / `undoAgentProposal`, `feedback(body)` is `client.feedback` bound to the current token (returns a Promise), `dispatch` is the reducer's dispatch, and `toast(detail)` fires `boday-toast`.
  - `approveMessage(deps, message)`: does nothing unless `message.proposalStatus === 'pending'`. Calls `apply(message.changes, message.selectedTaskIds)`. On `{ ok: false }`: `toast(result.message)` and stop; the status stays `pending`. On `{ ok: true }`: `dispatch({ type: 'resolve', messageId, status: 'applied' })` first, then `toast({ message: 'Applied.', actionLabel: 'Undo', onAction: () => undoMessage(deps, <the same message with appliedTaskIds set>) })`, then `feedback({ runId: message.traceId, event: 'approve', taskIds: message.selectedTaskIds })` without awaiting it and with `.catch(() => {})`. A failed feedback call never changes tasks or status.
  - `rejectMessage(deps, message)`: only from `pending`. `dispatch` `rejected`, then fire-and-forget `feedback` `reject` with `taskIds: []`. Tasks are not touched.
  - `undoMessage(deps, message)`: only from `applied`. Calls `undo(message.changes, message.appliedTaskIds)`. On `{ ok: false }`: `toast(result.message)`, status stays `applied`. On `{ ok: true }`: `dispatch` `undone`, `toast('Undone.')`, then fire-and-forget `feedback` `undo` with `taskIds: message.appliedTaskIds`. The toast's Undo and the diff card's Undo both call this function, and a second call after `undone` does nothing.

- [ ] **Step 1: Write the failing tests**

```ts
let state = { messages: [], sending: false }
state = reduce(state, { type: 'send', id: 'u1', text: 'move dentist' })
state = reduce(state, { type: 'send', id: 'u2', text: 'again' })
check('one send at a time', state.messages.length === 1 && state.sending)
state = reduce(state, {
  type: 'assistant', id: 'a1',
  response: { ...contractResponse, outcome: 'proposed', changes: [update] },
})
check('all checked', state.messages[1].selectedTaskIds.join() === 'dentist')
state = reduce(state, { type: 'toggle', messageId: 'a1', taskId: 'dentist' })
state = reduce(state, { type: 'resolve', messageId: 'a1', status: 'applied' })
check('applied keeps the change', state.messages[1].changes.length === 1 && state.messages[1].proposalStatus === 'applied')
const hist = toHistory([...state.messages, { id: 'u3', role: 'user', text: 'undo that' }])
check('trailing user is not history', hist.length === 2 && hist[1].proposalStatus === 'applied')
const longHist = toHistory([{ id: 'u9', role: 'user', text: 'x' }, { id: 'a9', role: 'assistant', text: 'y'.repeat(5000), outcome: 'answered' }, { id: 'u10', role: 'user', text: 'next' }])
check('history text cut to 4000', longHist[1].text.length === 4000)
check('palette copy', agentPaletteItem('move dentist', false, true).label === 'BoDay Agent: move dentist')
check('palette offline', agentPaletteItem('move dentist', false, true).disabled && agentPaletteItem('move dentist', false, true).hint === 'needs internet')
check('empty query', agentPaletteItem('  ', true, true) === null)
check('chat key per user', chatKey('user-1') === 'boday-agent-chat-v1:user-1' && chatKey('user-1') !== chatKey('user-2'))
check('offline wins the panel', panelMessage({ online: false, serviceConfigured: false, signedIn: false, hasModel: false }) === 'needs internet')
check('missing build', panelMessage({ online: true, serviceConfigured: false, signedIn: false, hasModel: false }) === "BoDay AI isn't configured on this build.")
check('sign in', panelMessage({ online: true, serviceConfigured: true, signedIn: false, hasModel: true }) === 'Sign in required.')
check('connect a model', panelMessage({ online: true, serviceConfigured: true, signedIn: true, hasModel: false }) === 'Connect a model to enable BoDay AI.')
check('canSend offline', canSend({ online: false, serviceConfigured: true, hasModel: true, sending: false, text: 'hi' }) === false)
check('toast undo lasts longer', normalizeToast({ message: 'Applied.', actionLabel: 'Undo' }).durationMs === 8000)
check('string toast unchanged', normalizeToast('Saved').durationMs === 5000 && normalizeToast('Saved').actionLabel === null)
```

Also `saveChat` / `loadChat` round-trip on the shim storage for `user-1`, `loadChat(storage, 'user-2')` is empty after that, and `saveChat` after `{ type: 'new' }` removes `boday-agent-chat-v1:user-1`. Assert no key equals `cadence-v1`'s name.

The approve / undo flow, with fakes:

```ts
const log: string[] = []
let chat = { messages: [], sending: false }
const deps = {
  apply: () => ({ ok: true, tasks: [], completions: [] }),
  undo: () => ({ ok: true, tasks: [], completions: [] }),
  feedback: (body) => { log.push(`feedback:${body.event}`); return Promise.reject(new Error('offline')) },
  dispatch: (e) => { chat = reduce(chat, e) },
  toast: (d) => log.push(`toast:${typeof d === 'string' ? d : d.message}`),
}
chat = reduce(chat, { type: 'send', id: 'u1', text: 'move dentist' })
chat = reduce(chat, { type: 'assistant', id: 'a1', response: { ...contractResponse, outcome: 'proposed', changes: [update] } })
approveMessage(deps, chat.messages[1])
await new Promise((r) => setTimeout(r, 0))
check('applied even though feedback failed', chat.messages[1].proposalStatus === 'applied')
check('approve feedback sent', log.includes('feedback:approve') && log.includes('toast:Applied.'))
undoMessage(deps, chat.messages[1])
check('undo marks undone', chat.messages[1].proposalStatus === 'undone' && log.includes('feedback:undo'))
const before = log.length
undoMessage(deps, chat.messages[1])
check('second undo is a no-op', log.length === before)
const refused = { ...deps, apply: () => ({ ok: false, message: 'This proposal is out of date. Nothing was applied.' }) }
chat = reduce(chat, { type: 'send', id: 'u2', text: 'again' })
chat = reduce(chat, { type: 'assistant', id: 'a2', response: { ...contractResponse, outcome: 'proposed', changes: [update] } })
approveMessage(refused, chat.messages[3])
check('stale approve stays pending', chat.messages[3].proposalStatus === 'pending' && log.at(-1) === 'toast:This proposal is out of date. Nothing was applied.')
```

`update` and `contractResponse` are the values defined earlier in this file. An unhandled rejection from `feedback` would crash `tsx`, so the test also proves the `.catch`.

- [ ] **Step 2: Run** — `npm run test:agent` → FAIL.
- [ ] **Step 3: Implement** `agentChat.ts` and `agentActions.ts`. Storage failures are ignored (a full `localStorage` must not crash the panel). `agentActions.ts` imports neither the store nor the client; everything comes in through `deps`.
- [ ] **Step 4: Run** — `npm run test:agent` → PASS.
- [ ] **Step 5: Commit + push** — `git commit -m "app: agent chat state, history, and offline gate"`.

---

### Task 5: Settings model and trace summary

**Files:**
- Create: `src/lib/agentSettings.ts`
- Test: `scripts/test-agent.ts`

**Interfaces:**
- `settingsViewModel({ email, prefs })`: `showAuto` when `email === ADMIN_EMAIL` imported from `src/lib/invites.ts` (`bobo.borenstein@gmail.com`). `provider` is `prefs.provider` when that choice is allowed, otherwise `auto` for the owner and `claude` for everyone else. `hasKey` is `Boolean(prefs?.keyCiphertext)`. `model` defaults to `claude-haiku-5-5`. `baseUrl` defaults to `''`. The ciphertext string is not a returned field.
- `hasUsableModel(email, prefs)` is true for the owner when `prefs` is null or `provider` is `auto` (the server holds the fallback key). It is true for `claude` only when `keyCiphertext` is non-null, and for `custom` only when `baseUrl` and `model` are both non-null. A non-owner with `provider: 'auto'` is false.
- `keyFieldPlaceholder(hasKey)` is `saved ✓` or `API key`.
- `nextAiPrefs(current, form)`: `{ provider, model, baseUrl: form.baseUrl || null, keyCiphertext }`. A non-empty `form.plaintext` requires `form.ciphertextFromEncrypt` and that value is stored. An empty plaintext keeps `current.keyCiphertext` only when `form.provider === current?.provider`; when the provider changed, `keyCiphertext` is `null` (a key belongs to the provider it was saved with; see the contract). `auto` always stores `keyCiphertext: null`. The plaintext never appears in the result.
- `settingsViewModel` takes an optional `formProvider`: when the form's selected provider differs from `prefs.provider`, `hasKey` is false, so the placeholder reads `API key` and Test connection sends `keyCiphertext: null` unless a new key is typed.
- `macStatus(detail: string | null)`: null or any other sentence → `Mac: not checked`. `auto: local reachable` prefix → `Mac: reachable`. `auto: local unreachable` prefix → `Mac: unreachable`.
- `traceSummary(row)`: `id`, `createdAt` from `created_at`, `outcome` from `data.outcome` or `unknown`, `costUsd` from `data.totals.cost_usd` or null. Each `model_call` event becomes `{ label: 'model', detail: '<model> · <stop_reason>' }`. Each `tool_call` becomes `{ label: name, detail: 'ok' }` or the `error_code`.
- `traceLoadMessage(failed: boolean): string | null` — failed → `Traces aren't available yet.`

- [ ] **Step 1: Write the failing tests**

```ts
const owner = settingsViewModel({ email: 'bobo.borenstein@gmail.com', prefs: null })
check('owner sees auto', owner.showAuto && owner.provider === 'auto')
const friend = settingsViewModel({ email: 'friend@example.com', prefs: { provider: 'auto', model: null, baseUrl: null, keyCiphertext: null } })
check('friend does not keep auto', friend.showAuto === false && friend.provider === 'claude')
check('owner can run auto without a saved key', hasUsableModel('bobo.borenstein@gmail.com', null) === true)
check('friend needs a key', hasUsableModel('friend@example.com', null) === false)
check('saved mark', keyFieldPlaceholder(true) === 'saved ✓')
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
const summary = traceSummary({
  id: 'run-1', created_at: '2026-10-21T18:00:00Z',
  data: { outcome: 'proposed', totals: { cost_usd: 0.0012 }, events: [
    { type: 'model_call', model: 'claude-haiku-5-5', stop_reason: 'end_turn' },
    { type: 'tool_call', name: 'search_tasks', ok: false, error_code: 'NOT_FOUND' },
  ] },
})
check('trace summary', summary.outcome === 'proposed' && summary.events[1].detail === 'NOT_FOUND')
check('trace error hidden', traceLoadMessage(true) === "Traces aren't available yet.")
```

- [ ] **Step 2: Run** — `npm run test:agent` → FAIL.
- [ ] **Step 3: Implement** `agentSettings.ts`. Import `ADMIN_EMAIL`; do not copy the address into a second constant.
- [ ] **Step 4: Run** — `npm run test:agent` → PASS.
- [ ] **Step 5: Commit + push** — `git commit -m "app: agent settings model and trace summary"`.

---

### Task 6: Diff card, chat panel, entry points

**Files:**
- Create: `src/components/AgentDiffCard.tsx`, `src/components/AgentChat.tsx`
- Modify: `src/lib/agentChat.ts` (`diffModel`), `src/components/Layout.tsx`, `src/components/CommandPalette.tsx`, `src/components/ToastContainer.tsx`, `src/App.tsx`
- Test: `scripts/test-agent.ts` (source pins) and `npm run typecheck`

**Interfaces:**
- `diffModel(changes, selectedTaskIds, tasks)` in `agentChat.ts` returns `{ creates, updates, deletes }`. `set_status` is an update. Each row has `taskId`, `title` (task title, else `beforeRaw.title` / `after.title`, else the id), `lines`, `warnings` (the warning `message` strings), `checked`. An `update` line is `` `${key}: ${show(beforeFields[key])} → ${show(patch[key])}` `` for each patch key. A `set_status` line is `` `status: ${before.status} → ${after.status}` `` plus `` `date: ${date}` `` when `date` is a string. A `create` line is `` `${key}: ${show(value)}` `` for every key of `after` except `id`. A `delete` line is the `reason` only. `show` is `JSON.stringify` for objects and arrays, and `String` otherwise (`null` becomes `"null"`).
- `AgentDiffCard` renders creates with `text-success`, updates with `text-p3`, and deletes inside a heading `Deletes` with `text-danger`. Checkboxes default from `checked`. `Approve` is disabled when no row is checked or the status is not `pending`. `Reject` shows while `pending`. `Undo` shows while `applied` and calls `undoMessage` (the same function the toast's Undo calls). After `undone` or `rejected` the card shows that status as text and no buttons.
- `AgentChat` is mounted once in `App.tsx` next to `CommandPalette`. Phone (`< md`): scrim plus a bottom sheet `fixed inset-x-0 bottom-0 z-40 max-h-[85dvh]`. `md` and up: `fixed right-0 top-0 z-40 h-dvh w-[400px]` side panel, no full-screen scrim. Header title `BoDay Agent`, button `New chat`. Empty thread copy `Ask about your tasks.` Every message renders its `text`. `proposed` also renders `AgentDiffCard`. While `sending`, show `Thinking…`. Spec forbids streaming; wait for the JSON body.
- Loading, every time the panel opens: `const { data } = await getSupabase().auth.getSession()` gives the user id, email, and session; then `const env = await loadUserPrefsEnvelope()` gives `env.ai ?? null` (for `hasUsableModel`) and `env.cache?.windows ?? []` (for the snapshot). Reloading on each open is how a change saved in Settings → AI reaches the panel. Until both resolve, the composer is disabled and the panel shows `Loading…`. Chat history is loaded with `loadChat(localStorage, userId)`.
- Sending: right before each `client.run` / `client.feedback` / `client.test` call, read the token again with `getSession()` and pass `data.session.access_token` (supabase-js refreshes it; a cached copy can be expired). No session → `panelMessage` gives `Sign in required.` and nothing is sent.
- The panel calls `panelMessage` and, when that returns a string, shows it instead of sending. The composer calls `canSend` before `client.run`. It does not call `fetch`. Option chips send that option as the next user message. `refused` and `failed` show `text` and `Trace ${traceId}`. Other outcomes do not show the trace id. A non-empty `parseWarnings` shows `` `${n} task(s) could not be read and were left unchanged.` `` An `AgentError` (any non-2xx, including `PAYLOAD_TOO_LARGE` and `INTERNAL_ERROR`) becomes a `fail` event whose text is the error's `message`.
- Approve, Reject, and Undo call `approveMessage`, `rejectMessage`, and `undoMessage` from `agentActions.ts` with `deps` built from the store (`applyAgentProposal`, `undoAgentProposal`), the client's `feedback`, the reducer's dispatch, and a `boday-toast` dispatcher. The component adds no other apply or feedback logic.
- `Layout` puts a BoDay Agent control in the header beside Search (wrap the two buttons in one `flex items-center gap-2` group; the bottom nav stays five tabs plus the add button). It uses `SparklesIcon`, the accessible name `BoDay Agent`, the visible text `BoDay Agent` with `hidden sm:inline` (like Search's label), and `agentEntry`. Disabled when `agentEntry` says so, and the hint is the returned `hint` (shown as `title` and as visible text when disabled). Click calls `openAgent()`.
- `CommandPalette` keeps the NLP `Create: "<query>"` row and its `BoDay AI` group exactly as they are. When `agentPaletteItem` is non-null it is the only row of a new group labelled `BoDay Agent`, placed right after the existing `BoDay AI` group. Insert it into the `all` array right after `aiAction` too, so arrow keys and Enter follow the rendered order. A disabled row does not call `openAgent`. An enabled row calls `close()` and `openAgent(query)`.
- `ToastContainer` passes `event.detail` through `normalizeToast` and, when `actionLabel` is set, renders a button with that label that runs `detail.onAction` and then dismisses the toast. Existing string events still render and still dismiss at 5 seconds.

- [ ] **Step 1: Write the failing tests**

Import `diffModel` from `../src/lib/agentChat.ts`. Reuse the `update` and `dentist` values from the Task 3 tests in this same file. `readFileSync` comes from `node:fs`.

```ts
const card = diffModel(
  [update, { op: 'delete', taskId: 'gym', reason: 'user asked', beforeRaw: { title: 'Gym' }, beforeCompletionsRaw: [], warnings: [{ code: 'EXTERNAL_TASK', message: 'Shared by someone else.' }] }],
  ['dentist'],
  [dentist],
)
check('update line', card.updates[0].lines[0] === 'scheduledDate: 2026-10-22 → 2026-10-21')
check('unchecked delete', card.deletes[0].checked === false && card.deletes[0].warnings[0] === 'Shared by someone else.')

const layout = readFileSync('src/components/Layout.tsx', 'utf8')
check('entry uses the helper', layout.includes('agentEntry') && layout.includes('openAgent') && layout.includes('BoDay Agent'))
const palette = readFileSync('src/components/CommandPalette.tsx', 'utf8')
check('palette uses the helper', palette.includes('agentPaletteItem') && palette.includes('label="BoDay Agent"'))
check('nlp create stays', palette.includes('Create:') && palette.includes('label="BoDay AI"'))
const today = readFileSync('src/views/TodayView.tsx', 'utf8')
check('plan-my-day button untouched', today.includes('Ask BoDay'))
const chat = readFileSync('src/components/AgentChat.tsx', 'utf8')
check('chat uses the gates', chat.includes('canSend') && chat.includes('hasUsableModel') && chat.includes('buildAgentSnapshot') && chat.includes('approveMessage') && chat.includes('await loadUserPrefsEnvelope()') && chat.includes('access_token') && !chat.includes('fetch('))
const diff = readFileSync('src/components/AgentDiffCard.tsx', 'utf8')
check('diff colors and actions', ['text-success', 'text-p3', 'text-danger', 'Deletes', 'Approve', 'Reject', 'Undo'].every((s) => diff.includes(s)))
```

- [ ] **Step 2: Run** — `npm run test:agent` → FAIL.
- [ ] **Step 3: Implement** the components. Match the header button classes already on Search (`rounded-full`, `border-border`, `text-xs`). Use `motion` the way `CommandPalette` does for the scrim. Wire `online` / `offline` window events to the `online` flag; start from `navigator.onLine`. `serviceConfigured` is `agentBaseUrl(import.meta.env) !== null`. `signedIn` is true only when `isSupabaseConfigured()` and `getSession()` returns a session with a user. `hasModel` is `hasUsableModel(email, prefs)`. When `panelMessage` returns a string, show that string and do not call the client. New chat clears the reducer and `chatKey(userId)` and does not call undo. The snapshot passed to `client.run` comes from `buildAgentSnapshot` with the store's tasks and completions, the awaited envelope's `cache?.windows ?? []`, `new Date()`, and `Intl.DateTimeFormat().resolvedOptions().timeZone`. Imports in `scripts/test-agent.ts` use the `.ts` suffix, same as `scripts/test-logic.ts`.
- [ ] **Step 4: Run** — `npm run test:agent && npm run typecheck` → PASS.
- [ ] **Step 5: Commit + push** — `git commit -m "app: BoDay Agent panel, diff card, and palette entry"`.

---

### Task 7: Settings → AI and the trace list

**Files:**
- Create: `src/components/AgentSettings.tsx`, `src/components/TraceViewer.tsx`
- Modify: `src/views/SettingsView.tsx`, `.env.example`
- Test: `scripts/test-agent.ts`

**Interfaces:**
- `SettingsView` renders `<AgentSettings email={accountEmail} />` after the Shabbat block. `AgentSettings` uses `settingsViewModel`, `keyFieldPlaceholder`, `nextAiPrefs`, and `macStatus`. The Auto radio is absent unless `showAuto`. Claude shows a model field and a password field. Custom shows URL, model, and an optional password field. The password value is component state and is cleared after a successful save. The view model is built with `formProvider` set to the radio currently selected, and the placeholder is `keyFieldPlaceholder(hasKey)`, so switching the radio away from the saved provider shows `API key`. The ciphertext is never an input value. Prefs load with `await loadUserPrefsEnvelope()` on mount.
- Save: if the password is non-empty, `client.encrypt` then `nextAiPrefs`. Then `mergeUserPrefsData({ ai })` with the full object (all four keys, so a deep merge and a replace give the same row). Then show the existing settings message style (`setMsg` is local to Settings; `AgentSettings` has its own one-line status `Saved.`).
- `Test connection` calls `client.test` with: a just-encrypted ciphertext when the password field is non-empty; else the saved ciphertext only when the selected provider equals the saved one; else `keyCiphertext: null`. It shows `detail`. For the owner it also shows `macStatus(detail)`. It does not generate a chat message.
- `TraceViewer` lists up to 20 rows from `supabase.from('agent_traces').select('id, created_at, data').order('created_at', { ascending: false }).limit(20)` when `isSupabaseConfigured()`. Otherwise it renders nothing. A failed query shows `traceLoadMessage(true)` and not the raw error. Each row uses `traceSummary`. Expanding a row shows the event labels.
- `.env.example` gains, without removing the Supabase lines:

```
# BoDay Agent (phase 5). Cloud Run URL, no trailing slash. Empty disables BoDay Agent.
# Set it in your local .env before `npm run build && npx wrangler deploy`.
VITE_AGENT_URL=
```

- [ ] **Step 1: Write the failing tests**

```ts
const settings = readFileSync('src/components/AgentSettings.tsx', 'utf8')
check('settings copy', settings.includes('Test connection') && settings.includes('keyFieldPlaceholder') && settings.includes('macStatus'))
const view = readFileSync('src/views/SettingsView.tsx', 'utf8')
check('settings mounts the section', view.includes('AgentSettings'))
const traces = readFileSync('src/components/TraceViewer.tsx', 'utf8')
check('traces table', traces.includes('agent_traces') && traces.includes('traceSummary') && traces.includes('traceLoadMessage'))
const env = readFileSync('.env.example', 'utf8')
check('env example', env.includes('VITE_AGENT_URL=') && env.includes('VITE_SUPABASE_URL='))
```

- [ ] **Step 2: Run** — `npm run test:agent` → FAIL.
- [ ] **Step 3: Implement.** Section markup matches `ShabbatSettings` (`text-xs font-semibold uppercase tracking-wide text-faint`). Do not put the API key in `localStorage` or in the chat state.
- [ ] **Step 4: Run** — `npm run test:agent && npm run typecheck` → PASS.
- [ ] **Step 5: Commit + push** — `git commit -m "app: Settings AI section and trace list"`.

---

### Task 8: Browser pass and the PR

**Files:** none new, unless the pass finds a bug. Fix it in the component that owns it and add a failing `check` first.

- [ ] **Step 1: Run the scripts** — `npm run test:agent && npm run test:logic && npm run typecheck` → PASS.
- [ ] **Step 2: Browser pass.** `npm run dev`. Walk these with the devtools network panel open. There is no service in this track, so the network assertion is that BoDay Agent does not request `/agent/run` while offline or while `VITE_AGENT_URL` is empty.

  At 375px and at 1280px:
  - Header shows BoDay Agent beside Search (icon only at 375px, icon plus `BoDay Agent` at 1280px). The bottom nav still has Today, Tasks, the add button, Calendar, Stats, Settings.
  - Today's existing `Ask BoDay` (plan my day) button still opens the plan sheet, unchanged.
  - With the URL empty, opening BoDay Agent shows `BoDay AI isn't configured on this build.` and no fetch to `/agent/run`.
  - Devtools offline: the BoDay Agent control is disabled and the visible hint is `needs internet`. Typing a sentence in the palette shows `BoDay Agent: <that sentence>` with hint `needs internet`, and Enter on that row does not open a request.
  - Palette still shows `Create: "<query>"` under `BoDay AI`, and choosing it still adds a local task.
  - Settings shows an AI section. Signed out, or signed in as a non-admin, there is no Auto control. The password field is empty. Switching the provider radio changes the key placeholder to `API key`.
  - At 375px the panel is a bottom sheet. At 1280px it is a right-hand column. New chat clears the thread.
  - A string toast still appears and still goes away after about 5 seconds: on Today, open `Ask BoDay` and run its "defer carried" action, which dispatches a string `boday-toast`.

  `VITE_AGENT_URL` pointing at a real service is an **owner step**. Do not block the PR on it. Apply, undo, and the diff lines are covered by `npm run test:agent`.
- [ ] **Step 3: Owner step — production URL.** Leave unchecked. The owner puts `VITE_AGENT_URL=<Cloud Run URL from the phase 5a deploy, no trailing slash>` in the repo-root `.env` on the Mac and runs `npm run build && npx wrangler deploy`. Nothing is set on Cloudflare; the value is baked in at build time.
- [ ] **Step 4: Commit any fixes, push, open the PR**

PR into `main`, title `Agent phase 5b: app chat UI`. Do not merge. In the body, name the browser cases you could not run.
