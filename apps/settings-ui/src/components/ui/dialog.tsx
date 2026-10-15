import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useRef, type FormEventHandler, type ReactNode } from 'react'
import { usePortalContainer } from '@/bridge/context'
import { Button } from './button'

export function Dialog({ open, title, description, children, footer, onClose, onSubmit }: {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  onSubmit?: FormEventHandler<HTMLFormElement>
}) {
  const container = usePortalContainer()
  const popup = useRef<HTMLDivElement>(null)
  const body = <><div className="gdp-modal-body">{children}</div>{footer ? <div className="gdp-modal-foot">{footer}</div> : null}</>
  return (
    <BaseDialog.Root open={open} onOpenChange={next => { if (!next) onClose() }}>
      <BaseDialog.Portal container={container}>
        <BaseDialog.Backdrop className="gdp-modal-backdrop" />
        <BaseDialog.Popup ref={popup} className="gdp-modal-popup" initialFocus={openType => openType === 'touch' ? popup.current : popup.current?.querySelector<HTMLElement>('input, textarea, [type="submit"]') ?? true}>
          <header className="gdp-modal-head">
            <div>
              <BaseDialog.Title className="gdp-modal-title">{title}</BaseDialog.Title>
              {description ? <BaseDialog.Description className="gdp-modal-description">{description}</BaseDialog.Description> : null}
            </div>
            <Button size="icon" variant="ghost" aria-label="关闭对话框" onClick={onClose}><X /></Button>
          </header>
          {onSubmit ? <form onSubmit={onSubmit}>{body}</form> : body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
