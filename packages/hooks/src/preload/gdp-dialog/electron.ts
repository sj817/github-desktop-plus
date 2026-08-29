/**
 * The slice of Electron the dialog shell needs.
 *
 * GitHub Desktop's renderer runs with `nodeIntegration: true` and
 * `contextIsolation: false`, so `require` is available in the main world — this
 * file is the single place that relies on it, and everything downstream takes
 * the typed objects instead.
 */

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

export interface ShellLike {
  openExternal(url: string): Promise<void>
}

interface ElectronRenderer {
  ipcRenderer: IpcRendererLike
  shell: ShellLike
}

function electron(): ElectronRenderer | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require as NodeRequire)('electron') as ElectronRenderer
  } catch {
    return null
  }
}

export function getIpcRenderer(): IpcRendererLike | null {
  return electron()?.ipcRenderer ?? null
}

/** Opens a URL in the system browser. Non-https URLs are refused. */
export function openExternal(url: string): void {
  if (!/^https:\/\//i.test(url)) return
  electron()
    ?.shell.openExternal(url)
    .catch(() => {
      /* nothing useful to do from the renderer */
    })
}
