import { createIframeBridge } from '@/bridge/iframe-bridge'
import { mount } from '@/mount'

/**
 * Dev-server entry: this file only exists for the iframe Vite serves during
 * development. Production never loads it — the dialog shell calls `mount` on
 * the built bundle instead.
 *
 * Component edits go through React Fast Refresh and never reach this file; the
 * dispose hook only matters when this module itself is replaced, where the old
 * React root has to be torn down or the next mount would fight it.
 */
const container = document.getElementById('gdp-settings-root')
if (!container) throw new Error('#gdp-settings-root is missing from index.html')

const initialTab = new URLSearchParams(window.location.search).get('tab') ?? undefined
const unmount = mount(container, createIframeBridge(), { initialTab })

import.meta.hot?.dispose(() => {
  unmount()
})
