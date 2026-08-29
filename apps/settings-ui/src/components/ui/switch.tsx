import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        'group/switch relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center',
        'rounded-full bg-[color-mix(in_srgb,var(--gdp-fg)_16%,transparent)] p-[2px]',
        'shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] outline-none',
        'transition-[background-color,box-shadow] duration-200 ease-out',
        'hover:bg-[color-mix(in_srgb,var(--gdp-fg)_22%,transparent)]',
        'data-[checked]:bg-[#409eff] data-[checked]:hover:bg-[#66b1ff]',
        'focus-visible:outline-2 focus-visible:outline-[#409eff]/40 focus-visible:outline-offset-2',
        'data-[disabled]:cursor-default data-[disabled]:opacity-40',
        className
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'block size-[18px] rounded-full bg-white',
          'shadow-[0_1px_3px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.08)]',
          'transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          'data-[checked]:translate-x-[16px]'
        )}
      />
    </BaseSwitch.Root>
  )
}
