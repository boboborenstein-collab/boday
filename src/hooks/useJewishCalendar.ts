import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import {
  fetchHebcalItems,
  buildDayInfo,
  loadQuietPrefs,
} from '../lib/hebcal'
import type { JewishDayInfo } from '../lib/hebcal'

export function useJewishCalendar(startDateStr: string, endDateStr: string): Map<string, JewishDayInfo> {
  const showShabbatOnCalendar = useStore((s) => s.settings.showShabbatOnCalendar)
  const showHolidaysOnCalendar = useStore((s) => s.settings.showHolidaysOnCalendar)

  const [dayInfo, setDayInfo] = useState<Map<string, JewishDayInfo>>(new Map())

  useEffect(() => {
    if (!showShabbatOnCalendar && !showHolidaysOnCalendar) {
      setDayInfo(new Map())
      return
    }

    let isMounted = true

    async function load() {
      const prefs = await loadQuietPrefs()
      const locationId = prefs?.locationId ?? null

      const items = await fetchHebcalItems(startDateStr, endDateStr, locationId)
      if (!isMounted) return

      const rawMap = buildDayInfo(items)
      const filteredMap = new Map<string, JewishDayInfo>()

      for (const [date, info] of rawMap.entries()) {
        const filteredInfo: JewishDayInfo = { holidays: [] }
        if (showHolidaysOnCalendar) {
          filteredInfo.holidays = [...info.holidays]
        }
        if (showShabbatOnCalendar) {
          filteredInfo.candles = info.candles
          filteredInfo.havdalah = info.havdalah
        }

        if (
          filteredInfo.holidays.length > 0 ||
          filteredInfo.candles ||
          filteredInfo.havdalah
        ) {
          filteredMap.set(date, filteredInfo)
        }
      }

      setDayInfo(filteredMap)
    }

    load()

    return () => {
      isMounted = false
    }
  }, [startDateStr, endDateStr, showShabbatOnCalendar, showHolidaysOnCalendar])

  return dayInfo
}
