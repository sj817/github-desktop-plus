import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full',
        'border border-line bg-surface-hover transition-colors outline-none',
        'data-[checked]:border-accent data-[checked]:bg-accent',
        'focus-visible:ring-2 focus-visible:ring-accent/40',
        'data-[disabled]:cursor-default data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'block size-3 translate-x-[2px] rounded-full bg-canvas shadow-sm transition-transform',
          'data-[checked]:translate-x-[16px] data-[checked]:bg-accent-fg'
        )}
      />
    </BaseSwitch.Root>
  )
}
