# Cadence

A cross-platform task & routine manager built as an **installable PWA** — one
codebase that runs in the browser on desktop and installs to the home screen on
phone. The defining feature is smart **carry-over** for one-time tasks plus
flexible **recurring routines**, with a calendar, priorities, streaks, and
(later) push reminders.

> Status: **Phases 1, 2 and 4 are built and verified.** Phases 3 (Supabase) and
> 5 (Notifications) are intentionally not started — they need your accounts /
> keys and a quick approval. See [Roadmap](#roadmap).

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run build        # type-check (tsc) + production build + PWA service worker
npm run preview      # serve the production build
npm run test:logic   # run the engine assertion suite (carry-over / recurrence / streaks)
npm run gen:icons    # regenerate PWA icons in /public
```

The app seeds itself with realistic demo data on first run (stored in
`localStorage`). To wipe it, clear the `cadence-v1` key (or run
`localStorage.removeItem('cadence-v1')` in the console) and reload.

---

## Stack

| Concern        | Choice                                             |
| -------------- | -------------------------------------------------- |
| Build / app    | React 19 + Vite                                    |
| PWA            | `vite-plugin-pwa` (Workbox SW + web manifest)      |
| Styling        | Tailwind CSS v4 with **design tokens** (`@theme`)  |
| State          | Zustand + `persist` (localStorage for now)         |
| Dates          | `date-fns`                                         |
| Routing        | React Router                                       |
| Backend (next) | Supabase (Postgres + RLS + Auth + Realtime)        |

### Reskinning (Claude Design)

The UI is deliberately **not over-styled** — it's correct and well-structured so
it's trivial to restyle. **All colors, radii, and fonts live as CSS variables in
[`src/index.css`](src/index.css) under `@theme`.** Components reference semantic
Tailwind classes (`bg-surface`, `text-muted`, `bg-p1`, `text-accent`, …) and
never raw hex. To reskin, edit the token values — components don't need to change.

---

## Architecture

### Two task types (the core idea — kept deliberately separate)

1. **One-time tasks** *(carry over)* — have a `scheduledDate` and a `completed`
   flag. They appear in **Today** whenever `scheduledDate <= today && !completed`,
   so they chase you forward until done. No cron job ever moves a row — carry-over
   is purely a **query**. A `carried Nd` badge shows how long it's been waiting.

2. **Recurring tasks / routines** *(do NOT carry over)* — have a `recurrence`
   pattern (`daily`, `weekly` by days-of-week, or `everyNDays`) plus
   `startDate`/optional `endDate`. Completions are tracked **per date** in a
   separate `TaskCompletion` collection — a row exists only for a day you checked
   it off. Missing Wednesday doesn't create a backlog; Thursday is just a fresh
   unchecked occurrence. Per-date rows give us **streaks** and an accurate
   history calendar.

### The engine ([`src/lib/`](src/lib))

Everything is **pure** and takes the date as an argument (never reads "today"
internally), so it's unit-testable and will be reused unchanged against Supabase
rows in Phase 3.

- [`recurrence.ts`](src/lib/recurrence.ts) — `occursOn`, `buildTodayList`
  (carry-over semantics), `buildDayList` (calendar — carry-over does **not**
  smear across days), `summarizeDay`, sorting.
- [`streaks.ts`](src/lib/streaks.ts) — `currentStreak`. Counts consecutive
  *scheduled occurrences* with a completion, walking backward. **Today-rule:** a
  still-open occurrence *today* is forgiven (doesn't break the streak); any
  earlier miss does.
- [`date.ts`](src/lib/date.ts) — date discipline: store/compare `yyyy-MM-dd`
  strings; use `parseISO` for date math; never `new Date('yyyy-MM-dd')` (UTC
  off-by-one trap).

#### Date discipline (why it matters)

Dates are stored and compared as `'yyyy-MM-dd'` strings, so range/carry-over
checks are timezone-proof string comparisons. When a `Date` is needed (weekday,
N-day interval) we use `parseISO` (local) and `differenceInCalendarDays` (DST-safe).

### Verifying the engine

`npm run test:logic` runs [`scripts/test-logic.ts`](scripts/test-logic.ts): 27
assertions over adversarial seed data covering carry-over (incl. multi-day
badges), future/completed hiding, every-N anchoring, weekday recurrence, streaks
with the today-rule, sort order, and the calendar "no smear" rule.

### Layout

```
src/
  types.ts                 # OneTimeTask | RecurringTask, TaskCompletion, DayItem
  lib/                     # pure engine: date, recurrence, streaks, priority, format
  store/
    useStore.ts            # Zustand store + persist + CRUD + completion toggles
    seed.ts                # adversarial demo data (relative to "today")
  components/              # TaskRow, TaskEditor (modal), Layout/nav, icons, ...
  views/
    TodayView.tsx          # default screen: stats + sorted day list
    CalendarView.tsx       # month/week grid + selected-day detail
  App.tsx, main.tsx
scripts/
  test-logic.ts            # engine assertions
  gen-icons.mjs            # dependency-free PNG icon generator
```

---

## Features built

- **Today view** — date header; stat chips (to-do / carried over / P1 / done);
  a single list combining recurring occurrences for today + one-time tasks due
  today + carried-over one-time tasks; grouped by priority with completed items
  sunk to the bottom; carry-over badges; per-routine streak flames. Tap the
  circle to complete (writes a per-date completion for routines, sets
  `completed` for one-time tasks); tap the row to edit.
- **Calendar view** — month and week grids with per-day priority dots; today
  highlighted, any day selectable; the selected day's tasks listed below with
  completion status and streaks. Past days reflect what was actually done.
- **Create / edit** — modal with one-time vs recurring toggle, priority (P1–P4),
  notes, day-of-week picker / every-N-days / every-day, start & optional end
  date, optional reminder time, and delete.
- **Priorities** — P1 Urgent → P4 Low, color-coded and used for sort + calendar
  dots.
- **Installable PWA** — web manifest, generated icons, auto-updating service
  worker (enabled in dev too, for testing notifications later).
- **Local persistence** — Zustand `persist` to `localStorage` (verified across
  reloads). This is the Phase-2 stand-in for the backend.

---

## Decisions made (defaults — easy to change)

- **Priority:** P1–P4 (P1 highest), Todoist-style.
- **Recurrence:** all three of every-day / days-of-week / every-N-days
  implemented now. Monthly is left as a future addition.
- **State:** Zustand (light) with `persist`.
- **Persistence today:** `localStorage`, so the carry-over + recurrence logic is
  provable with zero backend. Swapped for Supabase in Phase 3.
- **Front end:** built here with clean component boundaries + design tokens so it
  can be reskinned in Claude Design without touching component logic.

---

## Roadmap

### Phase 3 — Supabase (needs your approval + project) — NOT STARTED

Postgres schema (one `tasks` table with a `type` discriminator + a
`task_completions` table), Row Level Security scoped to `auth.uid()`, Auth
(email/password or magic link), wire CRUD to Postgres, and Realtime sync across
devices. The pure engine functions are reused as-is against fetched rows.

**Needs from you:** a Supabase project (URL + anon key), and a decision on
hosting for the deployed PWA.

### Phase 5 — Notifications (needs VAPID keys) — NOT STARTED

Web Push: register the SW push subscription, store it per user/device, send via a
Supabase Edge Function triggered by `pg_cron` (due-reminder checks + an optional
daily morning summary).

**iOS caveat (will be surfaced in the UI):** Web Push on iOS only works for a PWA
**added to the home screen** (iOS 16.4+), not in a Safari tab. Android Chrome and
desktop work normally. If push proves fiddly, the fallback is in-app reminders +
the daily summary first.
