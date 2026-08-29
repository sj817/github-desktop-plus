import {
  listWslDistributions,
  normalizeWslPathInput,
  toWslUncPath,
} from './distributions'
import { getWslAgentClient } from './agent-client'
import { parseWslRepositoryPath } from './path'
import { mutationsTouchSelector } from '../lib/mutation-filter'

interface RepositoryDialogDefinition {
  dialog: string
  input: string
}

interface RepositoryDialogWindow extends Window {
  __GDP_CONFIG__?: { locale?: string; dataDir?: string }
  __gdpWslRepositoryDialogsInstalled?: boolean
}

const DIALOGS: readonly RepositoryDialogDefinition[] = [
  {
    dialog: '#create-repository',
    input: 'input[aria-describedby~="path-is-subfolder-of-repository"]',
  },
  {
    dialog: '#add-existing-repository',
    input: 'input[aria-describedby~="add-existing-repository-path-error"]',
  },
]

const STYLE_ID = 'gdp-wsl-repository-dialog-styles'
const TOOL_CLASS = 'gdp-wsl-helper-row'
const DIALOG_SELECTOR = DIALOGS.map(definition => definition.dialog).join(',')
let distributionsPromise: Promise<string[]> | undefined
const decoratingDialogs = new WeakSet<HTMLElement>()

function isChinese(): boolean {
  return ((window as RepositoryDialogWindow).__GDP_CONFIG__?.locale ?? '').toLowerCase().startsWith('zh')
}

function strings() {
  return isChinese()
    ? {
        distroLabel: 'WSL 发行版',
        use: '填入 WSL 路径',
        checking: '检查 Agent…',
        unavailable: 'Agent 不可用',
        ready: 'WSL Agent 已就绪',
      }
    : {
        distroLabel: 'WSL Distribution',
        use: 'Use WSL Path',
        checking: 'Checking Agent…',
        unavailable: 'Agent unavailable',
        ready: 'WSL Agent is ready',
      }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .${TOOL_CLASS} {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      margin-bottom: 12px;
      padding: 0 1px;
      box-sizing: border-box;
      font-size: 12px;
      user-select: none;
    }
    .${TOOL_CLASS} * { box-sizing: border-box; }
    .${TOOL_CLASS} .gdp-wsl-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 22px;
      padding: 0 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #409eff;
      background: rgba(64, 158, 255, 0.10);
      border: 1px solid rgba(64, 158, 255, 0.35);
      flex-shrink: 0;
    }
    .${TOOL_CLASS} .gdp-wsl-select {
      flex: 1;
      min-width: 0;
      height: 28px;
      padding: 0 10px;
      border-radius: 4px;
      border: 1px solid var(--box-border-color, #d0d7de);
      background: var(--background-color, #ffffff);
      color: var(--text-color, inherit);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .${TOOL_CLASS} .gdp-wsl-select:hover {
      border-color: var(--text-secondary-color, #8c959f);
    }
    .${TOOL_CLASS} .gdp-wsl-select:focus {
      border-color: #409eff;
      box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.18);
    }
    .${TOOL_CLASS} .gdp-wsl-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      padding: 0 12px;
      border-radius: 4px;
      border: 1px solid var(--box-border-color, #d0d7de);
      background: var(--background-color, #ffffff);
      color: var(--text-color, inherit);
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .${TOOL_CLASS} .gdp-wsl-btn:hover {
      color: #409eff;
      border-color: #409eff;
      background: rgba(64, 158, 255, 0.08);
    }
    .${TOOL_CLASS} .gdp-wsl-btn:active {
      background: rgba(64, 158, 255, 0.16);
    }
  `
  document.head.appendChild(style)
}

function setReactInputValue(input: HTMLInputElement, value: string, focus: boolean): void {
  if (value === input.value) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  if (focus) {
    input.focus()
    input.setSelectionRange(value.length, value.length)
  }
}

function useDistribution(input: HTMLInputElement, distro: string): void {
  const normalized = normalizeWslPathInput(input.value, distro) ?? toWslUncPath(distro, '/')
  setReactInputValue(input, normalized, true)
}

function normalizePastedPath(
  input: HTMLInputElement,
  select: HTMLSelectElement,
  distributions: readonly string[],
): void {
  const value = input.value.trim()
  const existing = parseWslRepositoryPath(value)
  if (existing) {
    const installed = distributions.find(distro => distro.toLowerCase() === existing.distro.toLowerCase())
    const distro = installed ?? existing.distro
    if (installed) select.value = installed
    setReactInputValue(input, toWslUncPath(distro, existing.linuxPath), false)
    return
  }
  if (value.startsWith('/')) {
    const normalized = normalizeWslPathInput(value, select.value)
    if (normalized) setReactInputValue(input, normalized, false)
  }
}

async function decorateDialog(definition: RepositoryDialogDefinition): Promise<void> {
  const dialog = document.querySelector<HTMLElement>(definition.dialog)
  if (!dialog || dialog.querySelector(`.${TOOL_CLASS}`)) return
  const input = dialog.querySelector<HTMLInputElement>(definition.input)
  const pathRow = input?.closest<HTMLElement>('.row-component')
  if (!input || !pathRow) return
  if (decoratingDialogs.has(dialog)) return
  decoratingDialogs.add(dialog)

  try {
    distributionsPromise ??= listWslDistributions()
    const distributions = await distributionsPromise
    if (!dialog.isConnected || distributions.length === 0 || dialog.querySelector(`.${TOOL_CLASS}`)) return

    injectStyles()
    const copy = strings()

    const row = document.createElement('div')
    row.className = TOOL_CLASS
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', copy.distroLabel)

    const badge = document.createElement('span')
    badge.className = 'gdp-wsl-badge'
    badge.textContent = 'WSL'

    const select = document.createElement('select')
    select.className = 'gdp-wsl-select'
    select.setAttribute('aria-label', copy.distroLabel)
    for (const distro of distributions) {
      const option = document.createElement('option')
      option.value = distro
      option.textContent = distro
      select.appendChild(option)
    }

    select.addEventListener('change', () => {
      // If input already has a WSL UNC path, dynamically update it to newly selected distro
      if (input.value.trim().toLowerCase().startsWith('\\\\wsl')) {
        const existing = parseWslRepositoryPath(input.value.trim())
        if (existing) {
          setReactInputValue(input, toWslUncPath(select.value, existing.linuxPath), false)
        }
      }
    })

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'gdp-wsl-btn'
    button.textContent = copy.use
    button.addEventListener('click', () => {
      button.disabled = true
      button.textContent = copy.checking
      button.title = ''
      const dataDir = (window as RepositoryDialogWindow).__GDP_CONFIG__?.dataDir
      void (async () => {
        try {
          if (!dataDir) throw new Error('GDP runtime data directory is unavailable')
          await getWslAgentClient(select.value, dataDir).ensureReady()
          useDistribution(input, select.value)
          button.textContent = copy.use
          button.title = copy.ready
        } catch (error) {
          button.textContent = copy.unavailable
          button.title = error instanceof Error ? error.message : String(error)
        } finally {
          button.disabled = false
        }
      })()
    })

    input.addEventListener('blur', () => normalizePastedPath(input, select, distributions))

    row.append(badge, select, button)
    pathRow.insertAdjacentElement('afterend', row)
  } finally {
    decoratingDialogs.delete(dialog)
  }
}

function decorateAll(): void {
  for (const definition of DIALOGS) void decorateDialog(definition)
}

export function setupWslRepositoryDialogs(): void {
  const gdpWindow = window as RepositoryDialogWindow
  if (process.platform !== 'win32' || gdpWindow.__gdpWslRepositoryDialogsInstalled) return
  gdpWindow.__gdpWslRepositoryDialogsInstalled = true

  const start = () => {
    decorateAll()
    const observer = new MutationObserver(mutations => {
      if (mutationsTouchSelector(mutations, DIALOG_SELECTOR)) decorateAll()
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }
  if (document.documentElement) start()
  else window.addEventListener('DOMContentLoaded', start, { once: true })
}
