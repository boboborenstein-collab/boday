BoDay agent: Python package (`boday_agent`) holding the LLM agent's tools.
Setup: `uv sync` (run inside `agent/`).
Tests: `uv run pytest`.

## Tool contract

Exactly 9 tools, called through `execute(ctx, name, args)`; schemas come from `tool_schemas()`.

- `search_tasks` - find tasks by text/filters (max 20 results, `truncated`/`total` when more); marks results as seen.
- `get_task` - full detail for one task, including notes and `external` (assigned by someone else); marks it seen.
- `get_agenda` - what is due over a date range (max 14 days); marks returned tasks as seen.
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
- The user approves every change in the app before anything is applied.
- Changes are patches (changed fields plus their previous values), so unknown fields on tasks are preserved and stale edits are detected.
- Attack success rate is measured by evals rather than assumed.

The seen-ID rule (`UNSEEN_ID`) only blocks hallucinated or blind IDs. It is not an injection defense, because any read marks everything it returns as seen.
