# Time format setting (12-hour / 24-hour) — design

Status: approved in chat 2026-10-27. Owner request: a 12h/24h setting that
also governs the AI's change cards and the AI's own replies.

## Goal

One setting decides how every clock time is shown to the user: task rows,
AI change cards and warnings, Shabbat/quiet-mode times, and the AI's
written replies. Stored data does not change.

## Non-goals

- Stored times stay `HH:mm` (`reminderTime: "09:00"`). The push worker, the
  .ics feed, the agent's tools and the eval fixtures are untouched.
- The task editor's time picker is the browser's native `<input type=time>`;
  it follows the device's own 12/24-hour setting and is not changed.
- Push notification bodies contain no clock times today; nothing to change.
- The zustand persist key `cadence-v1` is not renamed.

## App (`src/`)

- `Settings.timeFormat: '12h' | '24h'`, default `'12h'` (what the app shows
  today). The existing `{ ...DEFAULT_SETTINGS, ...p.settings }` merge
  backfills it for current users.
- Settings → Appearance: a two-option control "Time format: 12-hour /
  24-hour".
- `src/lib/format.ts`:
  - `formatTime(hhmm: string, fmt: TimeFormat): string` — `"09:00"` →
    `"9:00 AM"` (12h) or `"09:00"` (24h). Invalid input is returned as is.
    Replaces `formatReminder` (its one caller moves over).
  - `formatTimesInText(text: string, fmt: TimeFormat): string` — rewrites
    every `HH:mm` (00:00–23:59, word-bounded) inside a sentence. Used for
    server-written warning text ("Another open item is also set for 09:00
    on …").
  - `formatIsoTime(iso: string, fmt: TimeFormat): string` — clock time of an
    ISO timestamp in local time.
- Call sites:
  - `TaskRow` reminder chip → `formatTime`.
  - AI change cards (`src/lib/agentChat.ts` diff lines): a `reminderTime`
    value is shown with `formatTime` and the label "Reminder"; warning text
    goes through `formatTimesInText`. Other fields are unchanged.
  - `ShabbatSettings` "Next:" window and `QuietOverlay` end time →
    `formatIsoTime` (replacing `'h:mmaaa'` and `toLocaleTimeString`).
  - Candle lighting / havdalah (`hebcal.ts` `buildDayInfo`): store the time
    as `HH:mm` taken from the item's ISO `date` instead of the title text;
    `TodayView` and `CalendarView` render it with `formatTime`. If the item
    has no time part, keep today's title-text behavior.
- Agent request: `AgentChat` sends `timeFormat` (the setting) in the run
  request body.

## Server and agent (`agent/`)

- Contract: `RunRequest` gains optional `time_format` (JSON `timeFormat`),
  `"12h" | "24h"`; absent means no preference. Older apps keep working.
  The API contract rows in the phase 5a/5b plans get the new field.
- `AgentRequest` gains `time_format: Literal["12h", "24h"] | None = None`;
  `run_agent` passes it to `build_messages` → `render_context`.
- `render_context` with `"12h"`: the `Now:` line uses 12-hour time
  (`Now: Mon 2026-10-26 2:05 PM (America/Los_Angeles)`) and one line is
  added before `</context>`:
  `Write clock times for the user in 12-hour format (2:05 PM); tool
  arguments stay HH:mm.` With `"24h"`: `Now:` is unchanged and the line
  says `24-hour format (14:05)`. With `None`: output is byte-for-byte what
  it is today.
- The system prompt and tool schemas do not change, so `PROMPT_VERSION`,
  the cassettes and CI replay are unaffected (eval cases never set a
  format).
- Redeploy Cloud Run after merge.

## Testing

- App (`scripts/test-agent.ts` / logic tests, matching where similar
  helpers are tested): `formatTime` (midnight, noon, 23:59, invalid),
  `formatTimesInText`, diff lines for a `reminderTime` patch in both
  formats, warning reformat, `buildDayInfo` candle time from ISO date.
- Agent (pytest): `render_context` for `None` (unchanged), `"12h"`,
  `"24h"`; `RunRequest` accepts and rejects values; the server passes the
  field through to `run_agent`.
- Live check after deploy (Haiku, < $0.01): "move my standup to 9:30" in
  each format; the reply uses the matching format.

## Risks

- The model may still write a 24-hour time now and then in 12h mode; the
  change cards and warnings are formatted by the app regardless, so the
  structured parts are always right.
- `formatTimesInText` could touch a non-time `NN:NN` in a task title inside
  a warning; acceptable (warnings name times, titles rarely contain one).
