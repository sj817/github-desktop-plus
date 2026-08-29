import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import { usePortalContainer } from '@/bridge/context'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={350}>{children}</BaseTooltip.Provider>
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
              'rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-fg-muted ' +
              'shadow-md shadow-black/10 ' +
              'data-[starting-style]:animate-[gdp-pop-in_120ms_ease-out]'
            }
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
