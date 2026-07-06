import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { buildTodayList } from '../lib/recurrence'
import { todayStr } from '../lib/date'

export function useLiveAlerts() {
  // Track which task-time combinations we've already alerted for so we don't spam.
  const alerted = useRef<Set<string>>(new Set())

  useEffect(() => {
    const check = () => {
      const { tasks, completions, settings } = useStore.getState()
      const today = todayStr()
      const now = new Date()
      // format HH:mm
      const hours = String(now.getHours()).padStart(2, '0')
      const mins = String(now.getMinutes()).padStart(2, '0')
      const currentTime = `${hours}:${mins}`

      const todayList = buildTodayList(tasks, completions, today)
      
      let shouldPlaySound = false
      
      for (const item of todayList) {
        if (!item.completed && item.task.reminderTime === currentTime) {
          const alertKey = `${item.task.id}-${today}-${currentTime}`
          if (!alerted.current.has(alertKey)) {
            alerted.current.add(alertKey)
            
            // Trigger toast and/or system notification
            triggerAlert(item.task.title)
            shouldPlaySound = true
          }
        }
      }
      
      if (shouldPlaySound && settings.sound) {
        playChime()
      }
    }

    // Run an immediate check on mount
    check()

    // Check every 30 seconds
    const interval = setInterval(check, 30000)
    
    return () => clearInterval(interval)
  }, [])
}

function triggerAlert(title: string) {
  // Try system notification first if granted
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('BoDay', { body: `Time for: ${title}` })
  }
  
  // Also dispatch a custom event for our Toast UI
  window.dispatchEvent(new CustomEvent('boday-toast', { detail: `Time for: ${title}` }))
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    
    osc.connect(gain)
    gain.connect(ctx.destination)
    
    osc.type = 'sine'
    osc.frequency.setValueAtTime(523.25, ctx.currentTime) // C5
    osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.1) // C6
    
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.6)
  } catch (e) {
    // ignore
  }
}
