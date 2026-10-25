import { ensureCalendarToken, type PrefsClient } from './userPrefs'

const WORKER_URL = 'https://boday-push.boapps.workers.dev'

export type CalendarLinkResult = { ok: true; url: string } | { ok: false; message: string }

export async function getCalendarSubscriptionUrl(client?: PrefsClient | null): Promise<CalendarLinkResult> {
  const result = await ensureCalendarToken(client)
  if (!result.ok) return result
  return { ok: true, url: `${WORKER_URL}/cal/${result.token}.ics` }
}
