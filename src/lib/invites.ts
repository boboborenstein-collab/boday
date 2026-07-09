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
