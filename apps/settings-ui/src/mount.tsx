import { createRoot } from 'react-dom/client'
import type { GDPBridge, MountOptions } from '@github-desktop-plus/shared'
import { App } from '@/App'
import { HostProvider } from '@/bridge/context'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'

const STYLE_ELEMENT_ID = 'gdp-settings-ui-styles'
const ROOT_ID = 'gdp-settings-root'

declare global {
  // eslint-disable-next-line no-var
  var __GDP_SETTINGS_UI_CSS__: string | undefined
}

/**
 * Production only. The build folds the stylesheet into the bundle as a global
 * (see the `gdp-inline-css` plugin in vite.config.ts) because there is no HTML
 * document to link one from — the whole thing arrives as a string that GitHub
 * Desktop evaluates. In dev, Vite has already injected the styles itself and
 * the global is absent.
 */
function ensureStyles(doc: Document): void {
  const css = globalThis.__GDP_SETTINGS_UI_CSS__
  if (!css || doc.getElementById(STYLE_ELEMENT_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = css
  doc.head.appendChild(style)
}

/**
 * Render the settings UI into `container` and return its teardown function.
 *
 * The same entry point serves both environments: production calls it from the
 * dialog shell with an ipcRenderer-backed bridge, and the dev iframe calls it
 * from `main.tsx` with the postMessage bridge. Nothing below this line knows
 * which one it is talking to.
 */
export function mount(
  container: HTMLElement,
  bridge: GDPBridge,
  options: MountOptions = {}
): () => void {
  ensureStyles(container.ownerDocument)

  // All CSS is scoped to this id, and the container doubles as the portal
  // target for popups, so it has to be positioned.
  container.id = ROOT_ID
  container.classList.add('relative', 'h-full', 'overflow-hidden')

  const applyTheme = (): void => {
    container.classList.toggle('dark', bridge.getTheme() === 'dark')
  }
  applyTheme()
  const unsubscribeTheme = bridge.onThemeChange(applyTheme)

  const root = createRoot(container)
  root.render(
    <HostProvider bridge={bridge} portalContainer={container}>
      <ToastProvider>
        <TooltipProvider>
          <App options={options} />
        </TooltipProvider>
      </ToastProvider>
    </HostProvider>
  )

  return () => {
    unsubscribeTheme()
    root.unmount()
  }
}
