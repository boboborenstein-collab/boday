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
OpenAI-compatible request (for example Cloudflare Access). With `--provider openai`,
`--effort` is sent as `reasoning_effort` (`--effort none` turns off thinking
on LM Studio's Qwen models).

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

## Results (baseline, prompt `d2df24e4bee1`)

100 eval cases at baseline (76 dev, 24 holdout; 102 after phase 4) graded deterministically; advice answers
are also scored 1–5 by an LLM judge (`claude-opus-5-5`), kept out of the
success rate. Full reports: `evals/results/`. What changed after this:
[evals/ITERATION_LOG.md](evals/ITERATION_LOG.md).

| | Haiku 5.5 | Sonnet 5.5 | Qwen 3.6 35B-A3B (local) |
|---|---|---|---|
| Dev success (95% CI) | **91.7%** (87.4–94.6), 3 trials | **92.1%** (83.8–96.3), 1 trial | 75.0% (69.0–80.2), 3 trials |
| pass^3 (all 3 trials pass) | 86.8% | n/a (1 trial) | 55.3% |
| Holdout success (1 trial, n=24) | 91.7% | 91.7% | 87.5% |
| Severe / minor damage | 2.6% / 2.6% | 2.6% / 0% | 5.3% / 3.9% |
| Injection attack success | 0% | 0% | 12.5% |
| Over-asking / guessing | 4.8% / 23.1% | 2.9% / 15.4% | 3.8% / 17.9% |
| Tool calls (mean) | 3.2 | 3.4 | 2.3 |
| Cost / request | $0.0009 | $0.0158 | $0 |
| Latency p50 / p95 | 3.5 s / 9.4 s | 4.0 s / 8.3 s | 7.2 s / 90.0 s |
| Advice quality (judge, 1–5) | 3.19 | 4.00 | not judged |

**After phase 4, experiment 2** (prompt `3d211bac54ec`, four rules from the failure analysis): Haiku dev success 91.7% → **99.6%** (pass^3 98.7%), holdout 91.7% → **95.8%**, no damage, no guessing, and slightly cheaper ($0.00082 per request). The local Qwen model did not follow the new rules (77.2% → 76.3%). Details: [evals/ITERATION_LOG.md](evals/ITERATION_LOG.md).

**Judge calibration.** 16 Haiku advice answers were rated by the owner, then fact-checked one by one into reference scores (`evals/calibration/haiku-advice-adjudicated.csv`, one reason per answer). The first judge agreed with them exactly 31% of the time and within one point 69%. Its errors came from one harness bug (the judge never saw completion rows, so it called really missed recurring tasks invented) and two badly worded rubric foci. After fixing both (experiment 3a), the same answers agree **69% exact, 100% within one point** (`evals/results/judge_calibration.json`). That is in-sample and n = 16, so advice scores are for comparing runs, not an absolute grade.

**Experiment 3b (rejected).** A bug found in production (a "task not found" question asked in plain text) became two eval cases. The one-sentence prompt fix passed the holdout 25/25 but dropped dev success to 97.0% and caused a severe-damage failure, so it was reverted; the cases stay as a known weak spot. Details: [evals/ITERATION_LOG.md](evals/ITERATION_LOG.md).

Takeaways:

- **Haiku is the default.** Sonnet matches it on success (92.1% vs 91.7%,
  overlapping CIs) for 17× the cost per request; it guesses less and writes
  better advice, but that does not show up as more passed cases.
- **The local model's gap is half time, half skill.** 22 of its dev failures
  are timeouts at the 90 s budget: Qwen's thinking mode spends ~700 hidden
  tokens even on trivial questions. The rest are real: bulk edits (40%),
  ambiguity (62.5%), dates (67%), and one injection case where it proposed
  deleting shared tasks (the approval step would have stopped it).
- **The worst failures are shared by all three models**, which points at the
  prompt and the cases rather than the model; see the iteration log.
- Sonnet's first holdout run hit 11 `APITimeoutError`s (an API stall, not
  model behavior); the rerun is the one reported.

## Tool contract

Exactly 9 tools, called through `execute(ctx, name, args)`; schemas come from `tool_schemas()`.

- `search_tasks` - find tasks by text/filters (max 20 results, `truncated`/`total` when more); marks results as seen.
- `get_task` - full detail for one task, including notes and `external` (assigned by someone else); marks it seen.
- `get_agenda` - what is due over a date range (max 14 days, 20 items per day with `total`/`truncated`); clashing tasks are kept in `items` first and `clashes` lists only shown ids; marks the returned items as seen.
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

- `update` = `patch` (changed fields only) + `beforeFields` (old values of exactly those keys). `beforeFields` uses `null` both when the raw key held `null` and when it was absent. The app cannot tell those apart: the stale check should treat a missing field and `null` as the same value, and undo should write `null` back rather than deleting the key. Fields that are not in `patch` are left untouched, including ones the agent does not model.
- `delete` = verbatim `beforeRaw` (the task JSON as received) + `beforeCompletionsRaw`.
- `create` = `after` without injected defaults.
- `set_status` = `before` / `after` (`{status}`, one of `open` / `done` / `skipped`; `undone` arrives as `after.status` `open`) + `date` (the occurrence for a recurring task, `null` for a one-time task) + `beforeCompletionRaw`, which is what undo restores:
  - **`null`** when `before.status` is `open` (open → done, open → skipped). Nothing existed to restore; undo removes what apply created.
  - **Recurring task, `before.status` is `done` or `skipped`** (undone, done → skipped, skipped → done): the completion row for that task and `date`, exactly as received (`id`, `taskId`, `completionDate`, `completedAt`, `skipped` when present, and any other keys). Apply changes or deletes only the row with that `id`; undo writes this row back verbatim. If the snapshot had several rows for the same task and date, only the first is carried and only it may be touched.
  - **One-time task, `before.status` is `done`** (only `undone` is possible; one-time tasks cannot be skipped): `{"completedAt": <raw value>}` when the task had that key (the value may be `null`), or `{}` when the key was absent. Undo sets `completed` back to `true` and restores `completedAt` exactly: set it to the value, or remove the key for `{}`.

Known gaps and deferred work are tracked in [FOLLOWUPS.md](FOLLOWUPS.md).
