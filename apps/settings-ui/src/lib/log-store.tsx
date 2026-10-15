import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LogEntry } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { MAX_LOG_ENTRIES, mergeLogEntries } from './log-buffer'

const TAIL_COUNT = 200
const BATCH_MS = 80
interface LogStore { entries: LogEntry[]; clear: () => void }
const LogContext = createContext<LogStore | null>(null)

/** One bounded subscription for the dialog; bursts produce at most one update per batch. */
export function LogProvider({ children }: { children: ReactNode }) {
  const bridge = useBridge()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const pending = useRef<LogEntry[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearEpoch = useRef(0)

  useEffect(() => {
    let cancelled = false
    const epoch = clearEpoch.current
    const flush = () => {
      timer.current = null
      const batch = pending.current
      pending.current = []
      if (!cancelled && batch.length) setEntries(prev => mergeLogEntries(prev, batch))
    }
    const unsubscribe = bridge.on('gdp:log-line', entry => {
      pending.current.push(entry)
      if (pending.current.length > MAX_LOG_ENTRIES) pending.current.splice(0, pending.current.length - MAX_LOG_ENTRIES)
      if (!timer.current) timer.current = setTimeout(flush, BATCH_MS)
    })
    bridge.invoke('gdp:tail-log', TAIL_COUNT).then(history => {
      if (!cancelled && epoch === clearEpoch.current) setEntries(prev => mergeLogEntries(history, prev))
    }).catch(() => {})
    return () => {
      cancelled = true
      unsubscribe()
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      pending.current = []
    }
  }, [bridge])

  const clear = useCallback(() => {
    clearEpoch.current += 1
    pending.current = []
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setEntries([])
  }, [])

  return <LogContext.Provider value={{ entries, clear }}>{children}</LogContext.Provider>
}

export function useLogs(): LogStore {
  const store = useContext(LogContext)
  if (!store) throw new Error('LogProvider is missing')
  return store
}
