import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { Layout } from './components/Layout'
import { TaskEditor } from './components/TaskEditor'
import { CommandPalette } from './components/CommandPalette'
import { ThemeController } from './components/ThemeController'
import { TodayView } from './views/TodayView'
import { TasksView } from './views/TasksView'
import { CalendarView } from './views/CalendarView'
import { StatsView } from './views/StatsView'
import { SettingsView } from './views/SettingsView'
import { startSync } from './lib/sync'
import { isPushConfigured, subscribeToPush } from './lib/push'
import { useLiveAlerts } from './hooks/useLiveAlerts'
import { ToastContainer } from './components/ToastContainer'

function AnimatedRoutes() {
  const location = useLocation()
  const reduce = useReducedMotion()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<TodayView />} />
          <Route path="/tasks" element={<TasksView />} />
          <Route path="/calendar" element={<CalendarView />} />
          <Route path="/stats" element={<StatsView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

export default function App() {
  // Activate cross-device sync if Supabase creds are present (no-op otherwise).
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    startSync().then((d) => {
      if (cancelled) {
        d()
      } else {
        dispose = d
      }
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  // Keep this device's push subscription registered (idempotent, silent).
  useEffect(() => {
    if (isPushConfigured() && 'Notification' in window && Notification.permission === 'granted') {
      subscribeToPush().catch(() => {})
    }
  }, [])

  useLiveAlerts()

  return (
    <BrowserRouter>
      <ThemeController />
      <Layout>
        <AnimatedRoutes />
      </Layout>
      <TaskEditor />
      <CommandPalette />
      <ToastContainer />
    </BrowserRouter>
  )
}
