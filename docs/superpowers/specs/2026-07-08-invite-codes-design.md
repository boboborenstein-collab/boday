# Invite-only signup (access keys) — Design

**Date:** 2026-07-08
**Status:** Approved direction (in-app admin minting)

## Problem

BoDay is live at a public URL. Anyone who finds it can create an account via
Supabase's open signup. Jacob wants to share the app with friends only:
he generates a one-time access key, gives it to a friend, the friend signs up
with email + password + key, and the key is permanently linked to that account.
Sign-in never requires the key again.

Enforcement must be server-side — hiding the signup UI is not enough, since
`supabase.auth.signUp` can be called directly against the API.

## Design

### 1. Supabase

- New table `invite_codes`:
  `code text primary key, created_at timestamptz default now(), used_by text null, used_at timestamptz null`
- RLS ON. App-side (anon key): read-only, and only for the admin user
  (policy checks `auth.jwt() ->> 'email' = 'bobo.borenstein@gmail.com'`).
  No insert/update from the app — all writes go through the worker's
  service key, which bypasses RLS.
- Supabase dashboard: **disable public signups**
  (Auth → Sign In / Up → "Allow new users to sign up" OFF). The admin API
  used by the worker still creates users.

### 2. Push worker (`worker-push/src/index.ts`) — new routes

- `POST /signup` — body `{ email, password, code }`.
  1. Look up code; must exist with `used_by` null → else 400
     "That invite code isn't valid."
  2. Create user via Supabase Admin API
     (`POST /auth/v1/admin/users`, `email_confirm: true`).
  3. Update the code row: `used_by = new user id, used_at = now()`.
  - CORS headers so the app origin can call it.
- `POST /invites` — header `Authorization: Bearer <supabase access token>`.
  Worker verifies the token via `GET /auth/v1/user` and checks the email is
  the admin's (worker env var `ADMIN_EMAIL = bobo.borenstein@gmail.com`).
  Generates a code `BODAY-XXXX` (4 chars from an unambiguous alphabet,
  no 0/O/1/I), inserts it, returns `{ code }`.
- `GET /invites` — same auth; returns all codes with used/unused status and
  claimant email (joined via admin users listing) for the Settings list.

### 3. App — signup form (`src/components/AuthGate.tsx`)

- Sign-up mode gains an "Invite code" field.
- Submit posts to the worker's `/signup` instead of `supabase.auth.signUp`.
  On success, immediately `signInWithPassword` with the same credentials so
  the friend lands in the app in one step.
- Sign-in mode unchanged. Existing accounts unaffected.

### 4. App — admin section (`src/views/SettingsView.tsx`)

- Rendered only when the signed-in user's email equals the admin email.
- "Generate invite code" button → shows the new code prominently with a
  copy button (for texting to a friend).
- List of past codes: `BODAY-K7F3 — used by dave@… on Jul 3` /
  `BODAY-9QRT — unused`.

## Explicitly out of scope (YAGNI)

- Code expiry, revocation, multi-use codes, multiple admins.
  All easy to add later if ever needed.

## Error handling

- Invalid/used code → friendly inline error on the signup form.
- Duplicate email at signup → surface Supabase's error message.
- Worker unreachable → generic "Couldn't reach the server, try again."

## Testing

- Manual: generate a code in Settings; sign up in a private window with it
  (succeeds), reuse the same code (fails), sign up with a made-up code
  (fails), direct `supabase.auth.signUp` call (rejected — signups disabled).
- Worker logic kept in small pure-ish handlers so it can be eyeballed;
  no test framework currently exists in `worker-push/`.
