import type { IpcRenderer } from '../types'

interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'block'
  category: string
  message: string
}

export function buildLogsTab(): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <p class="gdp-section-heading" style="margin:0">运行日志</p>
      <div style="display:flex;gap:6px">
        <button class="gdp-btn gdp-btn-sm" id="gdp-logs-clear">清空</button>
        <button class="gdp-btn gdp-btn-sm" id="gdp-logs-open-file">打开日志文件</button>
      </div>
    </div>
    <div class="gdp-log-container" id="gdp-log-container"></div>
  `
  return div
}

function formatEntry(entry: LogEntry): string {
  const time = entry.ts ? entry.ts.replace('T', ' ').replace(/\.\d+Z$/, '') : ''
  return `${time} [${entry.level.toUpperCase()}][${entry.category}] ${entry.message}`
}

export function appendLogEntry(container: HTMLElement, entry: LogEntry): void {
  const logContainer = container.querySelector<HTMLElement>('#gdp-log-container')
  if (!logContainer) return

  const p = document.createElement('p')
  p.className = `gdp-log-entry level-${entry.level}`
  p.textContent = formatEntry(entry)
  logContainer.appendChild(p)

  // Auto-scroll if near bottom
  const { scrollTop, scrollHeight, clientHeight } = logContainer
  if (scrollHeight - scrollTop - clientHeight < 60) {
    logContainer.scrollTop = scrollHeight
  }

  // Cap at 500 entries
  while (logContainer.children.length > 500) {
    logContainer.firstElementChild?.remove()
  }
}

export async function initLogsTab(
  container: HTMLElement,
  ipc: IpcRenderer,
  onNewLine: (handler: (entry: LogEntry) => void) => void,
  openLogFile: () => void,
): Promise<void> {
  const logContainer = container.querySelector<HTMLElement>('#gdp-log-container')

  // Load last 200 log entries
  try {
    const entries = await ipc.invoke('gdp:tail-log', 200) as LogEntry[]
    if (logContainer) {
      for (const entry of entries) {
        const p = document.createElement('p')
        p.className = `gdp-log-entry level-${entry.level}`
        p.textContent = formatEntry(entry)
        logContainer.appendChild(p)
      }
      logContainer.scrollTop = logContainer.scrollHeight
    }
  } catch { /* best effort */ }

  // Listen for new lines pushed from main process
  onNewLine((entry: LogEntry) => {
    appendLogEntry(container, entry)
  })

  // Clear button
  container.querySelector<HTMLButtonElement>('#gdp-logs-clear')?.addEventListener('click', () => {
    if (logContainer) logContainer.innerHTML = ''
  })

  // Open file button
  container.querySelector<HTMLButtonElement>('#gdp-logs-open-file')?.addEventListener('click', () => {
    openLogFile()
  })
}
