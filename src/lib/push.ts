// Web Push subscription management. After notification permission is granted,
// subscribe this device and mirror the subscription to Supabase so the
// reminder worker (worker-push/) can reach it.

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && SUPABASE_URL && SUPABASE_ANON_KEY && 'PushManager' in window)
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

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    }))

  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([
      {
        id: sub.endpoint,
        user_id: 'owner',
        data: {
          subscription: sub.toJSON(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    ]),
  })
  if (!res.ok) throw new Error(`Saving subscription failed (${res.status}).`)
}
