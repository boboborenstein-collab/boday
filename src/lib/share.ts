import { getSupabase, isSupabaseConfigured } from './supabaseClient'

const WORKER_URL = 'https://boday-push.boapps.workers.dev'

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.session?.access_token ?? ''}`,
  }
}

export async function shareTaskWithEmail(taskId: string, toEmail: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Sign in to share tasks.')
  const email = toEmail.trim().toLowerCase()
  if (!email.includes('@')) throw new Error('Enter a valid email.')

  const res = await fetch(`${WORKER_URL}/share`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ taskId, toEmail: email }),
  }).catch(() => null)

  if (!res) throw new Error("Couldn't reach the server.")
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || 'Share failed.')
  }
}
