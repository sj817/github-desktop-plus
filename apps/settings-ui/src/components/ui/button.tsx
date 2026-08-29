import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/*
 * Buttons carry their edge as a shadow ring rather than a border, so they sit
 * flush with inputs of the same height and the pressed state can shrink the
 * ring without shifting layout.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium ' +
    'select-none outline-none transition-[background-color,color,box-shadow,transform,opacity,border-color] ' +
    'duration-150 ease-out active:scale-[0.98] ' +
    'disabled:pointer-events-none disabled:opacity-45 ' +
    'focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-1 ' +
    '[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-80',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg shadow-sm ' +
          'hover:bg-accent-hover hover:shadow active:bg-accent-hover [&_svg]:opacity-100',
        secondary:
          'border border-line bg-elevated text-fg shadow-xs hover:bg-hover hover:border-line-strong active:bg-active ' +
          'dark:bg-field',
        ghost: 'text-fg-muted hover:bg-hover hover:text-fg active:bg-active',
        danger: 'border border-line bg-elevated text-danger shadow-xs hover:bg-danger-soft hover:border-danger/30 dark:bg-field',
        'danger-solid': 'bg-danger text-white hover:brightness-110 shadow-sm',
        link: 'text-fg-muted hover:text-accent [&_svg]:opacity-70',
      },
      size: {
        xs: 'h-6 px-2 text-[11.5px] rounded-md [&_svg]:size-3',
        sm: 'h-7 px-2.5 text-[12px] rounded-md',
        md: 'h-[32px] px-3.5 text-[12.5px] rounded-lg',
        icon: 'size-7 p-0 rounded-md',
        'icon-sm': 'size-6 p-0 rounded-md [&_svg]:size-3.5',
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
