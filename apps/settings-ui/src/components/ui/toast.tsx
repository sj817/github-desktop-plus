import { CircleAlert, CircleCheck } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ToastKind = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  leaving: boolean
}

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null)

const VISIBLE_MS = 2600
const LEAVE_MS = 160

/**
 * A local toaster rather than a library one: the dialog is a modal `<dialog>`,
 * so notifications have to render inside it — anything portalled to the body
 * would be inert and invisible behind the backdrop.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const push = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, kind, leaving: false }])
    setTimeout(() => {
      setToasts(prev => prev.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast)))
      setTimeout(() => setToasts(prev => prev.filter(toast => toast.id !== id)), LEAVE_MS)
    }, VISIBLE_MS)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none absolute inset-x-0 bottom-14 z-60 flex flex-col items-center gap-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'flex items-center gap-2 rounded-lg bg-elevated py-1.5 pr-3.5 pl-2.5',
              'text-[12.5px] text-fg shadow-lg',
              toast.leaving ? 'animate-toast-out' : 'animate-toast-in'
            )}
          >
            {toast.kind === 'error' ? (
              <CircleAlert className="size-4 text-danger" />
            ) : (
              <CircleCheck className="size-4 text-success" />
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
