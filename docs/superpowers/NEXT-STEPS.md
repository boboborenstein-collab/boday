# BoDay Agent — Next Steps (start here)

Hand-off document for any agent (Claude Code, Cursor, local or cloud) picking
up the BoDay natural-language agent project. Read this first, then the spec
and the plan for your track.

- **Spec (the authority):** `docs/superpowers/specs/2026-10-20-boday-agent-design.md`
- **Process skills:** `.claude/skills/<name>/SKILL.md` (a reference like
  `superpowers:executing-plans` means that file). See the "Executing
  implementation plans" section of `CLAUDE.md` / `AGENTS.md`.
- **Known follow-ups:** `agent/FOLLOWUPS.md`

## Status (2026-10-27, project complete)

| Phase | What | Status |
|---|---|---|
| 1 | Domain models, recurrence port, date resolver, 9 tools | ✅ Done — PR #1 |
| 2 | Agent loop, providers, tracing, CLI, first real run | ✅ Done — PRs #2, #4 |
| 3A | 100 eval cases, fixtures, grader, oracle | ✅ Done — PR #3 |
| — | FOLLOWUPS cleanup before baseline (Track E) | ✅ Done — PR #6 |
| 3B code | Runner, metrics + report, judge, cassettes + CI replay (Track C) | ✅ Done — PR #7 |
| 5 plans | Service + app plans (Track D) | ✅ Done — PR #5 |
| 5a | FastAPI service (built, not deployed) | ✅ Done — PR #8 |
| 5b | App chat UI (built, not deployed) | ✅ Done — PR #9 |
| 3B baseline | Task B5 paid runs + write-up (Haiku, Sonnet, local Qwen, judge calibration) | ✅ Done — PR #10; see `agent/README.md` Results, `agent/evals/ITERATION_LOG.md` |
| 4 | Experiments 1–2: Qwen thinking off, prompt rules (Haiku dev 91.7% → 99.6%, holdout 95.8%) | ✅ Done — PR #11; see `agent/evals/ITERATION_LOG.md` |
| 5 deploy | Cloud Run (`boday-agent`, us-west1), Supabase `agent_traces`, secrets, app `VITE_AGENT_URL` | ✅ Live 2026-10-26, Haiku only (`agent/DEPLOY.md`) |
| 5 local | Cloudflare tunnel + Access token for LM Studio, `BODAY_LOCAL_*` env vars | Live 2026-10-28 (PR #14, revision boday-agent-00004-wsb); live check: Mac up → Qwen, LM Studio stopped → Haiku |
| 4 exp 3 | Judge sees completions + rubric fix (kept: 31% → 69% exact agreement); not-found prompt rule (rejected); `merge_user_prefs` security fix; root README | ✅ Done — PR #12 |
| Later (optional) | Harness retry when a final answer ends in an unasked question (not-found cases) | — |

## Round 2 — two parallel tracks (done; kept for reference)

| | Track F — Phase 5a service | Track G — Phase 5b app |
|---|---|---|
| Plan | `docs/superpowers/plans/2026-10-21-agent-phase5a-service.md` | `docs/superpowers/plans/2026-10-21-agent-phase5b-app.md` |
| Branch | `agent/phase5a-service` | `agent/phase5b-app` |
| Owns | the plan's File map: `agent/boday_agent/server/`, `agent/sql/`, `agent/Dockerfile`, `agent/.dockerignore`, `agent/DEPLOY.md`, `agent/tests/test_server_*.py`, `agent/tests/fixtures/api_contract_*.json`, `agent/pyproject.toml` / `uv.lock` (via `uv add`) | the plan's File map: `src/`, `scripts/agent-test-shim.ts`, `scripts/test-agent.ts`, `package.json` / `package-lock.json`, `.env.example` |
| Must NOT touch | `src/`, `package.json`, existing `agent/boday_agent/` modules outside `server/`, `agent/evals/`, the spec, other plans | `agent/`, the spec, other plans |
| Owner steps (skip, list in PR) | GCP billing, Cloud Run deploy, Supabase migration run, secrets, Cloudflare Access token, pg_cron delete | Production `VITE_AGENT_URL` + deploy |
| Checks | `cd agent && uv run pytest -q && uv run ruff check . && uv run boday-eval validate` | `npm run test:agent && npm run test:logic && npm run typecheck && npm run build` (per the plan's Global Constraints) |

The API contract section is byte-identical in both plans; neither track may
change it. If a contract change looks necessary, stop and ask the owner.
The two PRs touch disjoint files, so they merge in either order.

## Round 1 — three parallel tracks (done; kept for reference)

| | Track C — Phase 3B code | Track D — Phase 5 plans | Track E — Follow-ups cleanup |
|---|---|---|---|
| Plan / source | `docs/superpowers/plans/2026-10-20-agent-phase3-evals.md`, **Part B Tasks B1–B4 only** | Spec §2, §5–§8 + `agent/README.md` "Payload contract"; skill `.claude/skills/writing-plans/SKILL.md` | `agent/FOLLOWUPS.md` (sections listed below) |
| Branch | `agent/phase3b-runner` | `docs/phase5-plans` | `agent/followups-cleanup` |
| Owns | `agent/boday_agent/evals/`, `agent/tests/evals/`, `agent/evals/` (new files: `ci_cases.txt`, `cassettes/`, `results/`), `.github/workflows/agent.yml` | New files under `docs/superpowers/plans/` only | `agent/boday_agent/{tools,domain}/`, `agent/tests/test_*.py` (not `tests/evals/`), `scripts/gen-recurrence-parity.ts`, `agent/tests/fixtures/` |
| Must NOT touch | `tools/`, `domain/`, `loop.py`, `providers/`, `prompt.py`, `tracing.py`, `cli.py` (the agent CLI), `src/` | Any code; existing plans and the spec (propose spec changes in the PR description instead) | `agent/boday_agent/evals/`, `agent/evals/`, `agent/tests/evals/`, `.github/`, `loop.py`, `providers/`, `prompt.py`, `src/` |
| Needs secrets? | No. Unit tests use `FakeProvider` and stub clients. **Do not do Task B5** (paid runs, owner only). | No | No. Skip the `$defs`/`oneOf` real-local-model check (needs the owner's Mac); list it in the PR. |
| PR title | `Agent phase 3B: eval harness (runner, metrics, judge, cassettes)` | `Agent phase 5: service + app plans` | `Agent: follow-ups cleanup before baseline` |

### Track D details (plans only, no code)

Write **two** plans with `.claude/skills/writing-plans/SKILL.md`, same format as
the existing plans (Global Constraints, Review Focus, Files / Interfaces per
task, checkbox steps, TDD):

1. `docs/superpowers/plans/2026-10-21-agent-phase5a-service.md` — FastAPI
   service in `agent/boday_agent/server/` (new package): request/response
   endpoints and `POST /feedback`, Supabase JWT auth, provider-key encryption
   (AES-GCM), SSRF guard for custom base URLs, `agent_traces` table + RLS +
   `agent_tracer` role (SQL migration file), Dockerfile, Cloud Run deploy notes.
2. `docs/superpowers/plans/2026-10-21-agent-phase5b-app.md` — React app in
   `src/`: ✨ Ask entry + command palette, chat panel (bottom sheet / side
   panel), diff card, `src/lib/agentApply.ts` (atomic apply, stale check,
   undo, `setRecurringStatus`), Settings → AI, offline state, trace ID display.

Requirements:
- **One shared API contract** (endpoint paths, request and response JSON,
  error shapes, auth header) defined once in 5a and copied verbatim into 5b,
  so the two plans can be built **in parallel by different agents**. 5b builds
  and tests against a mocked client, never a live server.
- Read the real app code before planning 5b (`src/store/`, `src/types.ts`,
  `src/lib/sync.ts`, `src/components/Layout.tsx`, the command palette); match
  its patterns. Never rename the zustand persist key `cadence-v1`.
- Fold in FOLLOWUPS "Before phase 5" items that belong to each side (e.g. the
  app deletes only completion ids listed in `beforeCompletionsRaw`).
- Mark every step that needs the owner (GCP billing / Cloud Run deploy,
  Supabase migration run, secrets, Cloudflare Access token) as **owner step**,
  so build agents skip it.
- Anything the spec leaves open: list it as a question in the PR description;
  don't silently decide.
- The owner's reviewer checks these plans before round 2 starts.

### Track E details

Do these `agent/FOLLOWUPS.md` items, with a failing test first for each:
- **"Before / during phase 2" leftovers:** `registry._run` try-wrap;
  `UpdateChanges` schema cleanup; recurrence parity fixture additions
  (regenerate with `TZ=America/New_York npx tsx scripts/gen-recurrence-parity.ts`
  after `npm ci`; CI diffs it).
- **"Before phase 3":** `get_agenda` per-day item cap; validate `Fault.call >= 1`.
  Leave the `CONFLICTING_CHANGE` item (it is decided from eval evidence).
- **"Before phase 5":** lossless undo of `set_status` `undone` (raw completion
  row on `StatusChange`); document the `beforeFields` null-vs-absent convention
  (README "Payload contract"); guard `Snapshot.from_app` against non-dict input.
  Skip the app-side item (Track D owns it).
- **"Test gaps":** all of them.
- **Do NOT do the "Phase 4 (iteration candidates)" section.** Those are what the
  baseline should measure; fixing them first would erase the before/after.
- Tick each finished item in `FOLLOWUPS.md` (edit only those sections).
- Also run `uv run boday-eval validate` before each commit: tool changes must
  keep all 100 cases valid. If a change would require editing eval cases or
  `evals/` code, stop and ask the owner instead.

### Overlaps and merge order

- `agent/FOLLOWUPS.md`: C and E may each tick items in their own sections
  only. `agent/pyproject.toml` / `uv.lock`: if both add deps, the second PR
  rebases, keeps both sides (one `[project.*]` section each, no duplicates),
  runs `uv lock`, and re-runs the tests.
- Merge order: **E first** (smallest), then **C**, then **D** (docs, no
  conflicts).

## Round 2 outline (superseded by the section above)

- **Track F — phase 5a service** and **Track G — phase 5b app**, in parallel,
  from the Track D plans.
- **Owner + Claude on the Mac:** Task B5 baseline runs (Haiku, Sonnet, local),
  cost estimate approved first. Then phase 4 iteration.

## Rules for every agent

1. **Branch:** create your track's branch from up-to-date `main`. Use the
   branch name above, not an auto-generated one. One agent per branch, ever.
   Never commit to `main`.
2. **Process:** follow `.claude/skills/executing-plans/SKILL.md` (which requires
   `test-driven-development` and `verification-before-completion`). Do the
   tasks in order; for each: failing test → implement → checks green → commit
   → **push** → tick that task's checkboxes in the plan file and commit that too.
   Checks: `cd agent && uv run pytest -q && uv run ruff check . && uv run boday-eval validate`.
3. **The plan's Global Constraints and Review Focus sections bind every task.**
   The spec wins over the plan if they conflict; note the conflict in the PR
   description.
4. **Commit messages** end with a blank line and
   `Co-Authored-By: <your model name> <noreply@anthropic.com>` (or your tool's
   equivalent attribution).
5. **Never** put API keys or secrets in code, tests, fixtures, traces or commits.
   Unit tests never touch the network. Never make paid model calls.
6. **Stop and ask the owner** (don't guess) if: a task needs a secret, a real
   model call, or the owner's Mac; a plan step is impossible as written; or you'd
   need to change files another track owns.
7. **Finish:** CI green on your branch (`gh run list --branch <branch>`), open a
   PR into `main` with the title above, and list in the PR description anything
   skipped and any FOLLOWUPS items you completed or added. Don't merge it; the
   owner reviews and merges.

## Environment setup (cloud VMs)

```bash
# Python toolchain (uv) — skip if `uv --version` works
curl -LsSf https://astral.sh/uv/install.sh | sh && export PATH="$HOME/.local/bin:$PATH"
cd agent && uv sync && uv run pytest -q     # expect all tests green before you start
```

Node is needed only for the recurrence parity check (Track E): `npm ci` at the
repo root, then `TZ=America/New_York npx tsx scripts/gen-recurrence-parity.ts`.

## What only the owner can do

- Review and merge round 1 PRs (E, then C, then D).
- Task B5: baseline runs — need `ANTHROPIC_API_KEY` (in gitignored
  `agent/.env`) and the Mac for the local model; cost estimate approved first.
- Phase 5 owner steps: GCP billing + Cloud Run deploy, Supabase migration,
  secrets, Cloudflare Access service token.
