import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'link'
  size?: 'xs' | 'sm' | 'md' | 'icon' | 'icon-sm'
}

export function Button({ className, variant = 'secondary', size = 'md', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn('gdp-button', 'gdp-button-' + variant, 'gdp-button-' + size, className)} {...props} />
}
