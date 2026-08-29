/**
 * GDP settings dialog — entry point injected into GitHub Desktop's renderer.
 *
 * This file is only the wiring: it owns the three ways the dialog is opened and
 * hands off to the shell, which in turn hosts the React settings UI.
 *
 *   GDP menu / gdp:open-settings → 'gdp:show-dialog' from the main process
 *   Ctrl+Alt+G                   → local shortcut (also registered globally)
 */
import { createDialogShell, type DialogShell } from './shell'
import { getIpcRenderer } from './electron'

;(function () {
  // The hook re-injects every bundle on each page load. A second run inside the
  // same document would register a second set of listeners and hand out a
  // second dialog, so bail if we are already here.
  const flag = '__gdpSettingsShellLoaded'
  const scope = window as unknown as Record<string, unknown>
  if (scope[flag]) return
  scope[flag] = true

  let shell: DialogShell | null = null

  function show(tab?: string): void {
    // Built on first use: no DOM, styles or bridges exist until the user
    // actually opens the settings.
    shell ??= createDialogShell()
    shell.show(tab)
  }

  const ipc = getIpcRenderer()
  if (ipc) {
    ipc.on('gdp:show-dialog', (_event, payload) => {
      const tab = (payload as { tab?: unknown } | undefined)?.tab
      show(typeof tab === 'string' ? tab : undefined)
    })
  } else {
    console.warn('[GDP] ipcRenderer unavailable — settings dialog cannot be opened from the menu')
  }

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'g') {
      event.preventDefault()
      show('general')
    }
  })

  console.log('[GDP] Settings dialog shell loaded')
})()
