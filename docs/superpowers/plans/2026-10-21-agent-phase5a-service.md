# BoDay Agent — Phase 5a: FastAPI Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stateless FastAPI service that verifies a Supabase JWT, runs the existing agent loop over the snapshot the app sends, and returns one outcome plus the proposed changes, with per-user encrypted provider keys, an SSRF guard, and a trace row in Postgres.

**Architecture:** New package `agent/boday_agent/server/` adapts HTTP to the phase 2 loop. It does not reimplement tools, the loop, or providers. `run_agent` stays the only place a model is called. The service never reads the user's task tables; the app posts the snapshot and applies the proposal itself. Traces go out through a dedicated Postgres role that can insert rows and call one feedback function. It cannot select, update, or delete.

**Tech Stack:** Python ≥3.12, FastAPI, uvicorn, PyJWT with its `crypto` extra (ES256 / RS256), `cryptography` (AES-GCM), psycopg, the existing `httpx` 0.28 / `httpcore` 1.0 / Pydantic / `anthropic` stack. Deploy target is Cloud Run (see `agent/DEPLOY.md`).

**Spec:** `docs/superpowers/specs/2026-10-20-boday-agent-design.md` (§2 Agent loop, §3 Model providers and Security, §4 Tracing, §5 Eval harness — traces for app runs only, do not rebuild the harness, §7 Hosting, §8 phase 5 service half). Payload shapes: `agent/README.md` "Payload contract".

**Prerequisite:** Phase 2 is on `main` (`agent/boday_agent/loop.py` exists). Branch `agent/phase5a-service` from that `main`. Do not wait for phase 5b, and do not import anything under `src/`.

**Parallel app plan:** `docs/superpowers/plans/2026-10-21-agent-phase5b-app.md`. The API contract section below is copied verbatim into that plan. If you change it, change both files in the same commit.

## Global Constraints

- Branch `agent/phase5a-service` from `main`. Commands run from `agent/` unless a step says otherwise. Push after every task. PR title at the end: `Agent phase 5a: FastAPI service`. Do not merge.
- Do not edit `src/`, `docs/superpowers/specs/`, existing plan files, `.github/workflows/agent.yml`, `boday_agent/loop.py`, `boday_agent/prompt.py`, `boday_agent/tracing.py`, `boday_agent/providers/`, `boday_agent/tools/`, or `boday_agent/domain/`. Call them. `Snapshot.from_app` already guards against non-dict input (Track E); this service still rejects a non-object snapshot before calling `from_app`, so the error is a contract `400`.
- Every route handler is a plain `def`, never `async def`. `run_agent` and the providers block. With `max-instances=1`, an `async` handler that calls them would stall every other request for up to 90 seconds. FastAPI runs plain `def` handlers in its thread pool.
- The loop's rules still hold: five outcomes; `failed` and `asked` return `changes == []`; limits stay on `LoopLimits` (8 model calls, 10 tool calls per step, 60s, 90s when `provider.is_local`). Do not retune them.
- Model ids, when a default is required, are `claude-haiku-5-5` only. Never invent a local model id. The owner's Mac model comes from `BODAY_LOCAL_MODEL`.
- Secrets never appear in traces, logs, exceptions, or git. Unit tests never open a socket and never call a model. `uv.lock` changes only by running `uv add` / `uv lock`.
- Commit messages end with a blank line and `Co-Authored-By: <model name> <noreply@...>`.
- A step whose title contains **owner step** needs the owner's GCP, Supabase, or Cloudflare account. Do not perform it. Leave the box unchecked and name it in the PR.
- Spec §5 (eval cases, grader, cassettes, baseline) is out of scope. So are streaming, MCP, task sharing, a metrics dashboard, and writing the React app. Approval, partial-approval, and undo rates are computed later from `data.feedback`; this phase only records the events.

## Review Focus

- **Custom URL that redirects to a metadata or private address** — one connection, to the pinned public IP, then stop. The redirect is not followed. Test in Task 4.
- **Ciphertext encrypted for user A presented with user B's JWT** — decrypt fails, the provider is not built, the plaintext is not logged. Test in Task 2 and Task 8.
- **Non-owner sends `provider: auto`** — `403 AUTO_OWNER_ONLY`. The server Anthropic key and the Cloudflare Access token are not sent anywhere. Test in Task 8.
- **The model call fails** — HTTP 200, `outcome: "failed"`, `changes: []`, and a trace row still exists. Test in Task 8.
- **`Authorization` or the encrypt plaintext lands in a log line or a trace** — neither may. Test in Task 7 and Task 8.
- **A real Supabase token** — the project's JWKS publishes an ES256 key. ES256 and RS256 pass in JWKS mode; HS256 never does in that mode. Test in Task 3.
- **A custom endpoint answers with a huge body, or resolves to a NAT64 / 6to4 wrapped private address** — the body stops at 2 MiB and the run fails closed; the wrapped address is rejected. Test in Task 4.
- **An unexpected exception** — `500 INTERNAL_ERROR` in the contract shape, with CORS headers, and no secret in the body. Test in Task 7.

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

- Create `agent/boday_agent/server/__init__.py` — empty package marker.
- Create `agent/boday_agent/server/contract.py` — request and response models, `error_body`.
- Create `agent/boday_agent/server/crypto.py` — AES-GCM bound to the user id.
- Create `agent/boday_agent/server/auth.py` — JWT verify, `User`, `is_owner`.
- Create `agent/boday_agent/server/ssrf.py` — resolve, reject, pin the TCP address.
- Create `agent/boday_agent/server/providers.py` — settings to a `Provider`, plus connection tests.
- Create `agent/boday_agent/server/traces.py` — `MemorySink`, `PostgresSink`.
- Create `agent/boday_agent/server/app.py` — `create_app`, routes.
- Create `agent/sql/agent_traces.sql` — table, RLS, `agent_tracer`, feedback function.
- Create `agent/Dockerfile`, `agent/.dockerignore`, `agent/DEPLOY.md`.
- Create `agent/tests/fixtures/api_contract_run.json`, `api_contract_response.json`, and `agent/tests/test_server_*.py`.
- Modify `agent/pyproject.toml` and `agent/uv.lock` only through `uv add`.

The spec's repo sketch puts `api.py` and `crypto.py` next to `loop.py`, and a Postgres sink inside `tracing.py`. This plan keeps the HTTP, crypto, SSRF, and database role inside `server/` so the existing modules stay put. Noted for the plans PR.

---

### Task 1: Contract models and the example JSON

**Files:**
- Create: `agent/boday_agent/server/__init__.py`, `agent/boday_agent/server/contract.py`
- Create: `agent/tests/fixtures/api_contract_run.json`, `agent/tests/fixtures/api_contract_response.json`
- Test: `agent/tests/test_server_contract.py`

**Interfaces:**
- Produces (`contract.py`):
  - `error_body(code: str, message: str) -> dict` returning `{"error": {"code": code, "message": message}}`.
  - `HistoryItem` with `role`, `text` (max 4000), `proposal: list[dict] | None = None`, `proposal_status` alias `proposalStatus` (the five statuses or null).
  - `RunSettings` with `provider: Literal["auto", "claude", "custom"]`, `model: str | None = None`, `base_url` alias `baseUrl`, `key_ciphertext` alias `keyCiphertext`. `populate_by_name=True`. Extra keys ignored.
  - `RunRequest` with `message` (1..4000), `history: list[HistoryItem]`, `snapshot: dict`, `settings: RunSettings`. A snapshot that is not a dict fails validation.
  - `FeedbackRequest` with `run_id` alias `runId`, `event: Literal["approve", "reject", "undo"]`, `task_ids` alias `taskIds` (`list[str]`, may be empty).
  - `EncryptRequest` with `plaintext: str` (1..500).
  - `run_settings_error(settings: RunSettings, *, is_owner: bool) -> tuple[int, str, str] | None` — `None` when the settings are usable. Otherwise `(status, code, message)` from the contract table: non-owner `auto` → 403 `AUTO_OWNER_ONLY`; `claude` with no ciphertext, or `custom` missing `baseUrl` or `model` → 403 `MODEL_NOT_CONFIGURED`. Does not decrypt and does not resolve DNS.

- [x] **Step 1: Write the failing tests**

Copy the `POST /agent/run` request example and the HTTP 200 response example from the API contract section into the two fixture files, byte for byte inside the JSON (pretty-printed the same way).

```python
def test_run_request_parses_camel_case_contract():
    raw = json.loads(Path("tests/fixtures/api_contract_run.json").read_text())
    req = RunRequest.model_validate(raw)
    assert req.history[0].proposal_status == "applied"
    assert req.history[0].proposal[0]["beforeFields"] == {"scheduledDate": "2026-10-22"}
    assert req.settings.provider == "claude" and req.settings.model == "claude-haiku-5-5"
    assert req.snapshot["timezone"] == "America/New_York"
    with pytest.raises(ValidationError):
        RunRequest.model_validate({**raw, "snapshot": ["nope"]})
    with pytest.raises(ValidationError):
        RunRequest.model_validate({**raw, "message": ""})

def test_feedback_encrypt_and_settings_rules():
    fb = FeedbackRequest.model_validate(
        {"runId": "run-1", "event": "approve", "taskIds": []}
    )
    assert fb.run_id == "run-1" and fb.task_ids == []
    with pytest.raises(ValidationError):
        EncryptRequest.model_validate({"plaintext": ""})
    with pytest.raises(ValidationError):
        EncryptRequest.model_validate({"plaintext": "x" * 501})
    owner = RunSettings.model_validate({"provider": "auto", "model": None, "baseUrl": None, "keyCiphertext": None})
    assert run_settings_error(owner, is_owner=True) is None
    assert run_settings_error(owner, is_owner=False)[1] == "AUTO_OWNER_ONLY"
    claude = RunSettings.model_validate({"provider": "claude", "model": None, "baseUrl": None, "keyCiphertext": None})
    assert run_settings_error(claude, is_owner=True)[1] == "MODEL_NOT_CONFIGURED"
    custom = RunSettings.model_validate({"provider": "custom", "model": "m", "baseUrl": "https://llm.example/v1", "keyCiphertext": None})
    assert run_settings_error(custom, is_owner=False) is None

def test_response_fixture_has_the_contract_keys():
    body = json.loads(Path("tests/fixtures/api_contract_response.json").read_text())
    assert set(body) == {"traceId", "outcome", "text", "changes", "question", "options", "parseWarnings"}
    assert error_body("UNAUTHORIZED", "Sign in required.") == {
        "error": {"code": "UNAUTHORIZED", "message": "Sign in required."}
    }
```

- [x] **Step 2: Run** — `uv run pytest tests/test_server_contract.py -q` → FAIL (`contract` is not a module).
- [x] **Step 3: Implement** `contract.py` as in Interfaces. Validators reject a non-dict snapshot and the length limits. No FastAPI in this task.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: phase 5a HTTP contract models"`.

---

### Task 2: AES-GCM key encryption

**Files:**
- Create: `agent/boday_agent/server/crypto.py`
- Modify: `agent/pyproject.toml`, `agent/uv.lock` (`uv add cryptography`)
- Test: `agent/tests/test_server_crypto.py`

**Interfaces:**
- Produces:
  - `class DecryptError(Exception)` whose `args[0]` is the fixed string `ciphertext rejected`.
  - `class Encryptor` with `__init__(self, key: bytes)`. `key` must be 32 bytes, else `ValueError`.
  - `encrypt(self, plaintext: str, *, user_id: str) -> str` — standard base64 (ASCII string) of `bytes([1]) + nonce(12) + aes_gcm_ct_and_tag`. Associated data is `user_id.encode()`. A new random nonce every call.
  - `decrypt(self, ciphertext: str, *, user_id: str) -> str` — the inverse. Any failure (bad base64, wrong version byte, truncated blob, bad tag, wrong user id) raises `DecryptError` and nothing else.
  - `encryptor_from_b64(value: str) -> Encryptor` — decodes standard base64 and requires 32 bytes.

- [x] **Step 1: Write the failing tests**

```python
def test_round_trip_is_bound_to_the_user_and_not_deterministic():
    enc = Encryptor(b"k" * 32)
    a = enc.encrypt("sk-ant-example", user_id="user-a")
    b = enc.encrypt("sk-ant-example", user_id="user-a")
    assert a != b
    assert enc.decrypt(a, user_id="user-a") == "sk-ant-example"
    assert "sk-ant-example" not in a

def test_wrong_user_tamper_and_version_fail_closed():
    enc = Encryptor(b"k" * 32)
    token = enc.encrypt("sk-ant-example", user_id="user-a")
    with pytest.raises(DecryptError, match="ciphertext rejected"):
        enc.decrypt(token, user_id="user-b")
    raw = bytearray(base64.b64decode(token))
    raw[-1] ^= 1
    with pytest.raises(DecryptError):
        enc.decrypt(base64.b64encode(bytes(raw)).decode(), user_id="user-a")
    raw = bytearray(base64.b64decode(token))
    raw[0] = 2
    with pytest.raises(DecryptError):
        enc.decrypt(base64.b64encode(bytes(raw)).decode(), user_id="user-a")

def test_key_length():
    with pytest.raises(ValueError):
        Encryptor(b"short")
    assert isinstance(encryptor_from_b64(base64.b64encode(b"k" * 32).decode()), Encryptor)
```

- [x] **Step 2: Run** — `uv run pytest tests/test_server_crypto.py -q` → FAIL.
- [x] **Step 3: Implement.** `uv add cryptography`. Use `AESGCM` from `cryptography.hazmat`. Catch every crypto and decoding exception and raise `DecryptError("ciphertext rejected")` from None, so the original message cannot leak.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: AES-GCM key encryption bound to the user id"`.

---

### Task 3: Supabase JWT auth

**Files:**
- Create: `agent/boday_agent/server/auth.py`
- Modify: `agent/pyproject.toml`, `agent/uv.lock` (`uv add "pyjwt[crypto]"`; ES256 and RS256 need the `crypto` extra)
- Test: `agent/tests/test_server_auth.py`

**Interfaces:**
- Produces:
  - `class User(BaseModel)`: `id: str`, `email: str | None = None`.
  - `class AuthError(Exception)` with fixed `args[0] == "unauthorized"`.
  - `is_owner(user: User, admin_email: str) -> bool` — `user.email == admin_email`. Missing email is false. No case folding.
  - `class TokenVerifier` with `__init__(self, *, hs256_secret: str | None, jwks_get: Callable[[], dict] | None, issuer: str | None = None, now: Callable[[], int] | None = None)`. `jwks_get` returns a JWKS dict `{"keys": [...]}`. When `jwks_get` is not None it is the only accepted mode: `algorithms=["ES256", "RS256"]`, key chosen by the token header's `kid` (build each key with `jwt.PyJWK(jwk_dict)`). Otherwise `algorithms=["HS256"]` with `hs256_secret`. Both None raises `ValueError` at init.
  - `verify(self, header_value: str | None) -> User`. Accepts `Bearer <jwt>` with one space. Requires `sub` (non-empty string), `aud == "authenticated"`, an `exp` in the future (`now()` is unix seconds; default `time.time`), and `iss == issuer` when `issuer` is set. A `kid` that is not in the JWKS, any other shape, algorithm, signature, issuer, or audience raises `AuthError`.
  - `cached_jwks(url: str, *, ttl_s: float = 600, timeout_s: float = 3.0, get=None, clock=time.monotonic) -> Callable[[], dict]` — the production `jwks_get`. Fetches `url` with `httpx.get(url, timeout=timeout_s)` (or the injected `get`), keeps the JSON for `ttl_s` seconds, and on a fetch error keeps serving the last good copy. With no good copy yet, a fetch error raises `AuthError`. `verify` calls `jwks_get` once per token and, when the `kid` is missing, asks for one forced refresh (`jwks_get.refresh()`, an attribute on the returned callable) before rejecting.

- [x] **Step 1: Write the failing tests**

```python
def _hs(secret, **claims):
    body = {"sub": "user-1", "aud": "authenticated", "email": "bobo.borenstein@gmail.com", "exp": 9999999999, **claims}
    return "Bearer " + jwt.encode(body, secret, algorithm="HS256")

def test_hs256_round_trip_and_owner_check():
    v = TokenVerifier(hs256_secret="test-secret", jwks_get=None)
    user = v.verify(_hs("test-secret"))
    assert user.id == "user-1" and is_owner(user, "bobo.borenstein@gmail.com")
    assert is_owner(User(id="user-1", email=None), "bobo.borenstein@gmail.com") is False
    assert is_owner(user, "Bobo.Borenstein@gmail.com") is False

def test_rejects_expired_audience_none_and_wrong_secret():
    v = TokenVerifier(hs256_secret="test-secret", jwks_get=None, now=lambda: 1_000)
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", exp=500))
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", aud="anon"))
    with pytest.raises(AuthError):
        v.verify("Bearer " + jwt.encode({"sub": "u", "aud": "authenticated", "exp": 9999999999}, "", algorithm="none"))
    with pytest.raises(AuthError):
        v.verify(_hs("other-secret"))
    with pytest.raises(AuthError):
        v.verify(None)
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", sub=""))

ISSUER = "https://example.supabase.co/auth/v1"

def _jwks_token(private_key, algorithm, kid, **claims):
    body = {"sub": "user-9", "aud": "authenticated", "email": "a@b.c", "exp": 9999999999, "iss": ISSUER, **claims}
    return "Bearer " + jwt.encode(body, private_key, algorithm=algorithm, headers={"kid": kid})

def test_jwks_mode_accepts_es256_and_rs256_and_rejects_hs256():
    ec_key = ec.generate_private_key(ec.SECP256R1())
    ec_jwk = {**json.loads(ECAlgorithm.to_jwk(ec_key.public_key())), "kid": "ec1", "alg": "ES256"}
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    rsa_jwk = {**json.loads(RSAAlgorithm.to_jwk(rsa_key.public_key())), "kid": "rs1", "alg": "RS256"}
    v = TokenVerifier(hs256_secret="test-secret", jwks_get=lambda: {"keys": [ec_jwk, rsa_jwk]}, issuer=ISSUER)
    assert v.verify(_jwks_token(ec_key, "ES256", "ec1")).id == "user-9"
    assert v.verify(_jwks_token(rsa_key, "RS256", "rs1")).id == "user-9"
    with pytest.raises(AuthError):
        v.verify(_hs("test-secret", iss=ISSUER))
    with pytest.raises(AuthError):
        v.verify(_jwks_token(ec_key, "ES256", "unknown-kid"))
    with pytest.raises(AuthError):
        v.verify(_jwks_token(ec_key, "ES256", "ec1", iss="https://evil.example/auth/v1"))

def test_cached_jwks_keeps_the_last_good_copy():
    calls = []
    clock = [0.0]
    def get(url, timeout):
        calls.append(url)
        if len(calls) == 2:
            raise httpx.ConnectError("down")
        return httpx.Response(200, json={"keys": [{"kid": str(len(calls))}]}, request=httpx.Request("GET", url))
    jwks = cached_jwks("https://example.supabase.co/jwks", ttl_s=600, get=get, clock=lambda: clock[0])
    assert jwks()["keys"][0]["kid"] == "1"
    assert jwks()["keys"][0]["kid"] == "1" and len(calls) == 1
    clock[0] = 601.0
    assert jwks()["keys"][0]["kid"] == "1" and len(calls) == 2
    jwks.refresh()
    assert jwks()["keys"][0]["kid"] == "3"
```

Test imports: `jwt`, `httpx`, `json`, `pytest`, `from cryptography.hazmat.primitives.asymmetric import ec, rsa`, `from jwt.algorithms import ECAlgorithm, RSAAlgorithm`, and `AuthError`, `TokenVerifier`, `User`, `cached_jwks`, `is_owner` from `boday_agent.server.auth`.

- [x] **Step 2: Run** — `uv run pytest tests/test_server_auth.py -q` → FAIL.
- [x] **Step 3: Implement.** `uv add "pyjwt[crypto]"`. Read the header with `jwt.get_unverified_header` only to find `kid` and `alg`. In JWKS mode, reject unless `alg` is `ES256` or `RS256`, then call `jwt.decode(token, key, algorithms=[alg], audience="authenticated", issuer=issuer)` where `alg` is one of those two and `key` comes from the JWKS entry with that `kid`. In HS256 mode, `algorithms=["HS256"]`. Never pass an HS algorithm in JWKS mode, and never pass ES/RS in HS mode. Wrap every PyJWT error in `AuthError("unauthorized")` from None.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: verify Supabase access tokens"`.

---

### Task 4: SSRF guard

**Files:**
- Create: `agent/boday_agent/server/ssrf.py`
- Test: `agent/tests/test_server_ssrf.py`

**Interfaces:**
- Produces:
  - `class UrlRejected(Exception)` with a fixed message `url rejected` (no host, no IP).
  - `@dataclass(frozen=True) class PinnedUrl` with `base_url: str`, `host: str`, `port: int`, `ip: str`.
  - `check_base_url(url: str, *, resolve: Callable[[str], list[str]], resolve_timeout_s: float = 2.0) -> PinnedUrl`.
    - Require `https`. Reject userinfo, an empty host, a hostname of `metadata.google.internal`, and an all-digit hostname.
    - If the host is already an IP, do not call `resolve`. Otherwise call `resolve(host)` and treat a timeout (`resolve_timeout_s`) or any exception as `UrlRejected`.
    - An address is allowed only when `_allowed(ip)` is true, and every returned address must be allowed. One disallowed address among good ones rejects the whole set. `_allowed(ip)`:
      1. Unwrap first. IPv6 with `ipv4_mapped` → check that IPv4 address. `sixtofour` (`2002::/16`) → check the embedded IPv4. `teredo` → check both embedded IPv4 addresses. NAT64 `64:ff9b::/96` and `64:ff9b:1::/48` → check the low 32 bits as IPv4. Python's `is_global` is true for `64:ff9b::a00:1` (that is 10.0.0.1), so this unwrap is required, not optional.
      2. Then allow only when `ip.is_global` is true and `ip.is_multicast` is false. This one rule rejects loopback, unspecified, link-local, RFC1918, CGNAT `100.64.0.0/10`, IPv6 unique-local, benchmarking `198.18.0.0/15`, and the documentation ranges (`203.0.113.0/24` included). Do not hand-write a private-range list instead.
    - Otherwise pin the first address. `port` is the URL port or 443. `base_url` is the URL with at most one trailing slash removed. The path is kept (`/v1` stays).
  - `class ResponseTooLarge(Exception)` with fixed message `response too large`. It is deliberately not an `httpx.TransportError`, so `OpenAICompatProvider` does not retry it; `run_agent` turns it into `outcome: "failed"`.
  - `class CappedTransport(httpx.BaseTransport)` with `__init__(self, inner: httpx.BaseTransport, max_bytes: int = 2_097_152)`. `handle_request` calls `inner`, raises `ResponseTooLarge` at once when `Content-Length` is larger than `max_bytes`, and otherwise wraps `response.stream` in a counting stream that raises `ResponseTooLarge` as soon as the total passes `max_bytes`. `close()` closes `inner`.
  - `class PinnedBackend(httpcore.NetworkBackend)` — `connect_tcp(host, port, timeout=None, local_address=None, socket_options=None)` raises `UrlRejected` when `host != pinned.host` or `port != pinned.port`, otherwise returns `httpcore.SyncBackend().connect_tcp(pinned.ip, port, timeout, local_address, socket_options)`. `connect_unix_socket` raises `UrlRejected`. `sleep` delegates to `SyncBackend`.
  - `class PinnedHTTPTransport(httpx.HTTPTransport)` — `__init__(self, pinned)` calls `super().__init__()` (TLS verification on, default certificates) and then replaces `self._pool` with `httpcore.ConnectionPool(ssl_context=httpx.create_ssl_context(), network_backend=PinnedBackend(pinned))`. httpx 0.28 has no public parameter for a network backend, so this one private attribute is the hook; pin it with the test below. The URL host is unchanged, so TLS SNI, certificate checking, and the `Host` header all stay on `pinned.host`. A closed pool can open new connections again, so one transport serves every `complete()` call of a run.
  - `pinning_transport(pinned: PinnedUrl, *, max_response_bytes: int = 2_097_152) -> httpx.BaseTransport` returns `CappedTransport(PinnedHTTPTransport(pinned), max_response_bytes)`. Every client built over it uses `follow_redirects=False` (the httpx default; never turn it on). Build a separate transport for the `select_provider` health check, because `select_provider` closes the client it opens.
  - `default_resolve(host: str) -> list[str]` — `socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)`, the address of each entry, used only outside unit tests. Not used by the tests below.

- [x] **Step 1: Write the failing tests**

```python
PUBLIC = "8.8.8.8"  # a truly global address; resolve is stubbed, so no socket opens

def test_pins_a_public_https_host_and_a_public_ip_literal():
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    assert (pinned.ip, pinned.host, pinned.port, pinned.base_url) == (
        PUBLIC, "llm.example", 443, "https://llm.example/v1",
    )
    pinned = check_base_url("https://llm.example:8443/v1/", resolve=lambda host: [PUBLIC])
    assert pinned.port == 8443 and pinned.base_url == "https://llm.example:8443/v1"
    pinned = check_base_url(f"https://{PUBLIC}/v1", resolve=lambda host: (_ for _ in ()).throw(AssertionError(host)))
    assert pinned.ip == PUBLIC

@pytest.mark.parametrize("url,ips", [
    ("http://llm.example/v1", [PUBLIC]),
    ("ftp://llm.example/v1", [PUBLIC]),
    ("https://user:pass@llm.example/v1", [PUBLIC]),
    ("https://127.0.0.1/v1", None),
    ("https://10.0.0.8/v1", None),
    ("https://192.168.0.2/v1", None),
    ("https://172.16.5.5/v1", None),
    ("https://169.254.169.254/", None),
    ("https://100.64.0.1/v1", None),
    ("https://0.0.0.0/", None),
    ("https://224.0.0.1/", None),
    ("https://2130706433/", None),
    ("https://metadata.google.internal/", [PUBLIC]),
    ("https://localhost/v1", ["127.0.0.1"]),
    ("https://llm.example/v1", ["10.1.2.3"]),
    ("https://llm.example/v1", ["169.254.1.1"]),
    ("https://llm.example/v1", ["::1"]),
    ("https://llm.example/v1", ["fe80::1"]),
    ("https://llm.example/v1", ["fd00::1"]),
    ("https://llm.example/v1", ["::ffff:127.0.0.1"]),
    ("https://llm.example/v1", ["::ffff:169.254.169.254"]),
    ("https://llm.example/v1", ["64:ff9b::a00:1"]),        # NAT64 of 10.0.0.1; is_global alone says True
    ("https://llm.example/v1", ["64:ff9b::a9fe:a9fe"]),    # NAT64 of 169.254.169.254
    ("https://llm.example/v1", ["2002:a00:1::"]),          # 6to4 of 10.0.0.1
    ("https://llm.example/v1", ["203.0.113.10"]),          # documentation range
    ("https://llm.example/v1", ["198.18.0.1"]),            # benchmarking range
    ("https://llm.example/v1", ["240.0.0.1"]),             # reserved
    ("https://llm.example/v1", [PUBLIC, "10.0.0.1"]),
    ("https://llm.example/v1", []),
])
def test_rejects(url, ips):
    def resolve(host):
        if ips is None:
            raise AssertionError(f"should not resolve {host}")
        return ips
    with pytest.raises(UrlRejected, match="url rejected"):
        check_base_url(url, resolve=resolve)

def test_slow_resolver_is_rejected():
    def slow(host):
        time.sleep(5)
        return ["8.8.8.8"]
    with pytest.raises(UrlRejected):
        check_base_url("https://llm.example/v1", resolve=slow, resolve_timeout_s=0.01)

# Regression pin: this passes before Task 4's code, because OpenAICompatProvider
# already treats a 302 as a non-2xx error. Keep it so nobody turns redirects on.
def test_redirect_is_not_followed():
    calls = []
    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})
    provider = OpenAICompatProvider(
        "https://llm.example/v1", "m", is_local=False, transport=httpx.MockTransport(handler),
    )
    with pytest.raises(ProviderError):
        provider.complete("sys", [UserText(text="hi")], [], timeout_s=5)
    assert len(calls) == 1

def test_transport_connects_to_the_pinned_ip(monkeypatch):
    seen = {}
    def fake_create_connection(address, *args, **kwargs):
        seen["address"] = address
        raise OSError("stop")
    monkeypatch.setattr(socket, "create_connection", fake_create_connection)
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    transport = pinning_transport(pinned)
    with httpx.Client(transport=transport, follow_redirects=False) as client:
        with pytest.raises(httpx.HTTPError):
            client.get("https://llm.example/v1/models")
    assert seen["address"][0] == PUBLIC
    assert seen["address"][0] != "llm.example"

def test_one_transport_serves_every_model_call_of_a_run(monkeypatch):
    seen = []
    def fake_create_connection(address, *args, **kwargs):
        seen.append(address[0])
        raise OSError("stop")
    monkeypatch.setattr(socket, "create_connection", fake_create_connection)
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    provider = OpenAICompatProvider(
        pinned.base_url, "m", is_local=False, transport=pinning_transport(pinned), sleep=lambda s: None,
    )
    for _ in range(2):  # each complete() opens and closes its own httpx.Client
        with pytest.raises(ProviderError):
            provider.complete("sys", [UserText(text="hi")], [], timeout_s=5)
    assert len(seen) >= 2 and set(seen) == {PUBLIC}

def test_response_body_is_capped():
    big = b"x" * 64
    capped = CappedTransport(httpx.MockTransport(lambda r: httpx.Response(200, content=big)), max_bytes=10)
    with httpx.Client(transport=capped) as client:
        with pytest.raises(ResponseTooLarge, match="response too large"):
            client.get("https://llm.example/v1/models")
    def chunked(request):
        return httpx.Response(200, stream=httpx.ByteStream(big), headers={"transfer-encoding": "chunked"})
    with httpx.Client(transport=CappedTransport(httpx.MockTransport(chunked), max_bytes=10)) as client:
        with pytest.raises(ResponseTooLarge):
            client.get("https://llm.example/v1/models")
    ok = CappedTransport(httpx.MockTransport(lambda r: httpx.Response(200, json={"data": []})), max_bytes=1000)
    with httpx.Client(transport=ok) as client:
        assert client.get("https://llm.example/v1/models").json() == {"data": []}

def test_backend_refuses_a_different_host():
    pinned = check_base_url("https://llm.example/v1", resolve=lambda host: [PUBLIC])
    with pytest.raises(UrlRejected):
        PinnedBackend(pinned).connect_tcp("evil.example", 443)
```

Test imports: `socket`, `time`, `httpx`, `pytest`, `OpenAICompatProvider` from `boday_agent.providers.openai_compat`, `ProviderError` and `UserText` from `boday_agent.providers.base`, and everything Task 4 produces from `boday_agent.server.ssrf`.

- [x] **Step 2: Run** — `uv run pytest tests/test_server_ssrf.py -q` → FAIL (`test_redirect_is_not_followed` is the one that already passes).
- [x] **Step 3: Implement** as in Interfaces. Classify with `ipaddress.ip_address`. Wrap `resolve` in a daemon thread and `join(resolve_timeout_s)`. `PinnedHTTPTransport` swaps `self._pool` as described; do not reimplement httpx's request conversion. Do not turn redirects on anywhere this transport is used.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: SSRF guard pins the resolved address"`.

---

### Task 5: Provider factory and connection test

**Files:**
- Create: `agent/boday_agent/server/providers.py`
- Test: `agent/tests/test_server_providers.py`

**Interfaces:**
- Consumes: `Encryptor`, `DecryptError`, `check_base_url`, `pinning_transport`, `UrlRejected`, `AnthropicProvider`, `OpenAICompatProvider`, `select_provider`.
- Produces:
  - `class ProviderBuildError(Exception)` with `code: str` (`URL_REJECTED` or `KEY_DECRYPT_FAILED`) and `message: str` (the contract message for that code).
  - `build_provider(settings: RunSettings, *, user_id: str, encryptor: Encryptor | None, anthropic_api_key: str | None, local_base_url: str | None, local_model: str | None, cf_access_client_id: str | None, cf_access_client_secret: str | None, resolve, transport_for_tests=None) -> tuple[Provider, str]`.
    - `claude`: decrypt `key_ciphertext` for `user_id`. Failure → `ProviderBuildError("KEY_DECRYPT_FAILED", ...)`. Model is `settings.model or "claude-haiku-5-5"`. Return `AnthropicProvider(model, api_key=plaintext)`, reason `"explicit"`. `is_local` stays false. `plaintext` is never `None` or empty here (assert it): `anthropic.Anthropic(api_key=None)` silently reads the server's `ANTHROPIC_API_KEY`, which would bill the owner for another user's run.
    - `custom`: `check_base_url(settings.base_url)`. Failure → `ProviderBuildError("URL_REJECTED", ...)`. Decrypt the ciphertext only when it is non-null. Return `OpenAICompatProvider(base_url, model, api_key=plaintext or None, is_local=False, transport=pinning_transport(pinned))`, reason `"explicit"`.
    - `auto`: ignore the body's URL, model, and ciphertext. Resolve `local_base_url` once. If it is missing or rejected, return `AnthropicProvider("claude-haiku-5-5", api_key=anthropic_api_key)` with reason `auto: local unreachable (not configured)` or `auto: local unreachable (url rejected)`. If it pins, build two transports from that same `PinnedUrl` (the health-check client is closed by `select_provider`). Local provider: `OpenAICompatProvider(local_base_url, local_model, api_key=None, is_local=True, extra_headers={CF-Access-Client-Id, CF-Access-Client-Secret} when those env values are set, transport=second)`. Fallback: `AnthropicProvider("claude-haiku-5-5", api_key=anthropic_api_key)`. Return `select_provider(local, fallback, transport=first)`.
    - Never put the user ciphertext's plaintext on the auto local client. Never copy headers out of the HTTP request.
  - `probe_connection(...) -> dict` (not `test_...`: pytest would collect an imported `test_connection` as a test and fail on its arguments) with the same keyword arguments that affect the provider, plus an injectable Anthropic client and an injectable HTTP transport. Returns the `POST /agent/test` JSON.
    - `claude`: call `models.list` on the injected client (production: `anthropic.Anthropic(api_key=plaintext, max_retries=0)`). Do not call `messages.create`. Success → `{ok: true, provider: "anthropic", model, detail: "anthropic models endpoint ok"}`. Failure → `{ok: false, provider: "anthropic", model, detail: "anthropic models endpoint failed"}`.
    - `custom`: `GET {base}/models` through the pinning transport, timeout 5s. 200 → `{ok: true, provider: "openai_compat", model, detail: "models endpoint returned 200"}`. Otherwise `ok: false` and `detail` `models endpoint returned <status>` or `models endpoint unreachable`. No request to `/chat/completions`.
    - `auto`: the same GET against the local URL with the CF headers and no user key, timeout 2s. Shapes are the ones in the API contract (`auto: local reachable` / `auto: local unreachable ...`). Do not call Anthropic.

- [x] **Step 1: Write the failing tests**

Use `Encryptor(b"k" * 32)` and `httpx.MockTransport`. Script `resolve` to return `8.8.8.8` for `llm.example`.

```python
def test_claude_uses_only_this_users_key():
    enc = Encryptor(b"k" * 32)
    settings = RunSettings(provider="claude", model="claude-sonnet-5-5", key_ciphertext=enc.encrypt("sk-ant-example", user_id="user-a"))
    provider, reason = build_provider(settings, user_id="user-a", encryptor=enc, anthropic_api_key="server-key",
        local_base_url=None, local_model=None, cf_access_client_id=None, cf_access_client_secret=None, resolve=lambda h: [])
    assert reason == "explicit" and provider.model == "claude-sonnet-5-5" and provider.client.api_key == "sk-ant-example"
    with pytest.raises(ProviderBuildError) as exc:
        build_provider(settings, user_id="user-b", encryptor=enc, anthropic_api_key="server-key",
            local_base_url=None, local_model=None, cf_access_client_id=None, cf_access_client_secret=None, resolve=lambda h: [])
    assert exc.value.code == "KEY_DECRYPT_FAILED"

def test_custom_is_not_local_and_rejects_http():
    settings = RunSettings(provider="custom", model="m", base_url="http://llm.example/v1")
    with pytest.raises(ProviderBuildError) as exc:
        build_provider(settings, user_id="u", encryptor=None, anthropic_api_key=None, local_base_url=None,
            local_model=None, cf_access_client_id=None, cf_access_client_secret=None, resolve=lambda h: ["8.8.8.8"])
    assert exc.value.code == "URL_REJECTED"
    ok = RunSettings(provider="custom", model="m", base_url="https://llm.example/v1")
    provider, _ = build_provider(ok, user_id="u", encryptor=None, anthropic_api_key=None, local_base_url=None,
        local_model=None, cf_access_client_id=None, cf_access_client_secret=None, resolve=lambda h: ["8.8.8.8"])
    assert provider.is_local is False and provider.model == "m"

def test_auto_checks_the_server_url_and_does_not_send_the_user_key(monkeypatch):
    seen = {}
    def handler(request):
        seen["headers"] = dict(request.headers)
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"data": []})
    settings = RunSettings(provider="auto", model="ignored", base_url="https://evil.example/v1",
                           key_ciphertext="not-used")
    provider, reason = build_provider(
        settings, user_id="owner", encryptor=None, anthropic_api_key="server-key",
        local_base_url="https://llm.example/v1", local_model="local-model",
        cf_access_client_id="cf-id", cf_access_client_secret="cf-secret",
        resolve=lambda h: ["8.8.8.8"], transport_for_tests=httpx.MockTransport(handler),
    )
    assert reason == "auto: local reachable"
    assert provider.is_local is True and provider.model == "local-model"
    assert seen["headers"].get("cf-access-client-id") == "cf-id"
    assert "authorization" not in {k.lower() for k in seen["headers"]}
    assert "evil.example" not in seen["url"]

def test_probe_never_posts_a_completion():
    calls = []
    def handler(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(200, json={"data": []})
    settings = RunSettings(provider="custom", model="m", base_url="https://llm.example/v1")
    out = probe_connection(settings, user_id="u", encryptor=None, anthropic_api_key=None,
        local_base_url=None, local_model=None, cf_access_client_id=None, cf_access_client_secret=None,
        resolve=lambda h: ["8.8.8.8"], transport_for_tests=httpx.MockTransport(handler))
    assert out["ok"] is True and out["detail"] == "models endpoint returned 200"
    assert calls == [("GET", "/models")]
```

Add two shorter tests beside these: auto with `local_base_url=None` returns the Anthropic fallback and a reason starting `auto: local unreachable`, and a Claude `probe_connection` against a stub client calls `models.list` and does not call `messages.create`.

- [x] **Step 2: Run** — `uv run pytest tests/test_server_providers.py -q` → FAIL.
- [x] **Step 3: Implement** as in Interfaces. `AnthropicProvider` stores the key on `client.api_key` when it constructs `anthropic.Anthropic`; assert against the object the constructor actually keeps (the existing attribute is `client`). Do not modify `providers/`.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: build a provider from per-user settings"`.

---

### Task 6: Trace sink and the SQL migration

**Files:**
- Create: `agent/boday_agent/server/traces.py`, `agent/sql/agent_traces.sql`
- Modify: `agent/pyproject.toml`, `agent/uv.lock` (`uv add "psycopg[binary]"`)
- Test: `agent/tests/test_server_traces.py`

**Interfaces:**
- Produces:
  - `class TraceSink(Protocol)`: `write(self, trace: Trace, user_id: str) -> None` and `append_feedback(self, run_id: str, user_id: str, event: dict) -> bool`.
  - `class MemorySink`: `write` stores `{"user_id", "data"}` under `trace.run_id` where `data` is `redact(trace.model_dump(mode="json"))`. `append_feedback` returns false when the id is missing or `user_id` differs; otherwise appends `event` onto `data["feedback"]` and returns true.
  - `class PostgresSink` with `__init__(self, connect: Callable[[], Connection])`. `write` executes `insert into public.agent_traces (id, user_id, data) values (%s, %s, %s::jsonb)` with the redacted JSON. `append_feedback` executes `select public.append_agent_feedback(%s, %s, %s::jsonb)` and returns the boolean. Parameters only — never format the user id into the SQL string. The connection and cursor are closed after each call. `write` never selects and never uses `RETURNING` (the role has no SELECT).
  - `postgres_connect(dsn: str) -> Callable[[], Connection]` — returns `lambda: psycopg.connect(dsn, prepare_threshold=None, connect_timeout=5, autocommit=True)`. `prepare_threshold=None` keeps psycopg from preparing statements, which Supabase's transaction pooler (port 6543) does not support.
  - `feedback_event(event: str, task_ids: list[str], *, now: datetime) -> dict` with keys `event`, `taskIds`, `at` (`YYYY-MM-DDTHH:MM:SSZ`).

The SQL file is the migration the owner runs. Commit this text:

```sql
-- BoDay agent traces. Owner step: run in the Supabase SQL editor.
-- Safe to run again: every statement is idempotent.
-- agent_tracer can INSERT rows and EXECUTE append_agent_feedback, nothing else.
-- It cannot SELECT, UPDATE, or DELETE. Feedback goes through the
-- security-definer function because the role cannot UPDATE.

create table if not exists public.agent_traces (
  id text primary key,
  user_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_traces_user_created
  on public.agent_traces (user_id, created_at desc);

alter table public.agent_traces enable row level security;

-- Supabase's default privileges grant anon and authenticated everything on new
-- public tables. Take that back; signed-in users only read their own rows.
revoke all on public.agent_traces from anon, authenticated;
grant select on public.agent_traces to authenticated;

drop policy if exists agent_traces_select_own on public.agent_traces;
create policy agent_traces_select_own
  on public.agent_traces
  for select
  to authenticated
  using (user_id = (select auth.uid())::text);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_tracer') then
    create role agent_tracer login nosuperuser nobypassrls;
  end if;
end
$$;

grant usage on schema public to agent_tracer;
revoke all on public.agent_traces from agent_tracer;
grant insert on public.agent_traces to agent_tracer;

drop policy if exists agent_traces_insert_tracer on public.agent_traces;
create policy agent_traces_insert_tracer
  on public.agent_traces
  for insert
  to agent_tracer
  with check (true);

create or replace function public.append_agent_feedback(
  p_run_id text,
  p_user_id text,
  p_event jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  update public.agent_traces
  set data = jsonb_set(
    data,
    '{feedback}',
    coalesce(data->'feedback', '[]'::jsonb) || jsonb_build_array(p_event),
    true
  )
  where id = p_run_id and user_id = p_user_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  return updated = 1;
end;
$$;

revoke all on function public.append_agent_feedback(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_agent_feedback(text, text, jsonb) to agent_tracer;

-- Retention is 30 days (spec §4). This file does not delete rows.
-- Owner step, once pg_cron is enabled (Database → Extensions):
--   select cron.schedule(
--     'agent-traces-retention',
--     '15 4 * * *',
--     $$delete from public.agent_traces where created_at < now() - interval '30 days'$$
--   );
```

Do not put a password in this file. The owner sets one later.

- [x] **Step 1: Write the failing tests**

```python
def test_memory_sink_redacts_and_feedback_is_user_scoped(tmp_path):
    sink = MemorySink()
    trace = Trace(run_id="run-1", started_at="2026-10-21T18:00:00Z", provider={"provider": "anthropic"},
        selection_reason="explicit", prompt_version="abc", request={"message": "hi", "snapshot_hash": "h"},
        error="bad key sk-ant-example")
    trace.finalize("failed", trace.error, 1)
    sink.write(trace, "user-1")
    blob = json.dumps(sink.rows["run-1"])
    assert "sk-ant-example" not in blob and sink.rows["run-1"]["user_id"] == "user-1"
    assert sink.append_feedback("run-1", "user-2", {"event": "approve", "taskIds": [], "at": "2026-10-21T18:00:00Z"}) is False
    assert sink.append_feedback("missing", "user-1", {"event": "reject", "taskIds": [], "at": "2026-10-21T18:00:00Z"}) is False
    assert sink.append_feedback("run-1", "user-1", feedback_event("undo", ["dentist"], now=datetime(2026, 10, 21, 18, 0, tzinfo=UTC)))
    assert sink.rows["run-1"]["data"]["feedback"][0] == {
        "event": "undo", "taskIds": ["dentist"], "at": "2026-10-21T18:00:00Z"
    }

def test_postgres_sink_uses_placeholders():
    cur = FakeCursor()
    sink = PostgresSink(connect=lambda: FakeConn(cur))
    trace = Trace(run_id="run-1", started_at="2026-10-21T18:00:00Z", provider={},
        selection_reason="explicit", prompt_version="abc", request={})
    sink.write(trace, "user-1")
    sql, params = cur.calls[0]
    assert "%s" in sql and "user-1" not in sql
    assert params[0] == "run-1" and params[1] == "user-1"
    sink.append_feedback("run-1", "user-1", {"event": "approve", "taskIds": ["dentist"], "at": "2026-10-21T18:00:00Z"})
    sql, params = cur.calls[1]
    assert "append_agent_feedback" in sql and params[1] == "user-1"

def test_sql_file_locks_the_role_down():
    sql = Path("sql/agent_traces.sql").read_text().lower()
    assert "create table if not exists public.agent_traces" in sql
    assert "enable row level security" in sql
    assert "revoke all on public.agent_traces from anon, authenticated" in sql
    assert "revoke all on public.agent_traces from agent_tracer" in sql
    assert "grant insert on public.agent_traces to agent_tracer" in sql
    assert "grant select on public.agent_traces to agent_tracer" not in sql
    assert "grant insert, select" not in sql
    assert sql.count("create policy") == sql.count("drop policy if exists")
    assert "security definer" in sql and "set search_path = ''" in sql
    assert "append_agent_feedback" in sql
    assert "30 days" in sql
    assert "for insert\n  to authenticated" not in sql
    assert "password" not in sql

def test_postgres_connect_disables_prepared_statements(monkeypatch):
    seen = {}
    fake = types.SimpleNamespace(connect=lambda dsn, **kw: seen.update(dsn=dsn, **kw))
    monkeypatch.setitem(sys.modules, "psycopg", fake)
    postgres_connect("postgresql://agent_tracer.ref@pooler.example:6543/postgres")()
    assert seen["prepare_threshold"] is None and seen["connect_timeout"] == 5
```

`FakeCursor.calls` is a list of `(sql, params)`; `fetchone()` returns `(True,)`. `FakeConn` returns that cursor from `cursor()` and records `close`. Test imports include `sys`, `types`, `json`, `datetime` / `UTC`, `Trace` from `boday_agent.tracing`, and `MemorySink`, `PostgresSink`, `feedback_event`, `postgres_connect` from `boday_agent.server.traces`.

- [x] **Step 2: Run** — `uv run pytest tests/test_server_traces.py -q` → FAIL.
- [x] **Step 3: Implement** the sinks and commit the SQL above. `uv add "psycopg[binary]"`. `PostgresSink` and `postgres_connect` import psycopg inside the function body so tests that never construct them do not need a server (and so the monkeypatched `sys.modules["psycopg"]` is what the test sees). `write` passes `json.dumps(redact(...))` as the third parameter.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: trace table, tracer role, and sink"`.

---

### Task 7: App shell, health, encrypt, CORS, body cap

**Files:**
- Create: `agent/boday_agent/server/app.py`
- Modify: `agent/pyproject.toml`, `agent/uv.lock` (`uv add fastapi uvicorn`)
- Test: `agent/tests/test_server_app.py`

**Interfaces:**
- Produces `create_app(config: ServerConfig, *, sink: TraceSink | None = None, verifier: TokenVerifier | None = None, encryptor: Encryptor | None = None, resolve=None) -> FastAPI`.
- `ServerConfig` is a pydantic model with the env fields from the contract (`encryption_key_b64`, `jwks_url`, `jwt_secret`, `admin_email`, `anthropic_api_key`, `local_base_url`, `local_model`, `cf_access_client_id`, `cf_access_client_secret`, `traces_dsn`, `jwt_issuer`, `allowed_origins: list[str]`, `max_body_bytes: int = 4_194_304`). `from_env()` reads the names in the contract. `AGENT_ALLOWED_ORIGINS` splits on commas and strips. `admin_email` defaults to `bobo.borenstein@gmail.com` when the env var is unset.
- `app_from_env() -> FastAPI` returns `create_app(ServerConfig.from_env())`. It is the uvicorn factory (`uvicorn --factory boday_agent.server.app:app_from_env`). There is no module-level `app` object, so importing `app.py` in tests never reads the environment.
- Missing verifier and missing JWT configuration: `create_app` builds a `TokenVerifier` and raises `ValueError` when both JWT sources are empty. With `jwks_url` set it passes `jwks_get=cached_jwks(jwks_url)`, and it always passes `issuer=jwt_issuer`.
- `sink` defaults to `MemorySink` when `traces_dsn` is empty, else `PostgresSink(postgres_connect(traces_dsn))`. Tests always pass a `MemorySink`.
- Routes in this task: `GET /health`, `POST /encrypt`. Both are plain `def` (Global Constraints). Validation errors and `AuthError` use `error_body` and the contract messages, status 400 and 401.
- Body cap: a pure ASGI middleware (a class with `async def __call__(self, scope, receive, send)`, not `BaseHTTPMiddleware`). For `http` scopes it answers 413 `PAYLOAD_TOO_LARGE` at once when `Content-Length` is larger than `max_body_bytes`. Otherwise it reads `http.request` messages, counting bytes, answers 413 as soon as the count passes the cap, and then replays the buffered body to the app through a new `receive`. No private Starlette attribute is touched.
- Errors: a second pure ASGI middleware catches any exception from the app and sends 500 `INTERNAL_ERROR` in the contract shape. It logs the exception class name only, never its message. Middleware order, innermost first: error catcher, body cap, CORS. Add them in that order with `app.add_middleware` (the last one added is the outermost), so CORS headers are on the 413 and 500 bodies too. FastAPI's own `exception_handler(Exception)` is not enough: Starlette runs it outside the CORS middleware.
- CORS: `allow_origins=config.allowed_origins`, methods `GET`, `POST`, `OPTIONS`, headers `Authorization` and `Content-Type`, `allow_credentials=False`. An origin that is not on the list gets no `access-control-allow-origin` header.
- Logs (logger name `boday_agent.server`): method, path, status, user id. Never the body, the headers, the ciphertext, or an exception message.

- [x] **Step 1: Write the failing tests**

```python
def test_health_requires_a_jwt():
    client = _client()
    assert client.get("/health").status_code == 401
    assert client.get("/health").json() == error_body("UNAUTHORIZED", "Sign in required.")
    ok = client.get("/health", headers=_auth())
    assert ok.status_code == 200 and ok.json() == {"ok": True}

def test_cors_allowlist_and_body_cap():
    client = _client(allowed_origins=["http://localhost:5173"])
    preflight = client.options("/health", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"
    blocked = client.get("/health", headers={**_auth(), "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers
    too_big = client.post("/encrypt", content=b'{"plaintext":"' + b"a" * 4_200_000 + b'"}',
                          headers={**_auth(), "content-type": "application/json", "Origin": "http://localhost:5173"})
    assert too_big.status_code == 413
    assert too_big.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert too_big.headers["access-control-allow-origin"] == "http://localhost:5173"
    under = client.post("/encrypt", content=b'{"plaintext":"' + b"a" * 3_000_000 + b'"}',
                        headers={**_auth(), "content-type": "application/json"})
    assert under.status_code == 400  # past the cap check; rejected by the 500-character rule

def test_unexpected_exception_is_a_contract_500_with_cors(monkeypatch):
    client = _client(allowed_origins=["http://localhost:5173"])
    def boom(*args, **kwargs):
        raise RuntimeError("leaked sk-ant-example")
    monkeypatch.setattr(app_module.Encryptor, "encrypt", boom)
    res = client.post("/encrypt", json={"plaintext": "x"}, headers={**_auth(), "Origin": "http://localhost:5173"})
    assert res.status_code == 500
    assert res.json() == error_body("INTERNAL_ERROR", "Something went wrong. Try again.")
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "sk-ant-example" not in res.text and "RuntimeError" not in res.text

def test_every_route_handler_is_sync():
    app = create_app(_config(), sink=MemorySink(), encryptor=Encryptor(KEY), resolve=lambda h: ["8.8.8.8"])
    endpoints = [r.endpoint for r in app.routes if getattr(r, "path", "") in {"/health", "/encrypt", "/agent/run", "/feedback", "/agent/test"}]
    assert endpoints and not any(inspect.iscoroutinefunction(e) for e in endpoints)

def test_encrypt_returns_ciphertext_and_logs_no_plaintext(caplog):
    client = _client()
    res = client.post("/encrypt", json={"plaintext": "sk-ant-example"}, headers=_auth())
    assert res.status_code == 200
    token = res.json()["ciphertext"]
    assert "sk-ant-example" not in token
    assert "sk-ant-example" not in caplog.text
    assert Encryptor(KEY).decrypt(token, user_id="user-1") == "sk-ant-example"
    bad = client.post("/encrypt", json={"plaintext": ""}, headers=_auth())
    assert bad.status_code == 400
    assert bad.json()["error"] == error_body("INVALID_REQUEST", "Check the message, snapshot, and model settings.")
    assert "detail" not in bad.json()

def test_encrypt_without_a_key_is_503():
    client = _client(encryptor=None)
    res = client.post("/encrypt", json={"plaintext": "sk-ant-example"}, headers=_auth())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "NOT_CONFIGURED"
```

`_config(**overrides)` builds `ServerConfig` with `jwt_secret="test-secret"`, `admin_email="bobo.borenstein@gmail.com"`, `allowed_origins=["http://localhost:5173"]`, and `max_body_bytes=4_194_304`. `_client(**overrides)` passes `_config(...)`, a `MemorySink` unless `sink` is given, an `Encryptor(KEY)` unless overridden (`encryptor=None` means no key), `resolve=lambda h: ["8.8.8.8"]`, and a `TokenVerifier` over that secret, then wraps the app in `TestClient`. `_auth(sub="user-1", email="bobo.borenstein@gmail.com")` is the HS256 bearer helper from Task 3. `app_module` is `boday_agent.server.app` imported as a module. `KEY` is `b"k" * 32`. `test_every_route_handler_is_sync` also covers the Task 8 and Task 9 routes once they exist; it passes with the two routes of this task.

- [x] **Step 2: Run** — `uv run pytest tests/test_server_app.py -q` → FAIL.
- [x] **Step 3: Implement.** `uv add fastapi uvicorn`. Middleware as in Interfaces. The CORS middleware answers `OPTIONS` before auth, so a preflight with no `Authorization` header still returns 200 for an allowed origin. Register an exception handler for `RequestValidationError` that returns 400 `INVALID_REQUEST`. `app.py` imports `Encryptor` by name (the monkeypatch in the 500 test patches `app_module.Encryptor.encrypt`). `POST /encrypt` uses the caller from `verifier.verify`. No `/agent/run` yet.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: FastAPI shell, health, and encrypt"`.

---

### Task 8: POST /agent/run

**Files:**
- Modify: `agent/boday_agent/server/app.py`
- Test: `agent/tests/test_server_app.py` (append)

**Interfaces:**
- Consumes: `run_agent`, `AgentRequest`, `HistoryTurn`, `Snapshot.from_app`, `build_provider`, `run_settings_error`, `MemorySink`.
- `POST /agent/run` flow:
  1. Auth. On `AuthError`, 401.
  2. Parse `RunRequest`. On validation failure, the Task 7 handler already returned 400.
  3. `run_settings_error`. When it returns a tuple, respond with that status and `error_body`. Do not call `build_provider`.
  4. `build_provider`. On `ProviderBuildError`, respond with 400 and that code. Do not call `run_agent`.
  5. `Snapshot.from_app(request.snapshot)`. On `ValidationError`, 400 `INVALID_REQUEST`. Do not replace `now`.
  6. Map each `HistoryItem` to `HistoryTurn` (`proposal_status` included). Call `run_agent(AgentRequest(...), provider, selection_reason=reason)`.
  7. `sink.write(result.trace, user.id)`. On any exception, 500 `TRACE_WRITE_FAILED` and do not include `changes` or `text`.
  8. Return 200 with `traceId`, `outcome`, `text`, `changes` (the list from the result, not a re-parsed strict model), `question`, `options`, `parseWarnings` from `result.trace.parse_warnings`.

- [x] **Step 1: Write the failing tests**

Monkeypatch `boday_agent.server.app.build_provider` to return `(FakeProvider([...]), "explicit")` and a `MemorySink`. The happy-path script is one `fake_text("Moved dentist to Wednesday.")` after the tools the fixture needs, or a single `fake_text` when the snapshot has no matching task so the outcome is `answered`. Drive a proposal by scripting `fake_tools` then `fake_text`, using a snapshot copied from `agent/examples/demo_snapshot.json` with its `now` set to `2026-10-21T18:00:00Z`.

Why these tests reach `build_provider`: the contract fixture's `settings` is `claude` with a non-null `keyCiphertext`, so `run_settings_error` passes and step 4 calls the monkeypatched `build_provider`, which never decrypts. Do not edit the fixture to make a test pass; it is the shared contract. A test that needs `run_settings_error` to fail sets its own `settings`, as `test_non_owner_auto_does_not_build_a_provider` does.

```python
def test_run_returns_the_draft_and_writes_a_trace(monkeypatch):
    sink = MemorySink()
    client = _client(sink=sink)
    monkeypatch.setattr(app_module, "build_provider", lambda *a, **k: (FakeProvider([
        fake_tools(("search_tasks", {"query": "dentist"})),
        fake_tools(("propose_update_task", {"task_id": "dentist", "changes": {"scheduled_date": "2026-10-21"}})),
        fake_text("Moved dentist to Wednesday."),
    ]), "explicit"))
    body = json.loads(Path("tests/fixtures/api_contract_run.json").read_text())
    demo = json.loads(Path("examples/demo_snapshot.json").read_text())
    demo["now"] = "2026-10-21T18:00:00Z"
    body["snapshot"] = demo
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 200
    payload = res.json()
    assert payload["outcome"] == "proposed" and payload["changes"][0]["op"] == "update"
    assert payload["changes"][0]["patch"] == {"scheduledDate": "2026-10-21"}
    row = sink.rows[payload["traceId"]]
    assert row["user_id"] == "user-1"
    assert "snapshot_hash" in row["data"]["request"] and "tasks" not in row["data"]["request"]

def test_provider_failure_is_http_200_and_fail_closed(monkeypatch):
    fake = FakeProvider([ProviderError("bad key sk-ant-example", retryable=False)])
    monkeypatch.setattr(app_module, "build_provider", lambda *a, **k: (fake, "explicit"))
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 200
    assert res.json()["outcome"] == "failed" and res.json()["changes"] == []
    assert "sk-ant-example" not in res.text
    blob = json.dumps(sink.rows[res.json()["traceId"]])
    assert "sk-ant-example" not in blob

def test_non_owner_auto_does_not_build_a_provider(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("provider built")
    monkeypatch.setattr(app_module, "build_provider", boom)
    auto = {**body, "settings": {"provider": "auto", "model": None, "baseUrl": None, "keyCiphertext": None}}
    res = client.post("/agent/run", json=auto, headers=_auth(email="friend@example.com"))
    assert res.status_code == 403 and res.json()["error"]["code"] == "AUTO_OWNER_ONLY"
    assert sink.rows == {}

def test_snapshot_must_be_an_object_and_a_bad_task_is_a_warning(monkeypatch):
    res = client.post("/agent/run", json={**body, "snapshot": []}, headers=_auth())
    assert res.status_code == 400 and res.json()["error"]["code"] == "INVALID_REQUEST"
    warned = {**body, "snapshot": {**body["snapshot"], "tasks": [{"id": "bad"}]}}
    monkeypatch.setattr(app_module, "build_provider", lambda *a, **k: (FakeProvider([fake_text("Nothing to change.")]), "explicit"))
    res = client.post("/agent/run", json=warned, headers=_auth())
    assert res.status_code == 200 and res.json()["outcome"] == "answered"
    assert any(item.startswith("skipped task 'bad'") for item in res.json()["parseWarnings"])

def test_trace_write_failure_returns_no_changes(monkeypatch):
    class DeadSink(MemorySink):
        def write(self, trace, user_id):
            raise OSError("dsn=postgres://agent_tracer:secret@db.example/postgres")
    client = _client(sink=DeadSink())
    monkeypatch.setattr(app_module, "build_provider", lambda *a, **k: (FakeProvider([fake_text("Moved it.")]), "explicit"))
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 500
    assert res.json() == error_body("TRACE_WRITE_FAILED", "Could not record the trace.")
    assert "changes" not in res.json() and "secret" not in res.text and "postgres" not in res.text
```

Start every other test in this task with `sink = MemorySink()`, `client = _client(sink=sink)`, and `body = json.loads(Path("tests/fixtures/api_contract_run.json").read_text())`. `KEY` is `b"k" * 32`, the same key `_client` installs. `FakeProvider`, `fake_text`, and `fake_tools` come from `boday_agent.providers.fake`; `ProviderError` from `boday_agent.providers.base`.

Do not propose `end_date: null` on a task that has no `endDate`: `_update` drops a value equal to the current one and then rejects the call with "No change", so the run would end with no changes.

```python
def test_asked_returns_no_changes(monkeypatch):
    monkeypatch.setattr(app_module, "build_provider", lambda *a, **k: (FakeProvider([
        fake_tools(("ask_user", {"question": "Which one?", "options": ["Dentist", "Doctor"]})),
    ]), "explicit"))
    res = client.post("/agent/run", json=body, headers=_auth())
    assert res.status_code == 200
    assert res.json()["outcome"] == "asked" and res.json()["changes"] == []
    assert res.json()["question"] == "Which one?" and res.json()["options"] == ["Dentist", "Doctor"]

def test_null_before_field_survives_the_response(monkeypatch):
    monkeypatch.setattr(app_module, "build_provider", lambda *a, **k: (FakeProvider([
        fake_tools(("search_tasks", {"query": "standup"})),
        fake_tools(("propose_update_task", {"task_id": "standup", "changes": {"end_date": "2026-12-31"}})),
        fake_text("Ends on Dec 31."),
    ]), "explicit"))
    demo = json.loads(Path("examples/demo_snapshot.json").read_text())
    demo["now"] = "2026-10-21T18:00:00Z"
    res = client.post("/agent/run", json={**body, "snapshot": demo}, headers=_auth())
    change = res.json()["changes"][0]
    # standup has no endDate key in the demo snapshot: absent is sent as null
    assert change["patch"] == {"endDate": "2026-12-31"}
    assert "endDate" in change["beforeFields"] and change["beforeFields"]["endDate"] is None

def test_other_users_ciphertext_is_rejected(caplog):
    enc = Encryptor(KEY)
    stolen = {**body, "settings": {
        "provider": "claude", "model": "claude-haiku-5-5", "baseUrl": None,
        "keyCiphertext": enc.encrypt("sk-ant-example", user_id="user-1"),
    }}
    res = client.post("/agent/run", json=stolen, headers=_auth(sub="user-2", email="friend@example.com"))
    assert res.status_code == 400 and res.json()["error"]["code"] == "KEY_DECRYPT_FAILED"
    assert "sk-ant-example" not in caplog.text and sink.rows == {}
```

`test_other_users_ciphertext_is_rejected` does not monkeypatch `build_provider`.

- [x] **Step 2: Run** — `uv run pytest tests/test_server_app.py -q` → FAIL on the new tests.
- [x] **Step 3: Implement** the flow in Interfaces. History mapping is `HistoryTurn(role=item.role, text=item.text, proposal=item.proposal, proposal_status=item.proposal_status)`. Catch `ProviderBuildError` and `ValidationError` only around the steps that raise them.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check . && uv run boday-eval validate` → PASS. `validate` must still report the suite valid; this task does not edit cases.
- [x] **Step 5: Commit + push** — `git commit -m "agent: POST /agent/run over the existing loop"`.

---

### Task 9: Feedback and test connection

**Files:**
- Modify: `agent/boday_agent/server/app.py`
- Test: `agent/tests/test_server_app.py` (append)

**Interfaces:**
- `POST /feedback` reads `FeedbackRequest`, builds `feedback_event` with `datetime.now(UTC)`, calls `sink.append_feedback`. `True` → `{"ok": true}`. `False` → 404 `NOT_FOUND`.
- `POST /agent/test` runs `run_settings_error` and then `probe_connection`. `ProviderBuildError` → 400 with that code. A returned dict → HTTP 200 even when `ok` is false.

- [x] **Step 1: Write the failing tests**

```python
def _trace(run_id):
    return Trace(run_id=run_id, started_at="2026-10-21T18:00:00Z", provider={},
                 selection_reason="explicit", prompt_version="abc", request={})

def test_feedback_appends_for_the_owner_only():
    sink.write(_trace("run-1"), "user-1")
    res = client.post("/feedback", json={"runId": "run-1", "event": "approve", "taskIds": ["dentist"]}, headers=_auth())
    assert res.status_code == 200 and res.json() == {"ok": True}
    assert sink.rows["run-1"]["data"]["feedback"][0]["event"] == "approve"
    assert sink.rows["run-1"]["data"]["feedback"][0]["taskIds"] == ["dentist"]
    other = client.post("/feedback", json={"runId": "run-1", "event": "undo", "taskIds": ["dentist"]},
                        headers=_auth(sub="user-2", email="friend@example.com"))
    assert other.status_code == 404 and other.json()["error"]["message"] == "Trace not found."
    assert [item["event"] for item in sink.rows["run-1"]["data"]["feedback"]] == ["approve"]
    missing = client.post("/feedback", json={"runId": "nope", "event": "reject", "taskIds": []}, headers=_auth())
    assert missing.status_code == 404

def test_agent_test_reports_the_mac_without_a_trace(monkeypatch):
    monkeypatch.setattr(app_module, "probe_connection", lambda *a, **k: {
        "ok": False, "provider": "anthropic", "model": "claude-haiku-5-5", "detail": "auto: local unreachable (not configured)",
    })
    body = {"settings": {"provider": "auto", "model": None, "baseUrl": None, "keyCiphertext": None}}
    res = client.post("/agent/test", json=body, headers=_auth())
    assert res.status_code == 200 and res.json()["ok"] is False
    assert sink.rows == {}
    forbidden = client.post("/agent/test", json=body, headers=_auth(email="friend@example.com"))
    assert forbidden.status_code == 403
```

- [x] **Step 2: Run** — `uv run pytest tests/test_server_app.py::test_feedback_appends_for_the_owner_only tests/test_server_app.py::test_agent_test_reports_the_mac_without_a_trace -q` → FAIL.
- [x] **Step 3: Implement** the two routes. `datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")` is the `at` value (injectable clock on `create_app` so the test can pin it; default the real clock). The feedback test compares `event` and `taskIds` and asserts `at` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`.
- [x] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS.
- [x] **Step 5: Commit + push** — `git commit -m "agent: feedback and test-connection routes"`.

---

### Task 10: Image, deploy notes, and the PR

**Files:**
- Create: `agent/Dockerfile`, `agent/.dockerignore`, `agent/DEPLOY.md`
- Test: `agent/tests/test_server_image.py`

**Interfaces:**
- `agent/Dockerfile` uses `python:3.12-slim`, installs `uv`, copies `pyproject.toml`, `uv.lock`, and `boday_agent/`, runs `uv sync --frozen --no-dev`, drops to a non-root user, and starts uvicorn in shell form so `$PORT` expands: `CMD uv run --no-sync uvicorn --factory boday_agent.server.app:app_from_env --host 0.0.0.0 --port ${PORT:-8080}`.
- `agent/.dockerignore` excludes `.venv`, `tests`, `evals`, `traces`, `.env`, and `__pycache__`.
- `agent/DEPLOY.md` is the owner runbook. It contains the strings the test below checks, the secret names from the contract, and the steps marked owner step. It contains no secret values.

- [ ] **Step 1: Write the failing test**

```python
def test_image_and_runbook_match_the_spec():
    docker = Path("Dockerfile").read_text()
    assert "python:3.12-slim" in docker
    assert "uv sync --frozen --no-dev" in docker
    assert "--factory boday_agent.server.app:app_from_env" in docker
    assert "${PORT:-8080}" in docker
    assert "USER " in docker
    ignore = Path(".dockerignore").read_text()
    for name in (".venv", "tests", ".env", "traces"):
        assert name in ignore
    doc = Path("DEPLOY.md").read_text()
    for snippet in (
        "max-instances=1",
        "allow-unauthenticated",
        "timeout=120",
        "us-west1",
        "--memory=512Mi",
        "--cpu=1",
        "$1",
        "0.5 GB",
        "2M requests",
        "180k vCPU-s",
        "360k GiB-s",
        "pooler.supabase.com",
        "agent_tracer.cgsjsbsxuzawvgunrpqi",
        "IPv6",
        "expense-app.uk",
        "CF-Access-Client-Id",
        "AGENT_ENCRYPTION_KEY",
        "AGENT_TRACES_DSN",
        "AGENT_ALLOWED_ORIGINS",
        "SUPABASE_JWKS_URL",
        "SUPABASE_JWT_ISSUER",
        "https://boday.boapps.workers.dev",
        "http://localhost:5173",
        "VITE_AGENT_URL",
        "npm run build && npx wrangler deploy",
        "30 days",
        "owner step",
    ):
        assert snippet in doc
    assert "sk-ant-" not in doc
```

- [ ] **Step 2: Run** — `uv run pytest tests/test_server_image.py -q` → FAIL.
- [ ] **Step 3: Write the three files.** Dockerfile and dockerignore as in Interfaces. `DEPLOY.md` sections, in this order:
  1. What it is: stateless Cloud Run service, snapshot in, proposal out, no task-table access.
  2. **owner step** — billing account on the GCP project. Free tier quoted from the spec: 2M requests, 180k vCPU-s, 360k GiB-s per month. Budget alert at $1.
  3. **owner step** — run `agent/sql/agent_traces.sql` in the Supabase SQL editor (it is safe to run again). Then `alter role agent_tracer password '...'` in that editor; the password is not written into the repo. The direct database host is IPv6-only on the free plan and Cloud Run sends IPv4, so use the Supavisor pooler: `AGENT_TRACES_DSN` is `postgresql://agent_tracer.cgsjsbsxuzawvgunrpqi:<password>@aws-0-us-west-1.pooler.supabase.com:6543/postgres` (transaction mode; copy the exact host from Supabase → Connect). The pooler user name is the role name, a dot, and the project ref. `postgres_connect` already turns prepared statements off for this mode. Schedule the 30-day delete once `pg_cron` is enabled (the comment at the end of the SQL file).
  4. **owner step** — Cloud Run, region `us-west1` (closest free-tier region to the Supabase project in us-west-1). Fixed flags: `--region=us-west1`, `--memory=512Mi`, `--cpu=1`, `--max-instances=1`, `--timeout=120`, `--allow-unauthenticated`, port `8080`. Cloud Run's default TCP startup probe is the health check; do not configure an HTTP probe (`/health` needs a JWT). Map the env names from the contract as Cloud Run secrets. `SUPABASE_JWKS_URL` is `https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1/.well-known/jwks.json` and `SUPABASE_JWT_ISSUER` is `https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1`. `AGENT_ALLOWED_ORIGINS` is `https://boday.boapps.workers.dev,http://localhost:5173`.
  5. **owner step** — the Mac. Ollama starts at login. `cloudflared` serves a hostname under `expense-app.uk` (the spec's example is `llm.expense-app.uk`). Cloudflare Access service token; the Cloud Run service sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Put the public `https` base URL (ending in `/v1` if Ollama is mounted there) in `BODAY_LOCAL_BASE_URL` and the chosen model id in `BODAY_LOCAL_MODEL`. Do not pick the model in this repo.
  6. **owner step** — the app. Builds run on the owner's Mac, not on Cloudflare, so put `VITE_AGENT_URL=<Cloud Run URL, no trailing slash>` in the repo-root `.env` (gitignored) and then run `npm run build && npx wrangler deploy`. Artifact Registry cleanup policy so the repository stays under 0.5 GB.
  7. Local run without deploy: `uv run uvicorn --factory boday_agent.server.app:app_from_env --reload`. With `AGENT_TRACES_DSN` empty it uses `MemorySink`. `create_app` raises at startup unless `SUPABASE_JWT_SECRET` or `SUPABASE_JWKS_URL` is set. Without `AGENT_ENCRYPTION_KEY`, `/encrypt` returns 503 and saved keys cannot be read.
- [ ] **Step 4: Run** — `uv run pytest -q && uv run ruff check .` → PASS. Do not run `docker build` and do not run `gcloud`.
- [ ] **Step 5: Owner step — deploy.** Leave unchecked. The owner runs the SQL, sets the secrets, and deploys from `DEPLOY.md`.
- [ ] **Step 6: Commit, push, open the PR**

```bash
git add agent/Dockerfile agent/.dockerignore agent/DEPLOY.md agent/tests/test_server_image.py
git commit -m "agent: Cloud Run image and deploy notes"
git push
```

PR into `main`, title `Agent phase 5a: FastAPI service`. Body points at this plan and lists any owner step still unchecked. Do not merge.
