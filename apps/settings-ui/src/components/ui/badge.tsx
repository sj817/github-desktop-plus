import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[color-mix(in_srgb,var(--gdp-fg)_7%,transparent)] text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 rounded-full px-1.5 text-[10.5px] font-medium',
        'leading-none whitespace-nowrap',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
