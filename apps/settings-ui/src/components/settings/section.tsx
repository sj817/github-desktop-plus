import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * Layout primitives every page is built from.
 *
 * The visual model is a document, not a dashboard: a section is a heading with
 * a list of rows beneath it, and rows are separated by hairlines rather than
 * wrapped in cards. Hierarchy comes from spacing and type weight.
 */

export function SettingSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-6 last:mb-0 space-y-2.5', className)}>
      {(title || description || action) ? (
        <header className="flex items-center justify-between gap-3 px-1.5">
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="text-[13px] leading-5 font-semibold text-fg tracking-normal">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="text-[12px] leading-normal text-fg-muted mt-0.5">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
        </header>
      ) : null}
      <div className="rounded-2xl border border-line/70 bg-elevated shadow-xs divide-y divide-line/60 overflow-hidden">
        {children}
      </div>
    </section>
  )
}

/** A compact setting: label and description on the left, control on the right. */
export function SettingItem({
  title,
  description,
  children,
  className,
  align = 'center',
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={cn(
        'flex gap-6 px-4.5 py-4 transition-colors duration-150 hover:bg-hover/20',
        align === 'center' ? 'items-center' : 'items-start',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug font-medium text-fg">{title}</div>
        {description ? (
          <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}

/** A stacked setting for inputs that need the full width. */
export function SettingField({
  label,
  hint,
  htmlFor,
  trailing,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  htmlFor?: string
  trailing?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('px-4 py-3.5 flex flex-col gap-2 transition-colors duration-150 hover:bg-hover/20', className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-[12.5px] leading-5 font-medium text-fg">
          {label}
        </label>
        {hint ? <span className="text-[11.5px] text-fg-subtle">{hint}</span> : null}
        {trailing ? <div className="ml-auto flex items-center gap-1.5">{trailing}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-6 py-10 text-center font-sans',
        className
      )}
    >
      {icon ? (
        <div className="mb-2 grid size-10 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--gdp-fg)_6%,transparent)] text-fg-subtle [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      {title ? <div className="text-[13px] font-medium text-fg">{title}</div> : null}
      {children ? (
        <p className="max-w-72 text-[12px] leading-[18px] text-fg-subtle">{children}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

/** A quiet inline note — used for status, caveats and hints beneath a group. */
export function Note({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'danger' | 'warn' | 'accent'
  icon?: ReactNode
  className?: string
}) {
  const toneClass = {
    neutral: 'text-fg-subtle',
    success: 'text-success',
    danger: 'text-danger',
    warn: 'text-warn',
    accent: 'text-accent',
  }[tone]
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 text-[12px] leading-[18px] [&_svg]:mt-[3px] [&_svg]:size-3',
        toneClass,
        className
      )}
    >
      {icon}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

export { Badge } from '@/components/ui/badge'
