// Web Push subscription management. After notification permission is granted,
// subscribe this device and mirror the subscription to Supabase (keyed to the
// signed-in user) so the reminder worker (worker-push/) can reach it.

import { getSupabase, isSupabaseConfigured } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && isSupabaseConfigured() && 'PushManager' in window)
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Subscribe this device to push and save the subscription. Throws on failure. */
export async function subscribeToPush(): Promise<void> {
  if (!isPushConfigured()) throw new Error('Push is not configured.')

  const supabase = getSupabase()
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Sign in to enable push reminders.')

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    }))

  const { error } = await supabase.from('push_subscriptions').upsert({
    id: sub.endpoint,
    user_id: userId,
    data: {
      subscription: sub.toJSON(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  })
  if (error) throw new Error(`Saving subscription failed: ${error.message}`)
}

/** Remove this device's push registration (used on sign-out). Best-effort. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushConfigured()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await getSupabase().from('push_subscriptions').delete().eq('id', sub.endpoint)
    await sub.unsubscribe()
  } catch {
    // best-effort cleanup
  }
}
