/**
 * GDP Settings Dialog — native DOM dialog embedded in GitHub Desktop's renderer.
 * Listens for 'gdp:show-dialog' IPC messages from the main process.
 * Also supports Ctrl+Alt+G shortcut for direct open.
 */
import { injectStyles } from './styles'
import { buildDialog, openDialog, closeDialog } from './dialog'

type TabId = 'general' | 'ai' | 'logs' | 'locales'

;(function () {
  let initialized = false
  let dialog: HTMLDialogElement | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dialogState: any = null

  function init(): void {
    if (initialized) return
    initialized = true

    injectStyles()

    const built = buildDialog()
    dialog = built.dialog
    dialogState = built.state
  }

  function showDialog(tab: TabId = 'general'): void {
    init()
    if (dialog && dialogState) {
      openDialog(dialog, dialogState, tab)
    }
  }

  // Listen for IPC messages from main process (via GDP menu / gdp:open-settings)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ipcRenderer = (require as NodeRequire)('electron').ipcRenderer as {
      on(channel: string, listener: (event: unknown, payload: unknown) => void): void
    }

    ipcRenderer.on('gdp:show-dialog', (_event, payload) => {
      const p = payload as { tab?: string } | undefined
      showDialog((p?.tab as TabId) ?? 'general')
    })
  } catch (e) {
    console.warn('[GDP] Could not register gdp:show-dialog listener:', e)
  }

  // Keyboard shortcut: Ctrl+Alt+G
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      showDialog('general')
    }
  })

  // Allow renderer code to close the dialog programmatically
  ;(window as unknown as Record<string, unknown>).__gdpCloseDialog = () => {
    if (dialog && dialogState) closeDialog(dialog, dialogState)
  }

  console.log('[GDP] Settings dialog module loaded')
})()
