import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  loadQuietPrefs,
  fetchHebcalItems,
  computeQuietWindows,
  currentQuietWindow,
} from '../lib/hebcal'
import type { QuietWindow } from '../lib/hebcal'
import { formatIsoTime } from '../lib/format'
import { useStore } from '../store/useStore'

export function QuietOverlay() {
  const [activeWindow, setActiveWindow] = useState<QuietWindow | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const shouldReduceMotion = useReducedMotion()
  const timeFormat = useStore((s) => s.settings.timeFormat)

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    let windows: QuietWindow[] = []

    async function init() {
      const prefs = await loadQuietPrefs()
      if (!prefs?.enabled || !prefs.locationId) return

      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const plus9 = new Date(today)
      plus9.setDate(plus9.getDate() + 9)

      const start = yesterday.toISOString().split('T')[0]
      const end = plus9.toISOString().split('T')[0]

      const items = await fetchHebcalItems(start, end, prefs.locationId)
      windows = computeQuietWindows(items)

      checkWindow()
      interval = setInterval(checkWindow, 30000)
    }

    function checkWindow() {
      const now = Date.now()
      const win = currentQuietWindow(windows, now)
      
      if (win) {
        const dismissedKey = `boday-quiet-dismissed-${win.start}`
        if (sessionStorage.getItem(dismissedKey)) {
          setDismissed(true)
        } else {
          setDismissed(false)
        }
      }
      setActiveWindow(win)
    }

    init()

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [])

  if (!activeWindow || dismissed) return null

  const isHoliday = !activeWindow.title.includes('Candle')
  const titleText = isHoliday ? activeWindow.title : 'Shabbat Shalom'

  const endTime = formatIsoTime(activeWindow.end, timeFormat)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.5 }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="text-6xl">🕯️</div>
        <h1 className="text-2xl font-bold">{titleText}</h1>
        <p className="text-muted">
          BoDay is resting until havdalah — {endTime}
        </p>
      </div>
      <button
        onClick={() => {
          sessionStorage.setItem(`boday-quiet-dismissed-${activeWindow.start}`, 'true')
          setDismissed(true)
        }}
        className="absolute bottom-12 text-[11px] text-faint underline transition-colors hover:text-muted"
      >
        Use anyway
      </button>
    </motion.div>
  )
}
