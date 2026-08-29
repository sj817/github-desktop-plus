import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { GDPBridge, Theme } from '@shared/gdp-ipc'

interface HostValue {
  bridge: GDPBridge
  /**
   * Where popups (select menus, tooltips, toasts) must render.
   *
   * In production the UI lives inside a modal `<dialog>`; anything portalled to
   * `document.body` would end up outside it and be inert. Everything portals
   * into the app root instead.
   */
  portalContainer: HTMLElement
}

const HostContext = createContext<HostValue | null>(null)

export function HostProvider({
  bridge,
  portalContainer,
  children,
}: HostValue & { children: ReactNode }) {
  return <HostContext.Provider value={{ bridge, portalContainer }}>{children}</HostContext.Provider>
}

function useHost(): HostValue {
  const value = useContext(HostContext)
  if (!value) throw new Error('HostProvider is missing')
  return value
}

export function useBridge(): GDPBridge {
  return useHost().bridge
}

export function usePortalContainer(): HTMLElement {
  return useHost().portalContainer
}

/** GitHub Desktop's current theme, kept live while the dialog is open. */
export function useTheme(bridge: GDPBridge): Theme {
  const [theme, setTheme] = useState<Theme>(() => bridge.getTheme())
  useEffect(() => bridge.onThemeChange(setTheme), [bridge])
  return theme
}
