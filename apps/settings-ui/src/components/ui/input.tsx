import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * Inputs are 30px tall to line up with `md` buttons. The edge is a ring so the
 * focus state can swap it for the accent without a border-width jump.
 */
const fieldClasses =
  'w-full rounded-lg border border-line bg-field text-fg placeholder:text-fg-faint ' +
  'outline-none transition-[border-color,box-shadow,background-color] duration-150 ' +
  'hover:border-line-strong ' +
  'focus:border-accent focus:ring-2 focus:ring-accent/20 ' +
  'disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(fieldClasses, 'h-[32px] px-3 text-[12.5px]', className)}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(fieldClasses, 'resize-y px-3 py-2 text-[12.5px] leading-relaxed', className)}
      {...props}
    />
  )
}

/**
 * Input with an adornment on either side (a search icon, a unit, a reveal
 * button). The wrapper owns the edge so the adornments sit inside it.
 */
export function InputGroup({
  leading,
  trailing,
  className,
  inputClassName,
  ...props
}: ComponentProps<'input'> & {
  leading?: ReactNode
  trailing?: ReactNode
  inputClassName?: string
}) {
  return (
    <div
      className={cn(
        'group/field relative flex h-[32px] items-center rounded-lg border border-line bg-field',
        'transition-[border-color,box-shadow] duration-150',
        'hover:border-line-strong',
        'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
        className
      )}
    >
      {leading ? (
        <span className="flex shrink-0 items-center pl-2.5 text-fg-subtle [&_svg]:size-3.5">
          {leading}
        </span>
      ) : null}
      <input
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent px-3 text-[12.5px] text-fg outline-none',
          'placeholder:text-fg-faint',
          leading ? 'pl-2' : '',
          trailing ? 'pr-1' : '',
          inputClassName
        )}
        {...props}
      />
      {trailing ? (
        <span className="flex shrink-0 items-center pr-1.5 text-fg-subtle">{trailing}</span>
      ) : null}
    </div>
  )
}

export { fieldClasses }
