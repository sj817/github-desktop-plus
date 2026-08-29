import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium ' +
    'transition-colors select-none disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary:
          'border border-line bg-surface-alt text-fg hover:bg-surface-hover hover:border-line',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        danger: 'border border-line bg-surface-alt text-danger hover:bg-danger-soft',
        link: 'text-fg-muted hover:text-accent',
      },
      size: {
        sm: 'h-6.5 px-2 text-[12px]',
        md: 'h-8 px-3 text-[13px]',
        icon: 'size-6.5 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
)

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}

export { buttonVariants }
