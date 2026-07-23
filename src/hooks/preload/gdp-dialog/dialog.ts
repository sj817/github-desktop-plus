import type { StoredConfig, IpcRenderer } from './types'
import { buildGeneralTab, saveGeneralTab } from './tabs/general'
import { buildAiTab, saveAiTab } from './tabs/ai'
import { buildLogsTab, initLogsTab } from './tabs/logs'
import { buildLocalesTab, initLocalesTab } from './tabs/locales'

const TABS = ['general', 'ai', 'locales', 'logs'] as const
type TabId = (typeof TABS)[number]

const TAB_META: Record<TabId, { label: string; icon: string; subtitle: string }> = {
  general: { label: '常规', icon: '⚙️', subtitle: '界面语言、最近仓库与隐私' },
  ai: { label: 'AI 提交', icon: '✨', subtitle: '用自定义模型生成提交信息' },
  locales: { label: '语言包', icon: '🌐', subtitle: '导入、导出与管理翻译' },
  logs: { label: '日志', icon: '📋', subtitle: '运行时诊断输出' },
}

interface DialogState {
  activeTab: TabId
  tabContents: Partial<Record<TabId, HTMLElement>>
  logLineHandler: ((entry: unknown) => void) | null
  ipc: IpcRenderer
  nav: HTMLElement
  content: HTMLElement
  titleEl: HTMLElement
  subtitleEl: HTMLElement
  savedHint: HTMLElement
}

function getIpc(): IpcRenderer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require as NodeRequire)('electron').ipcRenderer as IpcRenderer
}

export function buildDialog(): { dialog: HTMLDialogElement; state: DialogState } {
  const ipc = getIpc()

  const dialog = document.createElement('dialog')
  dialog.id = 'gdp-settings-dialog'

  const container = document.createElement('div')
  container.className = 'gdp-dialog-container'

  // ── Sidebar nav ──
  const nav = document.createElement('nav')
  nav.className = 'gdp-nav'
  nav.innerHTML = `<div class="gdp-nav-brand"><span class="gdp-nav-logo">G</span>GDP 设置</div>`
  for (const tab of TABS) {
    const btn = document.createElement('button')
    btn.className = 'gdp-nav-item'
    btn.dataset.tab = tab
    btn.innerHTML = `<span class="gdp-nav-icon">${TAB_META[tab].icon}</span>${TAB_META[tab].label}`
    nav.appendChild(btn)
  }

  // ── Main pane ──
  const main = document.createElement('div')
  main.className = 'gdp-main'

  const mainHeader = document.createElement('div')
  mainHeader.className = 'gdp-main-header'
  mainHeader.innerHTML = `
    <h2 class="gdp-main-title"></h2>
    <p class="gdp-main-subtitle"></p>
  `

  const content = document.createElement('div')
  content.className = 'gdp-content'

  const footer = document.createElement('div')
  footer.className = 'gdp-footer'
  footer.innerHTML = `
    <span class="gdp-saved-hint">已保存 ✓</span>
    <button class="gdp-btn" id="gdp-dialog-cancel">取消</button>
    <button class="gdp-btn gdp-btn-primary" id="gdp-dialog-save">保存</button>
  `

  main.appendChild(mainHeader)
  main.appendChild(content)
  main.appendChild(footer)

  container.appendChild(nav)
  container.appendChild(main)
  dialog.appendChild(container)
  document.body.appendChild(dialog)

  const state: DialogState = {
    activeTab: 'general',
    tabContents: {},
    logLineHandler: null,
    ipc,
    nav,
    content,
    titleEl: mainHeader.querySelector('.gdp-main-title')!,
    subtitleEl: mainHeader.querySelector('.gdp-main-subtitle')!,
    savedHint: footer.querySelector('.gdp-saved-hint')!,
  }

  // Nav switching
  nav.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('[data-tab]')
    if (!btn) return
    const tab = btn.dataset.tab as TabId
    if (tab) switchTab(tab, state)
  })

  // Close on backdrop click
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) closeDialog(dialog, state)
  })

  footer.querySelector<HTMLButtonElement>('#gdp-dialog-cancel')?.addEventListener('click', () => {
    closeDialog(dialog, state)
  })

  footer.querySelector<HTMLButtonElement>('#gdp-dialog-save')?.addEventListener('click', async () => {
    await saveCurrentTab(state)
    flashSaved(state)
  })

  return { dialog, state }
}

function flashSaved(state: DialogState): void {
  state.savedHint.classList.add('show')
  setTimeout(() => state.savedHint.classList.remove('show'), 1600)
}

async function switchTab(tab: TabId, state: DialogState): Promise<void> {
  state.activeTab = tab

  state.nav.querySelectorAll<HTMLButtonElement>('.gdp-nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  state.titleEl.textContent = TAB_META[tab].label
  state.subtitleEl.textContent = TAB_META[tab].subtitle

  if (!state.tabContents[tab]) {
    const cfg = (await state.ipc.invoke('gdp:get-config')) as StoredConfig

    if (tab === 'general') {
      state.tabContents[tab] = buildGeneralTab(cfg)
    } else if (tab === 'ai') {
      state.tabContents[tab] = buildAiTab(cfg)
    } else if (tab === 'logs') {
      const logsEl = buildLogsTab()
      state.tabContents[tab] = logsEl
      setTimeout(() => {
        initLogsTab(
          logsEl,
          state.ipc,
          (handler) => {
            state.logLineHandler = handler as (entry: unknown) => void
          },
          () => {
            state.ipc.invoke('gdp:open-log-file').catch(() => {})
          },
        ).catch(() => {})
      }, 0)
    } else if (tab === 'locales') {
      const localesEl = buildLocalesTab()
      state.tabContents[tab] = localesEl
      setTimeout(() => {
        initLocalesTab(localesEl, state.ipc).catch(() => {})
      }, 0)
    }
  }

  state.content.innerHTML = ''
  const built = state.tabContents[tab]
  if (built) state.content.appendChild(built)
}

async function saveCurrentTab(state: DialogState): Promise<void> {
  const { activeTab, tabContents, ipc } = state
  const container = tabContents[activeTab]
  if (!container) return

  if (activeTab === 'general') {
    await saveGeneralTab(container, ipc)
  } else if (activeTab === 'ai') {
    await saveAiTab(container, ipc)
  }
  // logs and locales act immediately; no batch save.
}

export function openDialog(dialog: HTMLDialogElement, state: DialogState, tab: TabId): void {
  const logHandler = (_event: unknown, entry: unknown) => {
    if (state.logLineHandler) state.logLineHandler(entry)
  }
  state.ipc.on('gdp:log-line', logHandler)
  ;(dialog as unknown as { _gdpLogHandler: typeof logHandler })._gdpLogHandler = logHandler

  switchTab(tab, state).catch(() => {})

  if (!dialog.open) dialog.showModal()
}

export function closeDialog(dialog: HTMLDialogElement, state: DialogState): void {
  const logHandler = (dialog as unknown as { _gdpLogHandler?: (e: unknown, entry: unknown) => void })._gdpLogHandler
  if (logHandler) {
    state.ipc.removeListener('gdp:log-line', logHandler)
    delete (dialog as unknown as { _gdpLogHandler?: unknown })._gdpLogHandler
  }
  if (dialog.open) dialog.close()
}
