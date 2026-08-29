import { createIframeBridge } from '@/bridge/iframe-bridge'
import { mount } from '@/mount'

/**
 * Dev-server entry: this file only exists for the iframe Vite serves during
 * development. Production never loads it — the dialog shell calls `mount` on
 * the built bundle instead.
 *
 * Two dev modes:
 *   - inside GitHub Desktop (`pnpm dev`): the postMessage bridge to the shell.
 *   - standalone in a browser (`?mock=1`): an in-memory bridge so the UI can be
 *     iterated on without a host. `&theme=dark` picks the theme, `&scenario=empty`
 *     starts from an empty config; `window.__gdpSetTheme('dark')` flips it live.
 *
 * Component edits go through React Fast Refresh and never reach this file; the
 * dispose hook only matters when this module itself is replaced, where the old
 * React root has to be torn down or the next mount would fight it.
 */
const container = document.getElementById('gdp-settings-root')
if (!container) throw new Error('#gdp-settings-root is missing from index.html')

const params = new URLSearchParams(window.location.search)
const initialTab = params.get('tab') ?? undefined
const useMock = import.meta.env.DEV && params.get('mock') === '1'

async function start(): Promise<() => void> {
  if (!useMock) return mount(container!, createIframeBridge(), { initialTab })

  const { createMockBridge } = await import('@/bridge/mock-bridge')
  const bridge = createMockBridge()
  // Frame the root like the production dialog so screenshots are honest.
  document.body.classList.add('gdp-mock')
  ;(window as unknown as { __gdpSetTheme?: (theme: 'light' | 'dark') => void }).__gdpSetTheme =
    theme => {
      document.body.classList.toggle('dark', theme === 'dark')
      ;(bridge as unknown as { __setTheme(theme: 'light' | 'dark'): void }).__setTheme(theme)
    }
  document.body.classList.toggle('dark', bridge.getTheme() === 'dark')
  return mount(container!, bridge, { initialTab })
}

const unmountPromise = start()

import.meta.hot?.dispose(() => {
  void unmountPromise.then(unmount => unmount())
})
