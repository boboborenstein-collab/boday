BoDay agent: Python package (`boday_agent`) holding the LLM agent's tools.
Setup: `uv sync` (run inside `agent/`).
Tests: `uv run pytest`.

## Run

```bash
uv run boday-agent "move my dentist appointment to tomorrow" \
  --snapshot examples/demo_snapshot.json \
  --provider anthropic --model claude-haiku-5-5
```

Prints one JSON object: `outcome`, `text`, `changes`, `question`, `options`,
`trace_path`, `cost_usd`, `latency_ms`, `provider`. Exit code 0 for every
outcome, 2 for bad arguments or an unreadable snapshot. The Anthropic
provider reads credentials from the environment or an Anthropic profile
(`--api-key-env NAME` to choose a variable). Traces go under `traces/`
(gitignored).

`--provider openai` posts to an OpenAI-compatible `--base-url` with `--model`.
`--provider auto` checks `{base-url}/models` for 2 seconds and, if that fails,
uses `claude-haiku-5-5` with the Anthropic SDK's own credentials.
`--api-key-env` applies to `--provider anthropic` and `--provider openai`;
auto does not send that key to the local URL. `--now` replaces the snapshot
clock and keeps its timezone. `--header "Name: value"` is sent with the
OpenAI-compatible request (for example Cloudflare Access).

## First run

2026-10-21, `claude-haiku-5-5`, the command above against
`examples/demo_snapshot.json`. Trace: `examples/traces/first-run-haiku.json`.

- Outcome: `proposed`, one change: `update` `dentist`, patch
  `{"scheduledDate": "2026-10-21"}` (from 2026-10-22), with a `TIME_CLASH`
  warning against Standup at 09:00, which the reply also mentions.
- Path: `search_tasks("dentist")` + `resolve_date("tomorrow")`, then
  `propose_update_task`, then the final answer: 3 model calls, 3 tool calls,
  0 tool errors.
- Tokens: 1,728 input, 282 output, 12,042 cache read, 6,021 cache write.
- Cost: $0.0012. Latency: 2.8 s.

## Tool contract

Exactly 9 tools, called through `execute(ctx, name, args)`; schemas come from `tool_schemas()`.

- `search_tasks` - find tasks by text/filters (max 20 results, `truncated`/`total` when more); marks results as seen.
- `get_task` - full detail for one task, including notes and `external` (assigned by someone else); marks it seen.
- `get_agenda` - what is due over a date range (max 14 days, 20 items per day with `total`/`truncated`); marks returned ids as seen, including ones that appear only in a clash.
- `resolve_date` - turn a natural-language date expression into candidate `yyyy-MM-dd` dates.
- `propose_create_task` - add a create change to the draft.
- `propose_update_task` - add an update change (patch of changed fields only) to the draft.
- `propose_set_status` - add a complete/skip/reopen change for a task on a date (defaults to the snapshot's local today).
- `propose_delete_task` - add a delete change to the draft (requires a reason).
- `ask_user` - pose a clarifying question instead of guessing.

Every result is a `ToolResult`; handlers never raise. Error codes:
`NOT_FOUND`, `UNSEEN_ID`, `INVALID_ARGS`, `WRONG_TASK_TYPE`, `INVALID_DATE`,
`LIMIT_EXCEEDED`, `CONFLICTING_CHANGE`, `TOOL_FAILURE`.

## Safety

Task titles and notes are untrusted text (shared tasks can carry injected instructions). Protections:

- No write or outbound tools: the agent can only read the snapshot and build a draft proposal; nothing is sent anywhere.
- Hard limits per proposal: at most 25 changes and at most 3 deletes.
- Approval of every change by the user will happen in the app (phase 5); nothing is applied by this package.
- Changes are patches that carry previous values, so the app can detect stale edits and unknown fields on tasks are preserved.
- Attack success rate will be measured by the eval harness (phase 3) rather than assumed.

The seen-ID rule (`UNSEEN_ID`) only blocks hallucinated or blind IDs. It is not an injection defense, because any read marks everything it returns as seen.

## Payload contract

Each change in the draft carries what the app needs to apply, check and undo it:

- `update` = `patch` (changed fields only) + `beforeFields` (old values of exactly those keys). `beforeFields` uses `null` both when the raw key held `null` and when it was absent.
- `delete` = verbatim `beforeRaw` (the task JSON as received) + `beforeCompletionsRaw`.
- `create` = `after` without injected defaults.
- `set_status` = `{status}` before/after. Lossless undo of `undone` is an open item; see [FOLLOWUPS.md](FOLLOWUPS.md).

Known gaps and deferred work are tracked in [FOLLOWUPS.md](FOLLOWUPS.md).
