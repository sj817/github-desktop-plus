import { CircleAlert, CircleCheck } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ToastKind = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null)

const VISIBLE_MS = 2600

/**
 * A local toaster rather than a library one: the dialog is a modal `<dialog>`,
 * so notifications have to render inside it — anything portalled to the body
 * would be inert and invisible behind the backdrop.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const push = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, kind }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts(prev => prev.filter(toast => toast.id !== id))
    }, VISIBLE_MS)
    timers.current.add(timer)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none absolute inset-x-0 bottom-16 z-60 flex flex-col items-center gap-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={cn(
              'flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2',
              'text-[12.5px] shadow-lg shadow-black/10',
              'animate-[gdp-toast-in_180ms_ease-out]',
              toast.kind === 'error' ? 'text-danger' : 'text-fg'
            )}
          >
            {toast.kind === 'error' ? (
              <CircleAlert className="size-3.5 text-danger" />
            ) : (
              <CircleCheck className="size-3.5 text-success" />
            )}
            <span>{toast.message}</span>
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
