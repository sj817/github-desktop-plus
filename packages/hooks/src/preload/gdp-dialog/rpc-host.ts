import {
  GDP_RPC_PROTOCOL,
  isGdpEventChannel,
  isGdpInvokeChannel,
  isRpcMessage,
  type RpcClientMessage,
  type RpcHostMessage,
  type Theme,
} from '@github-desktop-plus/shared'
import { getIpcRenderer, openExternal } from './electron'
import { currentTheme, watchTheme } from './theme'

/**
 * Development only — the bridge between the Vite iframe and Electron.
 *
 * The iframe is a plain web page with no node access, which is the point: every
 * capability it has is one this file chose to expose. A message is only acted
 * on when all of the following hold, otherwise it is dropped silently:
 *
 *   - it came from this exact frame (`event.source`) and origin,
 *   - it carries the protocol tag,
 *   - its channel is in the contract's allowlist.
 *
 * So a stray `postMessage` from any other page, extension or frame cannot reach
 * `ipcRenderer`, and even this frame can only reach the handful of channels the
 * settings UI legitimately uses.
 */
export function createRpcHost(options: {
  frame: HTMLIFrameElement
  origin: string
  onClose: () => void
}): { dispose: () => void } {
  const { frame, origin, onClose } = options
  const ipc = getIpcRenderer()

  const subscriptions = new Map<
    number,
    { channel: string; listener: (event: unknown, ...args: unknown[]) => void }
  >()

  const post = (message: RpcHostMessage): void => {
    frame.contentWindow?.postMessage(message, origin)
  }

  const unsubscribe = (id: number): void => {
    const entry = subscriptions.get(id)
    if (!entry) return
    subscriptions.delete(id)
    ipc?.removeListener(entry.channel, entry.listener)
  }

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== frame.contentWindow) return
    if (event.origin !== origin) return
    if (!isRpcMessage(event.data)) return

    const message = event.data as RpcClientMessage

    switch (message.kind) {
      case 'ready':
        post({ protocol: GDP_RPC_PROTOCOL, kind: 'theme', theme: currentTheme() })
        return

      case 'invoke': {
        const { id, channel, args } = message
        if (!isGdpInvokeChannel(channel)) {
          post({
            protocol: GDP_RPC_PROTOCOL,
            kind: 'result',
            id,
            ok: false,
            error: `channel not allowed: ${channel}`,
          })
          return
        }
        if (!ipc) {
          post({
            protocol: GDP_RPC_PROTOCOL,
            kind: 'result',
            id,
            ok: false,
            error: 'ipcRenderer unavailable',
          })
          return
        }
        ipc
          .invoke(channel, ...(Array.isArray(args) ? args : []))
          .then(value => post({ protocol: GDP_RPC_PROTOCOL, kind: 'result', id, ok: true, value }))
          .catch((error: unknown) =>
            post({
              protocol: GDP_RPC_PROTOCOL,
              kind: 'result',
              id,
              ok: false,
              error: String(error),
            })
          )
        return
      }

      case 'subscribe': {
        const { id, channel } = message
        if (!isGdpEventChannel(channel) || !ipc || subscriptions.has(id)) return
        const listener = (_event: unknown, ...args: unknown[]) => {
          post({ protocol: GDP_RPC_PROTOCOL, kind: 'event', id, args })
        }
        subscriptions.set(id, { channel, listener })
        ipc.on(channel, listener)
        return
      }

      case 'unsubscribe':
        unsubscribe(message.id)
        return

      case 'open-external':
        openExternal(message.url)
        return

      case 'close':
        onClose()
    }
  }

  window.addEventListener('message', onMessage)

  const stopWatchingTheme = watchTheme((theme: Theme) => {
    post({ protocol: GDP_RPC_PROTOCOL, kind: 'theme', theme })
  })

  return {
    dispose() {
      window.removeEventListener('message', onMessage)
      stopWatchingTheme()
      for (const id of [...subscriptions.keys()]) unsubscribe(id)
    },
  }
}
