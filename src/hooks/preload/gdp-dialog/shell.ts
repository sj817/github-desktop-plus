import type { GdpSettingsUiGlobal } from '../../../shared/gdp-ipc'
import { GDP_SETTINGS_UI_GLOBAL } from '../../../shared/gdp-ipc'
import { createDirectBridge } from './direct-bridge'
import { createRpcHost } from './rpc-host'
import { injectShellStyles } from './styles'
import { currentTheme } from './theme'

/**
 * The dialog shell: a `<dialog>`, the box the settings UI lives in, and the
 * lifecycle around it. It deliberately knows nothing about settings — the UI is
 * a React bundle that is either mounted into this box (production) or loaded
 * into an iframe from the Vite dev server (development).
 *
 * Everything the UI needs is torn down on close: the React root is unmounted,
 * the iframe is removed, and the bridge drops every IPC listener it handed out.
 * Reopening builds a fresh instance, which is also what makes "cancel" discard
 * unsaved edits.
 */

interface DevGlobals {
  __GDP_SETTINGS_DEV_URL__?: string
  [GDP_SETTINGS_UI_GLOBAL]?: GdpSettingsUiGlobal
}

function globals(): DevGlobals {
  return window as unknown as DevGlobals
}

export interface DialogShell {
  show(tab?: string): void
  close(): void
}

export function createDialogShell(): DialogShell {
  injectShellStyles()

  const dialog = document.createElement('dialog')
  dialog.id = 'gdp-settings-dialog'

  const box = document.createElement('div')
  box.className = 'gdp-shell'
  dialog.appendChild(box)
  document.body.appendChild(dialog)

  /** Torn down on every close; null while the dialog is shut. */
  let teardown: (() => void) | null = null

  const close = (): void => {
    if (dialog.open) dialog.close()
    else runTeardown()
  }

  const runTeardown = (): void => {
    const current = teardown
    teardown = null
    if (!current) return
    try {
      current()
    } catch (error) {
      console.warn('[GDP] settings teardown failed:', error)
    }
    box.replaceChildren()
  }

  // One cleanup path for every close route: backdrop, Esc, the × button and
  // programmatic close all end up here.
  dialog.addEventListener('close', runTeardown)
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close()
  })

  const show = (tab?: string): void => {
    if (!dialog.open) {
      teardown = mountUi(box, tab, close)
      dialog.showModal()
    } else if (teardown) {
      // Already open — bring it forward rather than remounting over the top.
      dialog.focus()
    }
  }

  return { show, close }
}

function mountUi(box: HTMLElement, tab: string | undefined, onClose: () => void): () => void {
  const devUrl = globals().__GDP_SETTINGS_DEV_URL__
  return devUrl ? mountDevFrame(box, devUrl, tab, onClose) : mountProduction(box, tab, onClose)
}

/** Production: the bundled UI renders straight into GitHub Desktop's document. */
function mountProduction(box: HTMLElement, tab: string | undefined, onClose: () => void): () => void {
  const ui = globals()[GDP_SETTINGS_UI_GLOBAL]
  if (!ui) {
    box.replaceChildren(errorMessage('设置界面未能加载（settings-ui bundle 缺失）'))
    return () => {}
  }

  const root = document.createElement('div')
  root.id = 'gdp-settings-root'
  box.replaceChildren(root)

  const { bridge, dispose } = createDirectBridge(onClose)
  const unmount = ui.mount(root, bridge, { initialTab: tab })

  return () => {
    unmount()
    dispose()
  }
}

/**
 * Development: the UI is served by Vite so edits hot-reload. It runs in an
 * iframe with no node access and reaches Electron only through the RPC host,
 * which checks the frame, the origin and the channel on every message.
 */
function mountDevFrame(
  box: HTMLElement,
  devUrl: string,
  tab: string | undefined,
  onClose: () => void
): () => void {
  let origin: string
  let src: string
  try {
    const url = new URL(devUrl)
    origin = url.origin
    url.searchParams.set('theme', currentTheme())
    if (tab) url.searchParams.set('tab', tab)
    src = url.toString()
  } catch {
    box.replaceChildren(errorMessage(`GDP_SETTINGS_DEV_URL 不是合法地址：${devUrl}`))
    return () => {}
  }

  const frame = document.createElement('iframe')
  frame.className = 'gdp-frame'
  frame.src = src
  frame.addEventListener('load', () => frame.focus())
  box.replaceChildren(frame)

  const host = createRpcHost({ frame, origin, onClose })

  return () => {
    host.dispose()
    frame.remove()
  }
}

function errorMessage(text: string): HTMLElement {
  const element = document.createElement('div')
  element.textContent = text
  element.style.cssText =
    'display:grid;place-items:center;width:100%;padding:24px;' +
    'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'color:var(--text-secondary-color,#656d76);text-align:center;'
  return element
}
