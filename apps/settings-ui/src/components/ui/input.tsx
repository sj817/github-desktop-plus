import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

const fieldClasses = 'gdp-input'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} className={cn(fieldClasses, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClasses, 'gdp-textarea', className)} {...props} />
}

export function InputGroup({ leading, trailing, className, inputClassName, ...props }: ComponentProps<'input'> & {
  leading?: ReactNode
  trailing?: ReactNode
  inputClassName?: string
}) {
  return (
    <div className={cn('gdp-input-group', className)}>
      {leading ? <span>{leading}</span> : null}
      <input className={inputClassName} {...props} />
      {trailing ? <span>{trailing}</span> : null}
    </div>
  )
}

export { fieldClasses }
