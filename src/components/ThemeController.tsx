import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { ThemeMode } from '../types'

/** Resolve 'system' against the OS preference; pass through explicit choices. */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/**
 * Side-effect-only component: mirrors the persisted settings onto <html> as
 * data-attributes that the CSS in index.css keys off. Renders nothing.
 */
export function ThemeController() {
  const { theme, accent, reduceMotion } = useStore((s) => s.settings)

  // Theme (with live response to OS changes when in 'system' mode).
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const resolved = resolveTheme(theme)
      root.dataset.theme = resolved
      // Keep the installed-PWA status bar / browser chrome in sync.
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) {
        meta.setAttribute('content', resolved === 'dark' ? '#08080c' : '#f6f6fb')
      }
    }
    apply()

    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  // Accent.
  useEffect(() => {
    document.documentElement.dataset.accent = accent
  }, [accent])

  // Reduced motion.
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduceMotion)
  }, [reduceMotion])

  return null
}
