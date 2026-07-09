# Invite-Only Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate BoDay signups behind one-time invite codes that Jacob mints from an admin section in Settings; sign-in stays unchanged.

**Architecture:** A new `invite_codes` table in Supabase; the existing push worker (which holds the service-role key) gains `/signup` and `/invites` HTTP routes; the app's signup form posts to the worker instead of Supabase; a Settings section visible only to the admin mints and lists codes. Public Supabase signups get disabled last.

**Tech Stack:** Cloudflare Worker (TypeScript, no framework), Supabase REST + GoTrue admin API, React 19 + Zustand app.

## Global Constraints

- Admin email: `bobo.borenstein@gmail.com` (worker env var `ADMIN_EMAIL`; same literal in `src/lib/invites.ts`).
- Worker URL: `https://boday-push.boapps.workers.dev`.
- Code format: `BODAY-XXXX`, 4 chars from alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L).
- Error copy for bad codes, verbatim: `That invite code isn't valid.`
- Do NOT touch the zustand persist key `cadence-v1`.
- Neither the app nor the worker has a test framework; verification is `npx tsc --noEmit` / `npm run build` plus curl and manual browser checks as written in each task.
- Deploys: worker → `npx wrangler deploy` inside `worker-push/`; app → `npm run build && npx wrangler deploy` at repo root.

---

### Task 1: Supabase `invite_codes` table

**Files:** none (Supabase dashboard SQL editor — manual step, needs Jacob or a browser session logged into supabase.com, project `cgsjsbsxuzawvgunrpqi`).

**Interfaces:**
- Produces: table `invite_codes(code text pk, created_at timestamptz, used_by text null, used_at timestamptz null)`, RLS ON, no anon access. All later tasks read/write it via the worker's service key (which bypasses RLS).

- [ ] **Step 1: Run this SQL in the Supabase SQL editor**

```sql
create table invite_codes (
  code text primary key,
  created_at timestamptz not null default now(),
  used_by text,
  used_at timestamptz
);
alter table invite_codes enable row level security;
-- No policies: anon/authenticated clients get nothing; the worker's
-- service-role key bypasses RLS. All access goes through the worker.
```

- [ ] **Step 2: Verify**

In the SQL editor: `select * from invite_codes;` → returns 0 rows, no error.
Table editor shows `invite_codes` with RLS badge ON.

**Do NOT disable public signups yet** — that happens in Task 6, after the new signup path works.

---

### Task 2: Worker `/signup` and `/invites` routes

**Files:**
- Modify: `worker-push/src/index.ts` (fetch handler at lines 131–163; add helpers below the `sbDelete` helper around line 128)
- Modify: `worker-push/wrangler.jsonc` (add `ADMIN_EMAIL` to `vars`)

**Interfaces:**
- Consumes: `invite_codes` table from Task 1; existing `Env`, `sbKey()`.
- Produces (used by Task 3's `src/lib/invites.ts`):
  - `POST /signup` body `{email: string, password: string, code: string}` → `200 {ok: true}` | `400 {error: string}`
  - `POST /invites` header `Authorization: Bearer <supabase access token>` → `200 {code: string}` | `401/403 {error}`
  - `GET /invites` same auth → `200 {invites: {code: string, created_at: string, used_by_email: string | null, used_at: string | null}[]}`
  - All responses carry `Access-Control-Allow-Origin: *`; `OPTIONS` preflight returns 204.

- [ ] **Step 1: Add `ADMIN_EMAIL` to `worker-push/wrangler.jsonc` vars**

```jsonc
  "vars": {
    "SUPABASE_URL": "https://cgsjsbsxuzawvgunrpqi.supabase.co",
    "SUPABASE_KEY": "sb_publishable_VooWw0NDmWy9x8hOTqoBRw_4TGE2-xz",
    "VAPID_PUBLIC_KEY": "BPE5dCMkzTaS3TjQFq-e5U9yVkGDhCpi4MpMVKVWKZNqxxo3FqIFKFRANgL8sT8tw-PBhwR2xy_ujFOQ4cLniEA",
    "VAPID_SUBJECT": "mailto:bobo.borenstein@gmail.com",
    "ADMIN_EMAIL": "bobo.borenstein@gmail.com"
  }
```

And add to the `Env` interface in `worker-push/src/index.ts`:

```ts
  ADMIN_EMAIL: string
```

- [ ] **Step 2: Add invite helpers to `worker-push/src/index.ts`** (below `sbDelete`, above `// ── main`)

```ts
// ── invite-only signup ───────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function serviceHeaders(env: Env): Record<string, string> {
  const key = sbKey(env)
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  let s = ''
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return `BODAY-${s}`
}

/** Resolve the caller's Supabase user from their access token; null if invalid. */
async function getCaller(req: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.json()
}

async function handleSignup(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    password?: string
    code?: string
  }
  const email = body.email?.trim()
  const password = body.password ?? ''
  const code = body.code?.trim().toUpperCase()
  if (!email || password.length < 6 || !code) {
    return json({ error: 'Enter your email, a password of at least 6 characters, and an invite code.' }, 400)
  }

  const rows = (await (
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/invite_codes?code=eq.${encodeURIComponent(code)}&select=code,used_by`,
      { headers: serviceHeaders(env) },
    )
  ).json()) as { code: string; used_by: string | null }[]
  if (!rows.length || rows[0].used_by) {
    return json({ error: "That invite code isn't valid." }, 400)
  }

  const createRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const created = (await createRes.json()) as { id?: string; msg?: string; message?: string }
  if (!createRes.ok || !created.id) {
    return json({ error: created.msg || created.message || 'Could not create the account.' }, 400)
  }

  await fetch(`${env.SUPABASE_URL}/rest/v1/invite_codes?code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify({ used_by: created.id, used_at: new Date().toISOString() }),
  })

  return json({ ok: true })
}

async function handleInvites(req: Request, env: Env): Promise<Response> {
  const caller = await getCaller(req, env)
  if (!caller) return json({ error: 'Sign in required.' }, 401)
  if (caller.email !== env.ADMIN_EMAIL) return json({ error: 'Admin only.' }, 403)

  if (req.method === 'POST') {
    const code = generateCode()
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/invite_codes`, {
      method: 'POST',
      headers: { ...serviceHeaders(env), Prefer: 'return=minimal' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) return json({ error: `Could not create code (${res.status}).` }, 500)
    return json({ code })
  }

  // GET: list codes newest-first, resolving claimant emails.
  const rows = (await (
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/invite_codes?select=code,created_at,used_by,used_at&order=created_at.desc`,
      { headers: serviceHeaders(env) },
    )
  ).json()) as { code: string; created_at: string; used_by: string | null; used_at: string | null }[]

  const invites = await Promise.all(
    rows.map(async (r) => {
      let used_by_email: string | null = null
      if (r.used_by) {
        const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${r.used_by}`, {
          headers: serviceHeaders(env),
        })
        if (res.ok) used_by_email = ((await res.json()) as { email?: string }).email ?? null
      }
      return { code: r.code, created_at: r.created_at, used_by_email, used_at: r.used_at }
    }),
  )
  return json({ invites })
}
```

- [ ] **Step 3: Route the new paths in the `fetch` handler**

Replace the current first two lines of `fetch` (`const url = ...` / `if (url.pathname !== '/test') ...`) with:

```ts
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (url.pathname === '/signup' && req.method === 'POST') return handleSignup(req, env)
    if (url.pathname === '/invites') return handleInvites(req, env)
    if (url.pathname !== '/test') return new Response('boday-push ok', { status: 200 })
```

- [ ] **Step 4: Typecheck and deploy**

Run in `worker-push/`: `npx tsc --noEmit 2>/dev/null || npx wrangler deploy --dry-run` then `npx wrangler deploy`
Expected: deploy succeeds.

- [ ] **Step 5: Verify with curl**

```bash
# bad code → 400 with the exact copy
curl -s -X POST https://boday-push.boapps.workers.dev/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"x@example.com","password":"secret123","code":"BODAY-ZZZZ"}'
# → {"error":"That invite code isn't valid."}

# no token → 401
curl -s https://boday-push.boapps.workers.dev/invites
# → {"error":"Sign in required."}
```

- [ ] **Step 6: Commit**

```bash
git add worker-push/src/index.ts worker-push/wrangler.jsonc
git commit -m "worker: invite-gated /signup + admin /invites endpoints"
```

---

### Task 3: App client `src/lib/invites.ts`

**Files:**
- Create: `src/lib/invites.ts`

**Interfaces:**
- Consumes: worker routes from Task 2; `getSupabase()` from `src/lib/supabaseClient.ts`.
- Produces (used by Tasks 4 and 5):
  - `ADMIN_EMAIL: string`
  - `signUpWithInvite(email: string, password: string, code: string): Promise<void>` — throws `Error` with server message on failure
  - `createInvite(): Promise<string>` — returns the new code
  - `listInvites(): Promise<Invite[]>` where `Invite = { code: string; created_at: string; used_by_email: string | null; used_at: string | null }`

- [ ] **Step 1: Write `src/lib/invites.ts`**

```ts
// Invite-code client for the push worker's signup/admin endpoints.
// Signups are server-gated: the worker checks the code and creates the
// account with its service key (public Supabase signups are disabled).

import { getSupabase } from './supabaseClient'

const WORKER_URL = 'https://boday-push.boapps.workers.dev'

export const ADMIN_EMAIL = 'bobo.borenstein@gmail.com'

export interface Invite {
  code: string
  created_at: string
  used_by_email: string | null
  used_at: string | null
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error || "Couldn't reach the server, try again."
}

export async function signUpWithInvite(email: string, password: string, code: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, code }),
  }).catch(() => null)
  if (!res) throw new Error("Couldn't reach the server, try again.")
  if (!res.ok) throw new Error(await parseError(res))
}

async function adminHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.session?.access_token ?? ''}`,
  }
}

export async function createInvite(): Promise<string> {
  const res = await fetch(`${WORKER_URL}/invites`, { method: 'POST', headers: await adminHeaders() })
  if (!res.ok) throw new Error(await parseError(res))
  return ((await res.json()) as { code: string }).code
}

export async function listInvites(): Promise<Invite[]> {
  const res = await fetch(`${WORKER_URL}/invites`, { headers: await adminHeaders() })
  if (!res.ok) throw new Error(await parseError(res))
  return ((await res.json()) as { invites: Invite[] }).invites
}
```

- [ ] **Step 2: Typecheck**

Run at repo root: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/invites.ts
git commit -m "app: invite-code client for worker signup/admin endpoints"
```

---

### Task 4: Invite code field in the signup form

**Files:**
- Modify: `src/components/AuthGate.tsx` (the `SignIn` component, lines 32–113)

**Interfaces:**
- Consumes: `signUpWithInvite` from Task 3.
- Produces: sign-up mode posts to the worker, then signs in with the same credentials. Sign-in mode unchanged.

- [ ] **Step 1: Wire the invite flow into `SignIn`**

Add the import at the top of `AuthGate.tsx`:

```ts
import { signUpWithInvite } from '../lib/invites'
```

Add state next to `password` in `SignIn`:

```ts
  const [inviteCode, setInviteCode] = useState('')
```

Replace the `submit` function body with:

```ts
  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      setError('Enter your email and a password of at least 6 characters.')
      return
    }
    if (mode === 'sign_up' && !inviteCode.trim()) {
      setError('Enter your invite code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const supabase = getSupabase()
      if (mode === 'sign_up') {
        await signUpWithInvite(email.trim(), password, inviteCode)
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (err) throw new Error(err.message)
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (err) throw new Error(err.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
    setBusy(false)
  }
```

Add the invite input between the password input and the error line (sign-up mode only):

```tsx
          {mode === 'sign_up' && (
            <input
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="Invite code (e.g. BODAY-K7F3)"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className={inputCls}
            />
          )}
```

Update the sign-up subtitle on line 68 from `'Create your account.'` to `'Create your account — you need an invite code.'`

- [ ] **Step 2: Typecheck and eyeball**

Run: `npx tsc --noEmit` → no errors.
Run `npm run dev`, open http://localhost:5173 — note: without `.env` Supabase isn't configured and the gate is a pass-through, so visual check of the form requires the configured env (the repo has `.env`, so the form should show). Toggle to "Sign up" → invite field appears; toggle back → it's gone.

- [ ] **Step 3: Commit**

```bash
git add src/components/AuthGate.tsx
git commit -m "app: signup requires an invite code (worker-gated)"
```

---

### Task 5: Admin "Invites" section in Settings

**Files:**
- Modify: `src/views/SettingsView.tsx`

**Interfaces:**
- Consumes: `ADMIN_EMAIL`, `createInvite`, `listInvites`, `Invite` from Task 3; existing `accountEmail` state, `Section`/`Row` components.
- Produces: UI only; nothing downstream.

- [ ] **Step 1: Add the invites section**

Imports to add in `SettingsView.tsx`:

```ts
import { ADMIN_EMAIL, createInvite, listInvites, type Invite } from '../lib/invites'
```

Inside `SettingsView`, after the `accountEmail` effect, add:

```ts
  const isAdmin = accountEmail === ADMIN_EMAIL
```

Render, between the `{/* Data */}` and `{/* Account */}` sections:

```tsx
      {/* Invites (admin only) */}
      {isAdmin && <InvitesSection />}
```

Add the component at the bottom of the file (above `Section`):

```tsx
function InvitesSection() {
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () => listInvites().then(setInvites).catch(() => setInvites([]))
  useEffect(() => {
    refresh()
  }, [])

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const code = await createInvite()
      setNewCode(code)
      setCopied(false)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code.')
    }
    setBusy(false)
  }

  const copy = async () => {
    if (!newCode) return
    await navigator.clipboard.writeText(newCode)
    setCopied(true)
  }

  return (
    <Section title="Invites">
      <p className="mb-3 text-xs text-faint">
        Generate a one-time code and text it to a friend — they'll use it to sign up.
      </p>
      <button
        onClick={generate}
        disabled={busy}
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-glow disabled:opacity-60"
      >
        {busy ? 'One moment…' : 'Generate invite code'}
      </button>
      {newCode && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
          <span className="font-mono text-base font-bold tracking-widest">{newCode}</span>
          <button
            onClick={copy}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-border-strong"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {invites && invites.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {invites.map((inv) => (
            <li key={inv.code} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-muted">{inv.code}</span>
              <span className={inv.used_by_email ? 'text-faint' : 'font-medium text-success'}>
                {inv.used_by_email
                  ? `used by ${inv.used_by_email}${inv.used_at ? ` on ${new Date(inv.used_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}`
                  : 'unused'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/views/SettingsView.tsx
git commit -m "app: admin Invites section in Settings (generate, copy, usage list)"
```

---

### Task 6: Deploy, lock the door, end-to-end verify

**Files:** none (deploys + Supabase dashboard + browser).

- [ ] **Step 1: Deploy the app**

```bash
npm run build && npx wrangler deploy
```

- [ ] **Step 2: Disable public signups in Supabase** (manual)

Dashboard → project `cgsjsbsxuzawvgunrpqi` → Authentication → Sign In / Providers → turn **"Allow new users to sign up" OFF** → Save. The worker's admin API still creates users.

- [ ] **Step 3: End-to-end verification**

1. On https://boday.boapps.workers.dev sign in as bobo.borenstein@gmail.com → Settings shows the **Invites** section. Generate a code; it appears with Copy and shows "unused" in the list.
2. In a private window: Sign up with a fake code → error "That invite code isn't valid."
3. Private window: sign up with a throwaway email + the real code → lands in the app signed in.
4. Back in the admin Settings: refresh → the code shows "used by \<throwaway email\>".
5. Private window again: try to reuse the same code with another email → rejected.
6. Confirm direct API signup is dead:
   `curl -s -X POST 'https://cgsjsbsxuzawvgunrpqi.supabase.co/auth/v1/signup' -H 'apikey: <anon key from .env>' -H 'Content-Type: application/json' -d '{"email":"stranger@example.com","password":"secret123"}'` → error response ("Signups not allowed for this instance").

- [ ] **Step 4: Final commit / cleanup**

Delete the throwaway test user in Supabase dashboard (Authentication → Users) if desired, or keep as evidence. No code changes expected; if any fixes were needed during verification, commit them:

```bash
git add -A && git commit -m "fix: invite signup polish from end-to-end verification"
```
