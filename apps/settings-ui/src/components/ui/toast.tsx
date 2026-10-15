import { CircleAlert, CircleCheck } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type ToastKind = 'success' | 'error'
interface ToastItem { id: number; message: string; kind: ToastKind }
const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; for (const timer of timers.current) clearTimeout(timer); timers.current.clear() }
  }, [])

  const push = useCallback((message: string, kind: ToastKind = 'success') => {
    if (!mounted.current) return
    const id = nextId.current++
    setToasts(prev => [...prev.slice(-2), { id, message, kind }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts(prev => prev.filter(item => item.id !== id))
    }, 3200)
    timers.current.add(timer)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="gdp-toasts" aria-live="polite">
        {toasts.map(item => (
          <div key={item.id} role={item.kind === 'error' ? 'alert' : 'status'} data-kind={item.kind} className="gdp-toast">
            {item.kind === 'error' ? <CircleAlert /> : <CircleCheck />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (message: string, kind?: ToastKind) => void {
  const push = useContext(ToastContext)
  if (!push) throw new Error('ToastProvider is missing')
  return push
}
