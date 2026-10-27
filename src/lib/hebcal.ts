import { getSupabase, isSupabaseConfigured } from './supabaseClient'
import { mergeUserPrefsData } from './userPrefs'

const WORKER_URL = 'https://boday-push.boapps.workers.dev'

export interface QuietPrefs {
  enabled: boolean
  /** 'geoname:5110302' or 'zip:07631' — see hebcal search results. */
  locationId: string | null
  locationName: string
}

export interface QuietWindow {
  start: string
  end: string
  title: string
}

export interface JewishDayInfo {
  holidays: string[]
  candles?: string
  havdalah?: string
}

export interface HebcalItem {
  category: string
  date: string
  title: string
  hebrew?: string
}

export async function searchLocations(q: string): Promise<{ locationId: string; name: string }[]> {
  try {
    const res = await fetch(`${WORKER_URL}/geo?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

/** 'geoname:5110302' -> '&geonameid=5110302'; 'zip:07631' -> '&zip=07631'. */
function locationQueryParam(locationId: string): string {
  const [kind, id] = locationId.split(':')
  return kind === 'zip' ? `&zip=${encodeURIComponent(id)}` : `&geonameid=${encodeURIComponent(id)}`
}

function readCache(mapKey: string): HebcalItem[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem('boday-hebcal-cache-v1') ?? '{}')
    const entry = parsed[mapKey]
    if (entry && Date.now() - entry.fetchedAt < 24 * 60 * 60 * 1000) return entry.data
  } catch {
    // Ignore cache read errors
  }
  return null
}

function writeCache(mapKey: string, items: HebcalItem[]): void {
  try {
    const parsed = JSON.parse(localStorage.getItem('boday-hebcal-cache-v1') ?? '{}')
    parsed[mapKey] = { fetchedAt: Date.now(), data: items }
    localStorage.setItem('boday-hebcal-cache-v1', JSON.stringify(parsed))
  } catch {
    // Ignore cache write errors
  }
}

async function fetchHebcalOnce(
  startDateStr: string,
  endDateStr: string,
  locationId: string | null,
): Promise<HebcalItem[]> {
  const url =
    `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&start=${startDateStr}&end=${endDateStr}` +
    (locationId ? `&c=on&M=on${locationQueryParam(locationId)}` : '')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`hebcal ${res.status}`)
  const data = await res.json()
  return (data.items ?? []) as HebcalItem[]
}

export async function fetchHebcalItems(
  startDateStr: string,
  endDateStr: string,
  locationId: string | null,
): Promise<HebcalItem[]> {
  const mapKey = `${startDateStr}|${endDateStr}|${locationId ?? 'none'}`
  const cached = readCache(mapKey)
  if (cached) return cached

  try {
    const items = await fetchHebcalOnce(startDateStr, endDateStr, locationId)
    writeCache(mapKey, items)
    return items
  } catch (e) {
    console.log(`hebcal fetch failed: ${String(e)}`)
    // A bad/stale location (or a transient Hebcal error) shouldn't blank out
    // holidays too — fall back to a location-less fetch for at least those.
    if (locationId) {
      try {
        const items = await fetchHebcalOnce(startDateStr, endDateStr, null)
        writeCache(`${startDateStr}|${endDateStr}|none`, items)
        return items
      } catch {
        // Fall through to the stale-cache check below.
      }
    }
    try {
      const parsed = JSON.parse(localStorage.getItem('boday-hebcal-cache-v1') ?? '{}')
      if (parsed[mapKey]) return parsed[mapKey].data
    } catch {
      // Ignore
    }
    return []
  }
}

export function computeQuietWindows(items: HebcalItem[]): QuietWindow[] {
  const sorted = [...items].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const windows: QuietWindow[] = []
  let currentWindow: { start: string; title: string } | null = null

  for (const item of sorted) {
    if (item.category === 'candles' && !currentWindow) {
      currentWindow = { start: item.date, title: item.title }
    } else if (item.category === 'havdalah' && currentWindow) {
      windows.push({ start: currentWindow.start, end: item.date, title: currentWindow.title })
      currentWindow = null
    }
  }

  return windows
}

export function currentQuietWindow(windows: QuietWindow[], now: number): QuietWindow | null {
  return windows.find(w => Date.parse(w.start) <= now && now <= Date.parse(w.end)) || null
}

/** 'HH:mm' at the event's location from the ISO date; the title's own text when there is no time part. */
function itemTime(item: HebcalItem): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(item.date)
  if (iso) return iso[1]
  const match = item.title.match(/:\s*(.+)$/)
  return match ? match[1] : null
}

export function buildDayInfo(items: HebcalItem[]): Map<string, JewishDayInfo> {
  const map = new Map<string, JewishDayInfo>()

  for (const item of items) {
    const dayKey = item.date.slice(0, 10)
    let info = map.get(dayKey)
    if (!info) {
      info = { holidays: [] }
      map.set(dayKey, info)
    }

    if (item.category === 'holiday') {
      info.holidays.push(item.title)
    } else if (item.category === 'candles') {
      const time = itemTime(item)
      if (time) info.candles = time
    } else if (item.category === 'havdalah') {
      const time = itemTime(item)
      if (time) info.havdalah = time
    }
  }

  return map
}

export async function loadQuietPrefs(): Promise<QuietPrefs | null> {
  if (!isSupabaseConfigured()) return null
  const { data: sessionData } = await getSupabase().auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return null

  const defaultPrefs: QuietPrefs = { enabled: false, locationId: null, locationName: '' }

  try {
    const { data, error } = await getSupabase()
      .from('user_prefs')
      .select('data')
      .eq('id', userId)
      .single()

    if (!error && data?.data?.quiet) {
      const quiet = data.data.quiet as QuietPrefs
      const prefs: QuietPrefs = {
        enabled: Boolean(quiet.enabled),
        locationId: quiet.locationId ?? null,
        locationName: quiet.locationName || '',
      }
      localStorage.setItem('boday-quiet-prefs-v1', JSON.stringify(prefs))
      return prefs
    }
    return defaultPrefs
  } catch {
    const cached = localStorage.getItem('boday-quiet-prefs-v1')
    if (cached) {
      try {
        return JSON.parse(cached) as QuietPrefs
      } catch {
        // Fall through
      }
    }
    return defaultPrefs
  }
}

export async function saveQuietPrefs(p: QuietPrefs): Promise<void> {
  localStorage.setItem('boday-quiet-prefs-v1', JSON.stringify(p))

  if (!isSupabaseConfigured()) return
  await mergeUserPrefsData({ quiet: p })
}
