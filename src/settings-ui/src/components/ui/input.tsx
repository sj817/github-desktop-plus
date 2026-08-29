import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const fieldClasses =
  'w-full rounded-md border border-line bg-surface-alt px-2.5 text-fg placeholder:text-fg-subtle ' +
  'transition-colors outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 ' +
  'disabled:opacity-60'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} className={cn(fieldClasses, 'h-8 text-[13px]', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(fieldClasses, 'resize-y py-1.5 text-[12.5px] leading-relaxed', className)}
      {...props}
    />
  )
}

export { fieldClasses }
