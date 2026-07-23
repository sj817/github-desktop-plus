import type { IpcRenderer } from '../types'

export function buildLocalesTab(): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <p class="gdp-section-heading" style="margin:0">语言包管理</p>
      <div style="display:flex;gap:6px">
        <input class="gdp-input" id="gdp-new-locale" type="text" placeholder="新语言包名 (e.g. en-US)"
          style="width:160px">
        <button class="gdp-btn gdp-btn-sm" id="gdp-locale-create">新建</button>
      </div>
    </div>
    <ul class="gdp-locale-list" id="gdp-locale-list">
      <li style="padding:12px;font-size:12px;color:var(--text-secondary-color,#57606a)">加载中…</li>
    </ul>
    <div style="display:flex;gap:6px">
      <button class="gdp-btn gdp-btn-sm" id="gdp-locale-import">导入 JSON</button>
    </div>
  `
  return div
}

export async function initLocalesTab(
  container: HTMLElement,
  ipc: IpcRenderer,
): Promise<void> {
  const listEl = container.querySelector<HTMLUListElement>('#gdp-locale-list')

  async function refreshList(): Promise<void> {
    if (!listEl) return
    const locales = await ipc.invoke('gdp:list-locales') as string[]
    if (locales.length === 0) {
      listEl.innerHTML = `<li style="padding:12px;font-size:12px;color:var(--text-secondary-color,#57606a)">暂无语言包</li>`
      return
    }
    listEl.innerHTML = locales.map(loc => `
      <li class="gdp-locale-item" data-locale="${loc}">
        <span style="font-weight:500">${loc}</span>
        <div class="gdp-locale-item-actions">
          <button class="gdp-btn-sm" data-action="export" data-locale="${loc}">导出</button>
          <button class="gdp-btn-sm gdp-btn-danger" data-action="delete" data-locale="${loc}">删除</button>
        </div>
      </li>
    `).join('')
  }

  await refreshList()

  // Create new locale
  container.querySelector<HTMLButtonElement>('#gdp-locale-create')?.addEventListener('click', async () => {
    const nameInput = container.querySelector<HTMLInputElement>('#gdp-new-locale')
    const name = nameInput?.value.trim()
    if (!name) return
    await ipc.invoke('gdp:create-locale', name)
    if (nameInput) nameInput.value = ''
    await refreshList()
  })

  // List actions (delete / export)
  listEl?.addEventListener('click', async (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const locale = btn.dataset.locale ?? ''

    if (action === 'delete') {
      if (!confirm(`确认删除语言包 "${locale}"？`)) return
      await ipc.invoke('gdp:delete-locale', locale)
      await refreshList()
    }

    if (action === 'export') {
      const result = await ipc.invoke('gdp:export-locale', locale) as { ok: boolean; data?: unknown; reason?: string }
      if (!result.ok) { alert(`导出失败：${result.reason ?? ''}`); return }
      const json = JSON.stringify(result.data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${locale}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  })

  // Import locale
  container.querySelector<HTMLButtonElement>('#gdp-locale-import')?.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const localeName = file.name.replace('.json', '')
      try {
        const data = JSON.parse(text) as unknown
        const result = await ipc.invoke('gdp:import-locale', localeName, data) as { ok: boolean; reason?: string }
        if (!result.ok) { alert(`导入失败：${result.reason ?? ''}`); return }
        await refreshList()
      } catch (e) {
        alert(`JSON 解析失败：${e}`)
      }
    }
    input.click()
  })
}
