import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Chip({ active, className, ...props }: ComponentProps<'button'> & { active: boolean }) {
  return <button type="button" aria-pressed={active} className={cn('gdp-chip', className)} {...props} />
}
