# Time Format Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 12h/24h setting that governs every clock time shown in the app, the AI change cards and warnings, and the AI's replies.

**Architecture:** Stored times stay `HH:mm`. The app formats at render time through three helpers in `src/lib/format.ts`. The app sends `timeFormat` with each agent run; the agent adds it to the per-request context only (system prompt unchanged).

**Tech Stack:** React 19 + TS (tests: `npm run test:logic`, `npm run test:agent`), Python agent (pytest).

**Spec:** `docs/superpowers/specs/2026-10-27-time-format-design.md`

## Global Constraints

- Never rename the zustand persist key `cadence-v1`.
- `Settings.timeFormat` default `'12h'`.
- `render_context(..., time_format=None)` output must be byte-identical to today (cassettes depend on it).
- 12h line: `Write clock times for the user in 12-hour format (2:05 PM); tool arguments stay HH:mm.` 24h line: `Write clock times for the user in 24-hour format (14:05); tool arguments stay HH:mm.`
- Branch `feat/time-format`; never implement on `main`.

## Review Focus

- Midnight/noon: `00:00` → `12:00 AM`, `12:00` → `12:00 PM`.
- `reminderTime: null` in a patch (reminder removed) shows `none`, not `null`.
- Old app (no `timeFormat` in the request) gets the old context.
- Hebcal candle item without a time in `date` keeps the title-text time.
- Warning text with a date and a time (`09:00 on 2026-10-22`) only rewrites the time.

---

### Task 1: Agent accepts timeFormat

**Files:** `agent/boday_agent/prompt.py`, `agent/boday_agent/loop.py`, `agent/boday_agent/server/contract.py`, `agent/boday_agent/server/app.py`; tests in `agent/tests/test_prompt.py`, `agent/tests/test_server_app.py`; contract rows in the phase 5a/5b plans.

**Produces:** `TimeFormat = Literal["12h", "24h"]` in `prompt.py`; `render_context(snapshot, clock, time_format: TimeFormat | None = None)`; `build_messages(..., time_format=None)`; `AgentRequest.time_format: TimeFormat | None = None`; `RunRequest.time_format` (alias `timeFormat`).

- [ ] Tests: `None` output equals the current output; `"12h"` → `Now:` line uses `%-I:%M %p` and the 12h line before `</context>`; `"24h"` → 24h line; `RunRequest` rejects `"13h"`; the server passes `timeFormat` to `run_agent`.
- [ ] Implement, run `uv run pytest`, ruff, commit.

### Task 2: App setting and format helpers

**Files:** `src/types.ts` (Settings + DEFAULT_SETTINGS), `src/lib/format.ts`, `scripts/test-logic.ts`.

**Produces:** `type TimeFormat = '12h' | '24h'`; `formatTime(hhmm, fmt)`; `formatTimesInText(text, fmt)`; `formatIsoTime(iso, fmt)`; `formatReminder` removed.

- [ ] Tests (test-logic): `formatTime('09:00','12h')==='9:00 AM'`, `('00:00','12h')==='12:00 AM'`, `('12:00','12h')==='12:00 PM'`, `('23:59','24h')==='23:59'`, `('9:5','12h')` returned as is; `formatTimesInText('set for 09:00 on 2026-10-22','12h')==='set for 9:00 AM on 2026-10-22'`.
- [ ] Implement, run `npm run test:logic`, commit.

### Task 3: AI change cards follow the format

**Files:** `src/lib/agentChat.ts` (`diffModel` gains `fmt: TimeFormat = '24h'` as 4th param), `src/components/AgentDiffCard.tsx`, `scripts/test-agent.ts`.

- [ ] Tests: a `reminderTime` patch `09:00 → 10:30` gives `Reminder: 9:00 AM → 10:30 AM` (12h) and `Reminder: 09:00 → 10:30` (24h); `null` before shows `none`; a create's `reminderTime` uses the same label; warning `09:00` is reformatted; existing `update line` check still passes.
- [ ] Implement, pass the setting from the card, `npm run test:agent`, commit.

### Task 4: Every other time display + the request field

**Files:** `TaskRow.tsx`, `ShabbatSettings.tsx`, `QuietOverlay.tsx`, `src/lib/hebcal.ts` (`buildDayInfo` stores `HH:mm` from ISO `date` when it has a time), `TodayView.tsx`, `CalendarView.tsx`, `SettingsView.tsx` (Appearance: "Time format" 12-hour / 24-hour), `AgentChat.tsx` + request type (`timeFormat` in the run body).

- [ ] Tests (test-agent / test-logic): `buildDayInfo` candle `2026-10-30T17:52:00-07:00` → `candles === '17:52'`; item without time keeps the title text; the run request body includes `timeFormat`.
- [ ] Implement, `npm run build`, both test suites, commit, push, PR.

### Task 5: Ship

- [ ] Merge, redeploy Cloud Run (`agent/DEPLOY.md` deploy command), live check with Haiku in both formats (< $0.01), `npm run build && npx wrangler deploy` (Cloudflare account check first).
