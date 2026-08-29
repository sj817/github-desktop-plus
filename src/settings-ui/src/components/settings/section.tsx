import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Layout primitives every page is built from — a titled group of rows, and the
 * two row shapes: control-on-the-right for compact settings, stacked for inputs
 * that need the full width.
 */

export function SettingSection({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-5', className)}>
      <header className="mb-1.5 flex items-baseline gap-2 px-0.5">
        <h2 className="text-[12px] font-semibold tracking-wide text-fg-muted">{title}</h2>
        {hint ? <span className="text-[11.5px] text-fg-subtle">{hint}</span> : null}
        {action ? <div className="ml-auto">{action}</div> : null}
      </header>
      <div className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface-alt">
        {children}
      </div>
    </section>
  )
}

export function SettingItem({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-3.5 py-2.5', className)}>
      <div className="min-w-0">
        <div className="text-[13px] leading-tight font-medium text-fg">{title}</div>
        {description ? (
          <p className="mt-1 text-[12px] leading-snug text-fg-muted">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}

export function SettingField({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('px-3.5 py-2.5', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-baseline gap-2 text-[12.5px] font-medium text-fg"
      >
        {label}
        {hint ? <span className="text-[11.5px] font-normal text-fg-subtle">{hint}</span> : null}
      </label>
      {children}
    </div>
  )
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12.5px] text-fg-subtle">
      {icon ? <div className="opacity-40">{icon}</div> : null}
      <span>{children}</span>
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-px text-[11px] leading-4',
        tone === 'accent'
          ? 'border-accent/30 bg-accent-soft text-accent'
          : 'border-line bg-surface text-fg-muted'
      )}
    >
      {children}
    </span>
  )
}
