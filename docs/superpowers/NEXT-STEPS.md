# BoDay Agent — Next Steps (start here)

Hand-off document for any agent (Claude Code, Cursor, local or cloud) picking
up the BoDay natural-language agent project. Read this first, then the spec
and the plan for your track.

- **Spec (the authority):** `docs/superpowers/specs/2026-10-20-boday-agent-design.md`
- **Process skills:** `.claude/skills/<name>/SKILL.md` (a reference like
  `superpowers:executing-plans` means that file). See the "Executing
  implementation plans" section of `CLAUDE.md` / `AGENTS.md`.
- **Known follow-ups:** `agent/FOLLOWUPS.md`

## Status (2026-10-20)

| Phase | What | Status |
|---|---|---|
| 1 | Domain models, recurrence port, date resolver, 9 tools | ✅ Done — PR #1 (merge it before starting below) |
| 2 | Agent loop, providers (Claude + OpenAI-compatible + Auto), tracing, CLI | ⏭️ Ready — plan written |
| 3A | Eval cases (~100), fixtures, grader, oracle | ⏭️ Ready — plan written, runs **in parallel** with phase 2 |
| 3B | Eval runner, metrics, judge, cassettes, baseline | ⏸ Waits for phase 2 + 3A |
| 4 | Iterate on eval failures | ⏸ Waits for 3B baseline |
| 5 | FastAPI service, Cloud Run, app chat UI, apply/undo | ⏸ Plan not written yet |

**Prerequisite for both tracks below:** PR #1 (`agent/phase1-tools`) is merged
into `main`. If `agent/boday_agent/tools/` does not exist on `main`, stop and
tell the owner.

## Two parallel tracks

| | Track A — Phase 2 | Track B — Phase 3A |
|---|---|---|
| Plan | `docs/superpowers/plans/2026-10-20-agent-phase2-loop.md` | `docs/superpowers/plans/2026-10-20-agent-phase3-evals.md` — **Part A only (Tasks A1–A6)** |
| Branch | `agent/phase2-loop` | `agent/phase3a-cases` |
| Creates | `agent/boday_agent/{providers/,prompt.py,tracing.py,pricing.py,loop.py,cli.py}`, `agent/examples/` | `agent/boday_agent/evals/`, `agent/evals/{cases,fixtures}/`, `agent/tests/evals/` |
| Must NOT touch | `agent/boday_agent/evals/`, `agent/evals/` | `agent/boday_agent/{providers,loop,prompt,tracing,pricing,cli}*` |
| Needs secrets? | Only Task 7 Step 5–6 (one real Claude call) — **skip in the cloud** | No |
| FOLLOWUPS it owns | "Before phase 2 / during phase 2" section | "Before phase 3" section |

Both tracks edit `agent/pyproject.toml` and `agent/uv.lock` (new deps), and may
edit different sections of `agent/FOLLOWUPS.md`. Whichever PR merges second
must rebase onto `main`, resolve `pyproject.toml` by keeping both sides' deps,
then run `uv lock` (never hand-edit `uv.lock`) and re-run the tests.

## Rules for every agent

1. **Branch:** create your track's branch from up-to-date `main`. One agent per
   branch, ever. Never commit to `main`.
2. **Process:** follow `.claude/skills/executing-plans/SKILL.md` (which requires
   `test-driven-development` and `verification-before-completion`). Do the
   plan's tasks in order; for each: failing test → implement → `uv run pytest -q
   && uv run ruff check .` green → commit → **push** → tick that task's
   checkboxes in the plan file and commit that too.
3. **The plan's Global Constraints and Review Focus sections bind every task.**
   The spec wins over the plan if they conflict; note the conflict in the PR
   description.
4. **Commit messages** end with a blank line and
   `Co-Authored-By: <your model name> <noreply@anthropic.com>` (or your tool's
   equivalent attribution).
5. **Never** put API keys or secrets in code, tests, fixtures, traces or commits.
   Unit tests never touch the network.
6. **Stop and ask the owner** (don't guess) if: a task needs a secret, a real
   model call, or the owner's Mac; a plan step is impossible as written; or you'd
   need to change files the other track owns.
7. **Finish:** CI green on your branch (`gh run list --branch <branch>`), open a
   PR into `main` titled as in the plan's last step, list in the PR description
   anything skipped (e.g. phase 2 Task 7 Step 5–6), and any FOLLOWUPS items you
   completed or added.

## Environment setup (cloud VMs)

```bash
# Python toolchain (uv) — skip if `uv --version` works
curl -LsSf https://astral.sh/uv/install.sh | sh && export PATH="$HOME/.local/bin:$PATH"
cd agent && uv sync && uv run pytest -q     # expect all phase 1 tests green before you start
```

Node is only needed for the recurrence parity check (`npm ci` at repo root,
then `TZ=America/New_York npx tsx scripts/gen-recurrence-parity.ts`); neither
track needs it unless it changes `src/lib/recurrence.ts` (it shouldn't).

## What only the owner can do (after the tracks finish)

- Merge the two PRs (Track A and Track B), resolving the `uv.lock` rebase.
- Phase 2 Task 7 Step 5–6: first real end-to-end run —
  `cd agent && uv run boday-agent "move my dentist appointment to tomorrow" --snapshot examples/demo_snapshot.json --provider anthropic --model claude-haiku-5-5`
  (needs `ANTHROPIC_API_KEY` or `ant auth login`; costs < $0.01).
- Then start Phase 3B (needs both merged); its baseline runs need a Claude key
  and the Mac for the local model, with a cost estimate approved first.
