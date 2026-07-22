import { ensureCalendarToken } from './userPrefs'

const WORKER_URL = 'https://boday-push.boapps.workers.dev'

export async function getCalendarSubscriptionUrl(): Promise<string | null> {
  const token = await ensureCalendarToken()
  if (!token) return null
  return `${WORKER_URL}/cal/${token}.ics`
}
