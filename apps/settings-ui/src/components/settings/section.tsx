import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      {actions ? <div className="page-heading-actions">{actions}</div> : null}
    </header>
  )
}

export function SettingSection({ title, description, icon, action, children, className }: {
  title: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string
}) {
  const titleId = useId()
  return (
    <section className={cn('setting-panel', className)} aria-labelledby={titleId}>
      <header className="panel-head">
        {icon ? <span className="panel-glyph">{icon}</span> : null}
        <div className="panel-titles">
          <h2 id={titleId}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="panel-actions">{action}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export function SettingItem({ title, description, children, className, align = 'center' }: {
  title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string; align?: 'center' | 'start'
}) {
  return (
    <div className={cn('setting-item', align === 'start' && 'setting-item-start', className)}>
      <div className="setting-item-copy">
        <div className="setting-label">{title}</div>
        {description ? <p className="setting-description">{description}</p> : null}
      </div>
      {children ? <div className="setting-control">{children}</div> : null}
    </div>
  )
}

export function SettingField({ label, hint, htmlFor, trailing, children, className }: {
  label: ReactNode; hint?: ReactNode; htmlFor?: string; trailing?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <div className={cn('setting-field', className)}>
      <div className="setting-field-head">
        <label htmlFor={htmlFor} className="setting-label">{label}</label>
        {trailing}
      </div>
      {children}
      {hint ? <p className="setting-hint">{hint}</p> : null}
    </div>
  )
}

export function EmptyState({ icon, title, children, action, className }: {
  icon?: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string
}) {
  return (
    <div className={cn('gdp-empty', className)}>
      {icon ? <span className="panel-glyph">{icon}</span> : null}
      {title ? <h3>{title}</h3> : null}
      {children ? <p>{children}</p> : null}
      {action ? <div className="gdp-empty-action">{action}</div> : null}
    </div>
  )
}

export function Note({ children, tone = 'neutral', icon, className }: {
  children: ReactNode; tone?: 'neutral' | 'success' | 'danger' | 'warn' | 'accent'; icon?: ReactNode; className?: string
}) {
  return <div className={cn('gdp-note', className)} data-tone={tone}>{icon}<span>{children}</span></div>
}

export { Badge } from '@/components/ui/badge'
