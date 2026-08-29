import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import { usePortalContainer } from '@/bridge/context'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={400}>{children}</BaseTooltip.Provider>
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const container = usePortalContainer()

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner sideOffset={6} className="z-60">
          <BaseTooltip.Popup
            className={
              'rounded-md bg-fg px-2 py-1 text-[11.5px] text-canvas shadow-md ' +
              'origin-[var(--transform-origin)] ' +
              'data-[starting-style]:animate-pop-in data-[ending-style]:animate-pop-out'
            }
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
