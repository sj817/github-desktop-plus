import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { LogEntry } from '@shared/gdp-ipc'
import { useBridge } from '@/bridge/context'

const MAX_ENTRIES = 500
const TAIL_COUNT = 200

interface LogStore {
  entries: LogEntry[]
  clear: () => void
}

const LogContext = createContext<LogStore | null>(null)

/**
 * The live log subscription is owned by the dialog, not by the Logs tab.
 *
 * That keeps lines arriving while another tab is open (the interesting ones —
 * saving settings logs through the same pipe), and it means exactly one
 * `gdp:log-line` listener exists for the lifetime of the dialog, unregistered
 * when the dialog unmounts. Switching tabs never touches it.
 */
export function LogProvider({ children }: { children: ReactNode }) {
  const bridge = useBridge()
  const [entries, setEntries] = useState<LogEntry[]>([])

  useEffect(() => {
    let cancelled = false

    const unsubscribe = bridge.on('gdp:log-line', entry => {
      setEntries(prev => {
        const next = [...prev, entry]
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
      })
    })

    bridge
      .invoke('gdp:tail-log', TAIL_COUNT)
      .then(history => {
        if (cancelled || history.length === 0) return
        // Live lines may already have arrived while the tail was in flight;
        // history belongs in front of them.
        setEntries(prev => {
          const next = [...history, ...prev]
          return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
        })
      })
      .catch(() => {
        /* best effort — the live stream still works */
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bridge])

  const clear = useCallback(() => setEntries([]), [])

  return <LogContext.Provider value={{ entries, clear }}>{children}</LogContext.Provider>
}

export function useLogs(): LogStore {
  const store = useContext(LogContext)
  if (!store) throw new Error('LogProvider is missing')
  return store
}
