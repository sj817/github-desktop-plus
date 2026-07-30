import type { IpcRenderer } from '../types'
import { icon, toast } from '../components'

export function buildLocalesTab(): HTMLElement {
  const div = document.createElement('div')
  div.className = 'gdp-tab-panel'
  div.innerHTML = `
    <div class="gdp-toolbar">
      <input class="gdp-input gdp-input-inline" id="gdp-new-locale" type="text"
        placeholder="新语言包名，如 en-US" spellcheck="false">
      <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-locale-create">${icon('plus', 12)}新建</button>
      <span class="gdp-grow"></span>
      <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-locale-import">${icon('upload', 12)}导入 JSON</button>
      <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-locale-open-dir" title="在资源管理器中打开语言包目录">${icon('folder', 12)}打开目录</button>
    </div>
    <ul class="gdp-locale-list" id="gdp-locale-list"></ul>
  `
  return div
}

function buildLocaleItem(locale: string, active: boolean): HTMLLIElement {
  const li = document.createElement('li')
  li.className = 'gdp-locale-item'
  li.dataset.locale = locale

  const ico = document.createElement('span')
  ico.className = 'gdp-locale-ico'
  ico.innerHTML = icon('globe', 15)

  const name = document.createElement('span')
  name.className = 'gdp-locale-name'
  name.textContent = locale
  if (active) {
    const chip = document.createElement('span')
    chip.className = 'gdp-chip gdp-chip-accent'
    chip.textContent = '使用中'
    chip.style.marginLeft = '8px'
    name.appendChild(chip)
  }

  const actions = document.createElement('div')
  actions.className = 'gdp-locale-actions'

  const exportBtn = document.createElement('button')
  exportBtn.type = 'button'
  exportBtn.className = 'gdp-btn gdp-btn-sm'
  exportBtn.dataset.action = 'export'
  exportBtn.innerHTML = `${icon('download', 12)}导出`

  const deleteBtn = document.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'gdp-btn gdp-btn-sm gdp-btn-danger'
  deleteBtn.dataset.action = 'delete'
  deleteBtn.innerHTML = `${icon('trash', 12)}删除`

  actions.append(exportBtn, deleteBtn)
  li.append(ico, name, actions)
  return li
}

function showEmpty(listEl: HTMLUListElement): void {
  listEl.innerHTML = ''
  const li = document.createElement('li')
  li.className = 'gdp-empty'
  li.innerHTML = `${icon('locales', 26)}<span>暂无语言包 — 新建或导入一个开始翻译</span>`
  listEl.appendChild(li)
}

export async function initLocalesTab(
  container: HTMLElement,
  ipc: IpcRenderer,
): Promise<void> {
  const listEl = container.querySelector<HTMLUListElement>('#gdp-locale-list')
  if (!listEl) return

  async function refreshList(): Promise<void> {
    if (!listEl) return
    const locales = (await ipc.invoke('gdp:list-locales')) as string[]
    if (locales.length === 0) {
      showEmpty(listEl)
      return
    }
    let activeLocale = ''
    try {
      const cfg = (await ipc.invoke('gdp:get-config')) as { i18n?: { locale?: string } }
      activeLocale = cfg.i18n?.locale ?? 'zh-CN'
    } catch { /* chip is decorative */ }
    listEl.innerHTML = ''
    for (const loc of locales) {
      listEl.appendChild(buildLocaleItem(loc, loc === activeLocale))
    }
  }

  await refreshList()

  // Create new locale
  const nameInput = container.querySelector<HTMLInputElement>('#gdp-new-locale')
  const create = async () => {
    const name = nameInput?.value.trim()
    if (!name) return
    try {
      await ipc.invoke('gdp:create-locale', name)
      if (nameInput) nameInput.value = ''
      await refreshList()
      toast(`已创建语言包 ${name}`)
    } catch (e) {
      toast(`创建失败：${e}`, 'error')
    }
  }
  container.querySelector<HTMLButtonElement>('#gdp-locale-create')?.addEventListener('click', () => {
    create().catch(() => {})
  })
  nameInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      create().catch(() => {})
    }
  })

  // List actions (export / two-step delete)
  listEl.addEventListener('click', async (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('[data-action]')
    if (!btn) return
    const locale = btn.closest<HTMLElement>('[data-locale]')?.dataset.locale ?? ''
    if (!locale) return

    if (btn.dataset.action === 'delete') {
      // First click arms the button; second click within 3s confirms.
      if (!btn.classList.contains('confirm')) {
        btn.classList.add('confirm')
        btn.innerHTML = '确认删除？'
        setTimeout(() => {
          if (btn.isConnected) {
            btn.classList.remove('confirm')
            btn.innerHTML = `${icon('trash', 12)}删除`
          }
        }, 3000)
        return
      }
      try {
        await ipc.invoke('gdp:delete-locale', locale)
        await refreshList()
        toast(`已删除语言包 ${locale}`)
      } catch (e) {
        toast(`删除失败：${e}`, 'error')
      }
    }

    if (btn.dataset.action === 'export') {
      // Written by the main process — renderer blob downloads are silently
      // swallowed by GHD's session, so this is the only path that works.
      const result = (await ipc.invoke('gdp:export-locale-file', locale)) as {
        ok: boolean; path?: string; reason?: string
      }
      if (!result.ok) {
        toast(`导出失败：${result.reason ?? '未知错误'}`, 'error')
        return
      }
      toast(`已导出到 ${result.path ?? '下载目录'}`)
    }
  })

  // Open the locales directory in the system file manager
  container.querySelector<HTMLButtonElement>('#gdp-locale-open-dir')?.addEventListener('click', () => {
    ipc.invoke('gdp:open-locales-dir').catch(() => {})
  })

  // Import locale from a JSON file
  container.querySelector<HTMLButtonElement>('#gdp-locale-import')?.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const localeName = file.name.replace(/\.json$/i, '')
      try {
        const data = JSON.parse(text) as unknown
        const result = (await ipc.invoke('gdp:import-locale', localeName, data)) as {
          ok: boolean; reason?: string
        }
        if (!result.ok) {
          toast(`导入失败：${result.reason ?? '未知错误'}`, 'error')
          return
        }
        await refreshList()
        toast(`已导入语言包 ${localeName}`)
      } catch (e) {
        toast(`JSON 解析失败：${e}`, 'error')
      }
    }
    input.click()
  })
}
