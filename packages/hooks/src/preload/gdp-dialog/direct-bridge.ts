import type {
  GDPBridge,
  GdpEventChannel,
  GdpEventMap,
  GdpInvokeArgs,
  GdpInvokeChannel,
  GdpInvokeResult,
  Theme,
} from '@github-desktop-plus/shared'
import { getIpcRenderer, openExternal, type IpcRendererLike } from './electron'
import { currentTheme, watchTheme } from './theme'

/**
 * Production bridge: the settings UI is mounted straight into GitHub Desktop's
 * renderer, so calls go to `ipcRenderer` with nothing in between.
 *
 * `dispose()` is the safety net for the thing that actually bites here — a
 * leaked `gdp:log-line` listener. React unsubscribes on unmount, but the shell
 * also drops every listener this bridge ever registered when the dialog closes,
 * so a component that forgets cannot accumulate them across open/close cycles.
 */
export function createDirectBridge(onClose: () => void): {
  bridge: GDPBridge
  dispose: () => void
} {
  const ipc = getIpcRenderer()
  const registered = new Set<{
    channel: string
    listener: (event: unknown, ...args: unknown[]) => void
  }>()

  const themeHandlers = new Set<(theme: Theme) => void>()
  const stopWatchingTheme = watchTheme(theme => {
    for (const handler of themeHandlers) handler(theme)
  })

  const bridge: GDPBridge = {
    mode: 'production',

    invoke<C extends GdpInvokeChannel>(
      channel: C,
      ...args: GdpInvokeArgs<C>
    ): Promise<GdpInvokeResult<C>> {
      if (!ipc) return Promise.reject(new Error('ipcRenderer unavailable'))
      return ipc.invoke(channel, ...args) as Promise<GdpInvokeResult<C>>
    },

    on<C extends GdpEventChannel>(channel: C, handler: (...args: GdpEventMap[C]) => void) {
      if (!ipc) return () => {}
      const listener = (_event: unknown, ...args: unknown[]) => {
        ;(handler as (...args: unknown[]) => void)(...args)
      }
      const entry = { channel, listener }
      registered.add(entry)
      ipc.on(channel, listener)
      return () => {
        if (!registered.delete(entry)) return
        ipc.removeListener(channel, listener)
      }
    },

    close: onClose,

    openExternal,

    getTheme: currentTheme,

    onThemeChange(handler) {
      themeHandlers.add(handler)
      return () => {
        themeHandlers.delete(handler)
      }
    },
  }

  return {
    bridge,
    dispose() {
      stopWatchingTheme()
      themeHandlers.clear()
      dropListeners(ipc, registered)
    },
  }
}

function dropListeners(
  ipc: IpcRendererLike | null,
  registered: Set<{ channel: string; listener: (event: unknown, ...args: unknown[]) => void }>
): void {
  if (ipc) {
    for (const entry of registered) ipc.removeListener(entry.channel, entry.listener)
  }
  registered.clear()
}
