import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/*
 * Buttons carry their edge as a shadow ring rather than a border, so they sit
 * flush with inputs of the same height and the pressed state can shrink the
 * ring without shifting layout.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-normal ' +
    'select-none outline-none transition-[background-color,color,box-shadow,transform,opacity,border-color] ' +
    'duration-150 ease-out active:scale-[0.98] ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    'focus-visible:ring-2 focus-visible:ring-[#409eff]/30 focus-visible:ring-offset-1 ' +
    '[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-80',
  {
    variants: {
      variant: {
        primary:
          'border border-[#409eff] bg-[#409eff]/10 text-[#409eff] font-medium shadow-none ' +
          'hover:bg-[#409eff]/20 hover:border-[#409eff] active:bg-[#409eff]/30 [&_svg]:opacity-100',
        secondary:
          'border border-line bg-field text-fg shadow-none ' +
          'hover:text-[#409eff] hover:border-[#409eff]/60 hover:bg-[#409eff]/8 active:bg-[#409eff]/15',
        ghost:
          'border border-transparent bg-transparent text-fg-muted ' +
          'hover:text-[#409eff] hover:border-line/40 hover:bg-[#409eff]/8 active:bg-[#409eff]/15',
        danger:
          'border border-[#f56c6c]/50 bg-[#f56c6c]/10 text-[#f56c6c] shadow-none ' +
          'hover:bg-[#f56c6c]/20 hover:border-[#f56c6c] active:bg-[#f56c6c]/30',
        'danger-solid':
          'border border-[#f56c6c] bg-[#f56c6c]/15 text-[#f56c6c] font-medium shadow-none ' +
          'hover:bg-[#f56c6c]/25 hover:border-[#f56c6c] active:bg-[#f56c6c]/35',
        link: 'border-0 bg-transparent text-fg-muted hover:text-[#409eff] [&_svg]:opacity-70',
      },
      size: {
        xs: 'h-6 px-2 text-[11.5px] rounded-md [&_svg]:size-3',
        sm: 'h-7 px-2.5 text-[12px] rounded-md',
        md: 'h-8 px-3 text-[12.5px] rounded-md',
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
