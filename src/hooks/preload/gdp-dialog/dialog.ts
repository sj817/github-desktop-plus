import type { StoredConfig, IpcRenderer } from './types'
import { icon, toast } from './components'
import { buildGeneralTab, saveGeneralTab } from './tabs/general'
import { buildAiTab, saveAiTab } from './tabs/ai'
import { buildLogsTab, initLogsTab } from './tabs/logs'
import { buildLocalesTab, initLocalesTab } from './tabs/locales'

const PROJECT_URL = 'https://github.com/sj817/github-desktop-plus'

const TABS = ['general', 'ai', 'locales', 'logs'] as const
type TabId = (typeof TABS)[number]

const TAB_META: Record<TabId, { label: string; iconName: string; subtitle: string }> = {
  general: { label: '常规', iconName: 'general', subtitle: '界面语言、更新与隐私偏好' },
  ai: { label: 'AI 提交', iconName: 'ai', subtitle: '用自定义模型生成提交信息' },
  locales: { label: '语言包', iconName: 'locales', subtitle: '导入、导出与管理翻译' },
  logs: { label: '日志', iconName: 'logs', subtitle: '实时运行诊断输出' },
}

interface DialogState {
  activeTab: TabId
  tabContents: Partial<Record<TabId, HTMLElement>>
  logLineHandler: ((entry: unknown) => void) | null
  ipcLogListener: ((event: unknown, ...args: unknown[]) => void) | null
  ipc: IpcRenderer
  nav: HTMLElement
  content: HTMLElement
  titleEl: HTMLElement
  subtitleEl: HTMLElement
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

  // ── Sidebar ──
  const nav = document.createElement('nav')
  nav.className = 'gdp-nav'
  nav.innerHTML = `
    <div class="gdp-brand">
      <span class="gdp-brand-logo">G+</span>
      <span class="gdp-brand-text">
        <span class="gdp-brand-name">GDP 设置</span>
        <span class="gdp-brand-sub">GitHub Desktop Plus</span>
      </span>
    </div>
  `
  for (const tab of TABS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'gdp-nav-item'
    btn.dataset.tab = tab
    btn.innerHTML = `${icon(TAB_META[tab].iconName, 15)}<span class="gdp-nav-label">${TAB_META[tab].label}</span>`
    nav.appendChild(btn)
  }
  const spacer = document.createElement('div')
  spacer.className = 'gdp-nav-spacer'
  nav.appendChild(spacer)
  const hint = document.createElement('div')
  hint.className = 'gdp-nav-hint'
  hint.innerHTML = `<kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>G</kbd>`
  nav.appendChild(hint)

  // ── Main pane ──
  const main = document.createElement('div')
  main.className = 'gdp-main'

  const mainHeader = document.createElement('div')
  mainHeader.className = 'gdp-main-header'
  mainHeader.innerHTML = `
    <div class="gdp-head-text">
      <h2 class="gdp-main-title"></h2>
      <p class="gdp-main-subtitle"></p>
    </div>
    <button type="button" class="gdp-icon-btn" id="gdp-dialog-close" title="关闭">${icon('x', 16)}</button>
  `

  const content = document.createElement('div')
  content.className = 'gdp-content'

  const footer = document.createElement('div')
  footer.className = 'gdp-footer'
  footer.innerHTML = `
    <a class="gdp-footer-link" id="gdp-dialog-about">${icon('external-link', 13)}关于 GDP</a>
    <button type="button" class="gdp-btn gdp-btn-ghost" id="gdp-dialog-cancel">取消</button>
    <button type="button" class="gdp-btn gdp-btn-primary" id="gdp-dialog-save">保存更改</button>
  `

  const toastRegion = document.createElement('div')
  toastRegion.className = 'gdp-toast-region'

  main.appendChild(mainHeader)
  main.appendChild(content)
  main.appendChild(footer)

  container.appendChild(nav)
  container.appendChild(main)
  container.appendChild(toastRegion)
  dialog.appendChild(container)
  document.body.appendChild(dialog)

  const state: DialogState = {
    activeTab: 'general',
    tabContents: {},
    logLineHandler: null,
    ipcLogListener: null,
    ipc,
    nav,
    content,
    titleEl: mainHeader.querySelector('.gdp-main-title')!,
    subtitleEl: mainHeader.querySelector('.gdp-main-subtitle')!,
  }

  // Nav switching
  nav.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('[data-tab]')
    if (!btn) return
    const tab = btn.dataset.tab as TabId
    if (tab && tab !== state.activeTab) switchTab(tab, state).catch(() => {})
  })

  // Close on backdrop click
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) closeDialog(dialog, state)
  })

  // One cleanup path for every close route (backdrop, Esc, cancel, ×).
  // Dropping cached form tabs makes "取消" actually discard unsaved edits.
  dialog.addEventListener('close', () => cleanup(state))

  // Ctrl+S saves while the dialog is open
  dialog.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault()
      saveAll(state).catch(() => {})
    }
  })

  mainHeader.querySelector<HTMLButtonElement>('#gdp-dialog-close')?.addEventListener('click', () => {
    closeDialog(dialog, state)
  })
  footer.querySelector<HTMLButtonElement>('#gdp-dialog-cancel')?.addEventListener('click', () => {
    closeDialog(dialog, state)
  })

  const saveBtn = footer.querySelector<HTMLButtonElement>('#gdp-dialog-save')
  saveBtn?.addEventListener('click', () => {
    saveAll(state, saveBtn).catch(() => {})
  })

  footer.querySelector<HTMLAnchorElement>('#gdp-dialog-about')?.addEventListener('click', () => {
    try {
      ;(require as NodeRequire)('electron').shell.openExternal(PROJECT_URL).catch(() => {})
    } catch { /* ignore */ }
  })

  return { dialog, state }
}

// Persist every built form tab (general + ai), not just the visible one, so
// edits made before switching tabs are never silently dropped. All settings
// hot-apply; an i18n change additionally soft-reloads the window (main
// process schedules it right after the save).
async function saveAll(state: DialogState, saveBtn?: HTMLButtonElement | null): Promise<void> {
  if (saveBtn) saveBtn.disabled = true
  try {
    const general = state.tabContents.general
    if (general) await saveGeneralTab(general, state.ipc)
    const ai = state.tabContents.ai
    if (ai) await saveAiTab(ai, state.ipc)
    toast('设置已保存')
  } catch (e) {
    toast(`保存失败：${e}`, 'error')
  } finally {
    if (saveBtn) saveBtn.disabled = false
  }
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
      state.tabContents[tab] = buildGeneralTab(cfg, state.ipc)
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
  if (built) {
    built.classList.remove('gdp-tab-in')
    state.content.appendChild(built)
    state.content.scrollTop = 0
    // restart the enter animation
    void built.offsetWidth
    built.classList.add('gdp-tab-in')
  }
}

function cleanup(state: DialogState): void {
  if (state.ipcLogListener) {
    state.ipc.removeListener('gdp:log-line', state.ipcLogListener)
    state.ipcLogListener = null
  }
  state.logLineHandler = null
  // Drop cached tabs: forms rebuild from persisted config on next open.
  state.tabContents = {}
}

export function openDialog(dialog: HTMLDialogElement, state: DialogState, tab: TabId): void {
  if (!state.ipcLogListener) {
    const listener = (_event: unknown, entry: unknown) => {
      if (state.logLineHandler) state.logLineHandler(entry)
    }
    state.ipcLogListener = listener
    state.ipc.on('gdp:log-line', listener)
  }

  switchTab(tab, state).catch(() => {})

  if (!dialog.open) dialog.showModal()
}

export function closeDialog(dialog: HTMLDialogElement, state: DialogState): void {
  if (dialog.open) {
    dialog.close() // 'close' event runs cleanup(state)
  } else {
    cleanup(state)
  }
}
