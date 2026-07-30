import type { IpcRenderer } from '../types'
import { icon } from '../components'

interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'block'
  category: string
  message: string
}

export function buildLogsTab(): HTMLElement {
  const div = document.createElement('div')
  div.className = 'gdp-tab-panel'
  div.innerHTML = `
    <div class="gdp-toolbar">
      <span class="gdp-live">实时</span>
      <span class="gdp-grow"></span>
      <div class="gdp-search">
        ${icon('search', 13)}
        <input class="gdp-input" id="gdp-logs-filter" type="text" placeholder="过滤日志…" spellcheck="false">
      </div>
      <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-logs-clear">${icon('trash', 12)}清空</button>
      <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-logs-open-file">${icon('file-text', 12)}日志文件</button>
    </div>
    <div class="gdp-log-view" id="gdp-log-container">
      <div class="gdp-empty" id="gdp-logs-empty">${icon('logs', 26)}<span>暂无日志输出</span></div>
    </div>
  `
  return div
}

function formatTime(ts: string): string {
  if (!ts) return ''
  // "2026-07-31T02:14:05.123Z" → "02:14:05"
  const m = ts.match(/T(\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : ts
}

function renderEntry(entry: LogEntry): HTMLElement {
  const row = document.createElement('div')
  row.className = `gdp-log-entry level-${entry.level}`

  const time = document.createElement('span')
  time.className = 'gdp-log-time'
  time.textContent = formatTime(entry.ts)

  const badge = document.createElement('span')
  badge.className = 'gdp-log-badge'
  badge.textContent = entry.level.toUpperCase()

  const cat = document.createElement('span')
  cat.className = 'gdp-log-cat'
  cat.textContent = entry.category

  const msg = document.createElement('span')
  msg.className = 'gdp-log-msg'
  msg.textContent = entry.message

  row.append(time, badge, cat, msg)
  return row
}

function currentFilter(container: HTMLElement): string {
  return container.querySelector<HTMLInputElement>('#gdp-logs-filter')?.value.trim().toLowerCase() ?? ''
}

function applyFilterTo(row: HTMLElement, query: string): void {
  const match = !query || (row.textContent ?? '').toLowerCase().includes(query)
  row.classList.toggle('gdp-hide', !match)
}

function hideEmpty(container: HTMLElement, hidden: boolean): void {
  container.querySelector<HTMLElement>('#gdp-logs-empty')?.classList.toggle('gdp-hide', hidden)
}

export function appendLogEntry(container: HTMLElement, entry: LogEntry): void {
  const logContainer = container.querySelector<HTMLElement>('#gdp-log-container')
  if (!logContainer) return

  hideEmpty(container, true)

  const row = renderEntry(entry)
  applyFilterTo(row, currentFilter(container))
  logContainer.appendChild(row)

  // Auto-scroll if near bottom
  const { scrollTop, scrollHeight, clientHeight } = logContainer
  if (scrollHeight - scrollTop - clientHeight < 80) {
    logContainer.scrollTop = logContainer.scrollHeight
  }

  // Cap at 500 entries (skip the empty-state placeholder)
  while (logContainer.querySelectorAll('.gdp-log-entry').length > 500) {
    logContainer.querySelector('.gdp-log-entry')?.remove()
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
    const entries = (await ipc.invoke('gdp:tail-log', 200)) as LogEntry[]
    if (logContainer && entries.length > 0) {
      hideEmpty(container, true)
      for (const entry of entries) {
        logContainer.appendChild(renderEntry(entry))
      }
      logContainer.scrollTop = logContainer.scrollHeight
    }
  } catch { /* best effort */ }

  // Listen for new lines pushed from main process
  onNewLine((entry: LogEntry) => {
    appendLogEntry(container, entry)
  })

  // Text filter
  container.querySelector<HTMLInputElement>('#gdp-logs-filter')?.addEventListener('input', () => {
    const query = currentFilter(container)
    logContainer?.querySelectorAll<HTMLElement>('.gdp-log-entry').forEach((row) => {
      applyFilterTo(row, query)
    })
  })

  // Clear button
  container.querySelector<HTMLButtonElement>('#gdp-logs-clear')?.addEventListener('click', () => {
    logContainer?.querySelectorAll('.gdp-log-entry').forEach((row) => row.remove())
    hideEmpty(container, false)
  })

  // Open file button
  container.querySelector<HTMLButtonElement>('#gdp-logs-open-file')?.addEventListener('click', () => {
    openLogFile()
  })
}
