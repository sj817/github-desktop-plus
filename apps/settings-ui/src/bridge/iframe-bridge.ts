import {
  GDP_RPC_PROTOCOL,
  isRpcMessage,
  type GDPBridge,
  type GdpEventChannel,
  type GdpEventMap,
  type GdpInvokeArgs,
  type GdpInvokeChannel,
  type GdpInvokeResult,
  type RpcClientMessage,
  type RpcHostMessage,
  type Theme,
} from '@github-desktop-plus/shared'

/**
 * Development bridge: the UI runs inside an iframe served by Vite, so it has no
 * Electron access at all. Every call is forwarded to the dialog shell in the
 * host renderer, which owns `ipcRenderer` and enforces the channel allowlist.
 *
 * Only used when `import.meta.env.DEV` — production mounts directly into the
 * host document and gets the ipcRenderer-backed bridge instead.
 */
export function createIframeBridge(): GDPBridge {
  const parentWindow = window.parent
  let nextId = 1

  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const subscriptions = new Map<number, (...args: unknown[]) => void>()

  // The host document is a file:// page, whose origin serialises to "null".
  // A concrete targetOrigin can therefore never match, so messages upward go to
  // '*'. Messages coming *down* are still checked against window.parent.
  const post = (message: RpcClientMessage): void => {
    parentWindow.postMessage(message, '*')
  }

  const themeFromUrl = new URLSearchParams(window.location.search).get('theme')
  let theme: Theme = themeFromUrl === 'dark' ? 'dark' : 'light'
  const themeHandlers = new Set<(theme: Theme) => void>()

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== parentWindow || !isRpcMessage(event.data)) return
    const message = event.data as RpcHostMessage

    if (message.kind === 'result') {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.ok) entry.resolve(message.value)
      else entry.reject(new Error(message.error))
      return
    }

    if (message.kind === 'event') {
      const handler = subscriptions.get(message.id)
      if (handler) handler(...message.args)
      return
    }

    if (message.kind === 'theme') {
      theme = message.theme
      for (const handler of themeHandlers) handler(theme)
    }
  })

  post({ protocol: GDP_RPC_PROTOCOL, kind: 'ready' })

  return {
    mode: 'dev-iframe',

    invoke<C extends GdpInvokeChannel>(
      channel: C,
      ...args: GdpInvokeArgs<C>
    ): Promise<GdpInvokeResult<C>> {
      const id = nextId++
      return new Promise<GdpInvokeResult<C>>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        post({ protocol: GDP_RPC_PROTOCOL, kind: 'invoke', id, channel, args })
      })
    },

    on<C extends GdpEventChannel>(channel: C, handler: (...args: GdpEventMap[C]) => void) {
      const id = nextId++
      subscriptions.set(id, handler as (...args: unknown[]) => void)
      post({ protocol: GDP_RPC_PROTOCOL, kind: 'subscribe', id, channel })
      return () => {
        if (!subscriptions.delete(id)) return
        post({ protocol: GDP_RPC_PROTOCOL, kind: 'unsubscribe', id })
      }
    },

    close() {
      post({ protocol: GDP_RPC_PROTOCOL, kind: 'close' })
    },

    openExternal(url: string) {
      post({ protocol: GDP_RPC_PROTOCOL, kind: 'open-external', url })
    },

    getTheme: () => theme,

    onThemeChange(handler) {
      themeHandlers.add(handler)
      return () => {
        themeHandlers.delete(handler)
      }
    },
  }
}
