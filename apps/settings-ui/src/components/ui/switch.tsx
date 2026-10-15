import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root className={cn('gdp-switch', className)} {...props}>
      <BaseSwitch.Thumb className="gdp-switch-thumb" />
    </BaseSwitch.Root>
  )
}
