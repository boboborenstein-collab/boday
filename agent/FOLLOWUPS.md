# Follow-ups

Deferred items from the phase 1 final review, grouped by the phase that should pick them up.

## Before / during phase 2

- [x] Post-handler fault and `ToolResult.success` are outside the `try` in `registry._run`; wrap them too (`boday_agent/tools/registry.py`).
- `tool_schemas()` returns Anthropic-shaped schemas. The OpenAI provider must wrap them as `{"type": "function", "function": {name, description, parameters}}`, and `$defs` / `oneOf` / discriminator schemas must be verified on local models (inline them if not) (`registry.py`).
- [x] `UpdateChanges` schema: replace the `FieldInfo.default` mutation plus `model_rebuild` with `Field(default=None)`; no `default: null` on non-nullable fields; add description/pattern to date fields (`boday_agent/tools/propose.py`).
- The agent loop must discard the draft whenever the outcome is `asked` (`ask_user` does not stop later propose calls in the same step), and should put `parse_warnings` in the trace.
- [x] Recurrence parity fixture: add a completed-today one-time task with `completedAt` near UTC midnight (plus a `-1` "today" offset) and weekly `[0, 6]` positives (`scripts/gen-recurrence-parity.ts`, `tests/fixtures/recurrence_parity.json`).

## Before phase 3

- [x] `get_agenda` needs a per-day item cap for the large fixture (~200 tasks) (`boday_agent/tools/read.py`).
- [x] Validate `Fault.call >= 1` once faults are loaded from YAML (`boday_agent/tools/faults.py`).
- `CONFLICTING_CHANGE` granularity: consider merging a second update into the first (conflict only on same key with a different value) and allowing one update plus one `set_status` per task. Decide from eval evidence (`boday_agent/tools/context.py`).

## Phase 4 (iteration candidates)

- "tonight at 9" returns 09:00 first; "this evening", "tomorrow morning at 8" and "on the 25th" are unparseable (they fail safe) (`boday_agent/domain/dates.py`).
- `is_past` is date-only, so past reminder times today are accepted silently; compare against `clock.local_now` (`dates.py`, `propose.py`).
- Clash/quiet warnings for carried-over one-time tasks use the past `scheduled_date`; use `max(scheduled_date, today)` (`boday_agent/tools/propose.py`).
- A reordered `days_of_week` counts as a change; sort before comparing (`propose.py`).
- Whitespace-only titles and empty `ask_user` options are accepted; strip and add `min_length` (`propose.py`).
- Summary text shows camelCase keys while tool args are snake_case (`boday_agent/tools/changes.py`).

## Before phase 5

- [x] Lossless undo of `set_status` `undone`: `StatusChange` should carry the raw completion row / `completedAt` (`boday_agent/tools/changes.py`).
- [x] Document or change the `beforeFields` null-vs-absent convention (`changes.py`, `README.md`).
- [x] `Snapshot.from_app` with non-dict input should be guarded at the API boundary (`boday_agent/domain/models.py`).
- The app should delete only the completion ids listed in `beforeCompletionsRaw` (unparseable rows are excluded from it).

## Test gaps (any time)

- [x] Sunday "this weekend", spring-forward, Feb 30 raising, "12am" / "at 12", and weekday mapping beyond Tuesday (`tests/test_dates.py`).
- [x] `test_blind_delete_blocked` should also show the delete being accepted after a read (`tests/test_scenarios.py`).
- [x] The round-trip test should assert `patch` / `beforeFields` keys.
- Untested propose rules: end before start, start/end on a one-time create (`tests/test_propose_tools.py`).
- `ToolError` propagation via `execute`, and agenda empty/truncated fault tests beyond the seen-id checks (`tests/test_registry.py`).
