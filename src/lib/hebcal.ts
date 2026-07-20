import { getSupabase, isSupabaseConfigured } from './supabaseClient'

const WORKER_URL = 'https://boday-push.boapps.workers.dev'

export interface QuietPrefs {
  enabled: boolean
  geonameid: number | null
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

export async function searchLocations(q: string): Promise<{ geonameid: number; name: string }[]> {
  try {
    const res = await fetch(`${WORKER_URL}/geo?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function fetchHebcalItems(
  startDateStr: string,
  endDateStr: string,
  geonameid: number | null,
): Promise<HebcalItem[]> {
  const cacheKey = 'boday-hebcal-cache-v1'
  const mapKey = `${startDateStr}|${endDateStr}|${geonameid ?? 'none'}`

  try {
    const cachedStr = localStorage.getItem(cacheKey)
    if (cachedStr) {
      const parsed = JSON.parse(cachedStr)
      const entry = parsed[mapKey]
      if (entry && Date.now() - entry.fetchedAt < 24 * 60 * 60 * 1000) {
        return entry.data
      }
    }
  } catch {
    // Ignore cache read errors
  }

  let url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&start=${startDateStr}&end=${endDateStr}`
  if (geonameid !== null) {
    url += `&c=on&M=on&geonameid=${geonameid}`
  }

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Network error')
    const data = await res.json()
    const items: HebcalItem[] = data.items || []

    try {
      const cachedStr = localStorage.getItem(cacheKey)
      const parsed = cachedStr ? JSON.parse(cachedStr) : {}
      parsed[mapKey] = { fetchedAt: Date.now(), data: items }
      localStorage.setItem(cacheKey, JSON.stringify(parsed))
    } catch {
      // Ignore cache write errors
    }
    return items
  } catch (e) {
    try {
      const cachedStr = localStorage.getItem(cacheKey)
      if (cachedStr) {
        const parsed = JSON.parse(cachedStr)
        if (parsed[mapKey]) return parsed[mapKey].data
      }
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
      const match = item.title.match(/:\s*(.+)$/)
      if (match) info.candles = match[1]
    } else if (item.category === 'havdalah') {
      const match = item.title.match(/:\s*(.+)$/)
      if (match) info.havdalah = match[1]
    }
  }

  return map
}

export async function loadQuietPrefs(): Promise<QuietPrefs | null> {
  if (!isSupabaseConfigured()) return null
  const { data: sessionData } = await getSupabase().auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return null

  const defaultPrefs: QuietPrefs = { enabled: false, geonameid: null, locationName: '' }

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
        geonameid: quiet.geonameid ?? null,
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
  const { data: sessionData } = await getSupabase().auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return

  const { data } = await getSupabase()
    .from('user_prefs')
    .select('data')
    .eq('id', userId)
    .single()

  const existingData = (data?.data as Record<string, unknown>) || {}

  await getSupabase()
    .from('user_prefs')
    .upsert({
      id: userId,
      user_id: userId,
      data: { ...existingData, quiet: p },
    })
}
