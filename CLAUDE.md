# BoDay - PWA Task/Routine Manager

## Project Overview
BoDay is a React + TypeScript + Vite PWA for managing daily tasks and recurring routines with calendar visualization and priority management.

## Running the App

### Start Development Server
```bash
npm run dev
```
The app will be available at **http://localhost:5173**

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Features
- **Calendar View**: Month-at-a-glance with color-coded task indicators
- **Daily View**: Today's tasks with summary metrics (To do, Carried over, P1, Done)
- **Task Management**: Create/edit one-time or recurring tasks
- **Priority Levels**: P1 (Urgent/Red), P2 (High/Orange), P3 (Medium/Blue), P4 (Low/Purple)
- **Smart Recurring**: Tasks reset daily without piling up
- **Carry-Over Tracking**: Shows how many days tasks have been delayed
- **PWA**: Works offline with local storage

## Tech Stack
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Zustand (state management)
- React Router v7
- date-fns (date utilities)

## Deployment & Infrastructure (all live, all free-tier)
- **App**: https://boday.boapps.workers.dev — Cloudflare Workers static assets.
  Deploy: `npm run build && npx wrangler deploy` (repo-root `wrangler.jsonc`).
- **Push worker**: `worker-push/` — cron every minute. On-time reminders,
  per-task re-nudge (Auto/Off/5m–2h; Auto = P1 hourly, P2 at 2h+6h), 9AM digest.
  Deploy: `npx wrangler deploy` inside `worker-push/`. `GET /test` sends a test push.
- **Invite-only signup** (2026-07-08): public Supabase signups DISABLED.
  Signup goes through the push worker: `POST /signup` {email, password, code}
  validates a one-time code from the `invite_codes` table and creates the user
  via the admin API; `POST/GET /invites` (admin bearer token, `ADMIN_EMAIL` =
  bobo.borenstein@gmail.com) mints/lists codes. Admin UI: Settings → Invites
  (visible only to the admin). Client: `src/lib/invites.ts`.
- **Supabase** (project cgsjsbsxuzawvgunrpqi): tables `tasks` / `completions` /
  `push_subscriptions`, all `(id text pk, user_id text, data jsonb)`. Multi-user:
  email+password auth (AuthGate), RLS ON ("own rows" policy), worker reads via
  `SUPABASE_SERVICE_KEY` wrangler secret. App keys live in gitignored `.env`.
- **Do NOT rename** the zustand persist key `cadence-v1` (wipes user data).

## Roadmap — next things to build (user-approved 2026-07-06)

**Next up (user's picks + Apple Calendar):**
- **Apple Calendar integration** — two stages:
  1. *BoDay → Calendar feed (build first)*: .ics subscription endpoint on the push
     worker, per-user secret URL; all tasks as all-day entries, reminder-timed
     tasks as timed events. User subscribes once via iPhone Settings → Calendar.
  2. *Calendar → BoDay (later, optional)*: iOS Shortcut posting to a small
     "inbox" endpoint (share-an-event or nightly auto-import). No web API exists
     for reading iCloud calendars — Shortcuts is the only sane path.
- **Snooze buttons on push notifications** — "remind me in 30m" from the push.
- **Share/assign tasks between friends** — accounts exist; add task sharing.

**High value, doable:**
- Subtasks / checklists ("Pack for trip" with sub-items)
- Evening digest (~8 PM "3 things left today", companion to 9 AM digest)
- Compact "today at a glance" start screen

**Medium effort:**
- NLP parser upgrades ("every other Tuesday", "in 3 weeks", locations)
- Weekly review screen (finished / kept carrying over / streak health)
- Voice input (browser speech recognition)

**Bigger swings:**
- AI assist ("plan my day" ordering; voice note → structured tasks; small API cost — the one exception to free)
- Shared lists/spaces (household grocery list, multi-account)

**Maps/location constraints (researched):**
- ✅ Possible: location attached to a task, map preview via OpenStreetMap
  (Apple MapKit JS needs the $99 dev account — skip), tap-to-navigate link that
  opens the Apple Maps app.
- ❌ Not possible in a PWA: geofenced "remind me when I arrive" — iOS reserves
  background location for App Store apps.

## Running Demo
To launch and demo the app in the browser:
```bash
/run
```
This will start the dev server and open it in browser automation.
