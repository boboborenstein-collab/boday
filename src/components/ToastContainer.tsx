import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

interface Toast {
  id: number
  message: string
}

let toastId = 0

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<string>
      const id = ++toastId
      setToasts((prev) => [...prev, { id, message: customEvent.detail }])
      
      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 5000)
    }

    window.addEventListener('boday-toast', handleToast)
    return () => window.removeEventListener('boday-toast', handleToast)
  }, [])

  return (
    <div className="fixed bottom-safe right-4 z-50 flex flex-col gap-2 pb-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 shadow-lg border border-border"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3zm-8.27 4a2 2 0 0 1-3.46 0"></path>
              </svg>
            </div>
            <p className="text-sm font-medium text-text">{t.message}</p>
            <button 
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="ml-2 text-muted hover:text-text"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
