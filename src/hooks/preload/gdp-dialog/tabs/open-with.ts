import type { StoredConfig, IpcRenderer } from '../types'
import { sw, icon, toast } from '../components'

/**
 * "Open with" tab — manages the launchers GDP injects into GitHub Desktop's
 * repository context menu. GD itself only exposes one editor and one shell;
 * this list can hold as many as the user wants.
 */

interface OpenWithItem {
  id: string
  label: string
  path: string
  args: string
  group: 'editor' | 'shell'
  console: boolean
  enabled: boolean
}

interface DetectedItem {
  id: string
  label: string
  path: string
  args: string
  group: 'editor' | 'shell'
  console: boolean
}

const TARGET_PATH_TOKEN = '%TARGET_PATH%'

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function normalize(raw: unknown, index: number): OpenWithItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const filePath = typeof r.path === 'string' ? r.path : ''
  if (filePath === '') return null
  const group = r.group === 'shell' ? 'shell' : 'editor'
  return {
    id: typeof r.id === 'string' && r.id !== '' ? r.id : `item-${index}`,
    label: typeof r.label === 'string' ? r.label : '',
    path: filePath,
    args: typeof r.args === 'string' ? r.args : '',
    group,
    console: r.console === true,
    enabled: r.enabled !== false,
  }
}

// Panel state lives on the element so `saveOpenWithTab` can read back the
// list the user actually assembled (the dialog rebuilds tabs on each open).
interface PanelState {
  items: OpenWithItem[]
  submenu: boolean
}

type StatefulPanel = HTMLElement & { __gdpOpenWith?: PanelState }

function uniqueId(items: readonly OpenWithItem[], preferred: string): string {
  if (!items.some(item => item.id === preferred)) return preferred
  for (let n = 2; ; n++) {
    const candidate = `${preferred}-${n}`
    if (!items.some(item => item.id === candidate)) return candidate
  }
}

function renderList(state: PanelState, listEl: HTMLElement): void {
  if (state.items.length === 0) {
    listEl.innerHTML =
      '<div class="gdp-empty">还没有条目 — 用下面的「自动检测」找出已安装的编辑器和终端</div>'
    return
  }

  listEl.innerHTML = state.items
    .map(
      (item, index) => `
    <div class="gdp-ow-item" data-index="${index}">
      <div class="gdp-ow-head">
        ${sw(`gdp-ow-enabled-${index}`, item.enabled)}
        <input class="gdp-input gdp-ow-label" type="text" spellcheck="false"
          value="${escHtml(item.label)}" placeholder="显示名称">
        <select class="gdp-select gdp-ow-group">
          <option value="editor" ${item.group === 'editor' ? 'selected' : ''}>编辑器</option>
          <option value="shell" ${item.group === 'shell' ? 'selected' : ''}>终端</option>
        </select>
        <button type="button" class="gdp-icon-btn gdp-ow-up" title="上移"
          ${index === 0 ? 'disabled' : ''}>${icon('chevron', 14)}</button>
        <button type="button" class="gdp-icon-btn gdp-ow-down" title="下移"
          ${index === state.items.length - 1 ? 'disabled' : ''}>${icon('chevron', 14)}</button>
        <button type="button" class="gdp-icon-btn gdp-ow-remove" title="删除">${icon('trash', 14)}</button>
      </div>
      <div class="gdp-ow-body">
        <input class="gdp-input gdp-ow-path" type="text" spellcheck="false"
          value="${escHtml(item.path)}" placeholder="可执行文件完整路径">
        <input class="gdp-input gdp-ow-args" type="text" spellcheck="false"
          value="${escHtml(item.args)}" placeholder="${TARGET_PATH_TOKEN} 会被替换成仓库路径">
        <label class="gdp-ow-check">
          <input type="checkbox" class="gdp-ow-console" ${item.console ? 'checked' : ''}>
          <span>新建终端窗口</span>
        </label>
      </div>
    </div>`,
    )
    .join('')

  // Rotate the chevron so "up" and "down" read as such.
  listEl.querySelectorAll<HTMLElement>('.gdp-ow-up .gdp-icon').forEach(el => {
    el.style.transform = 'rotate(-90deg)'
  })
  listEl.querySelectorAll<HTMLElement>('.gdp-ow-down .gdp-icon').forEach(el => {
    el.style.transform = 'rotate(90deg)'
  })
}

/** Render the not-yet-added candidates and return them in display order. */
function renderDetected(
  detected: readonly DetectedItem[],
  state: PanelState,
  host: HTMLElement,
): DetectedItem[] {
  const fresh = detected.filter(
    candidate => !state.items.some(item => item.path.toLowerCase() === candidate.path.toLowerCase()),
  )

  if (fresh.length === 0) {
    host.innerHTML = '<div class="gdp-empty">没有找到新的程序 — 已安装的都在上面的列表里了</div>'
    return fresh
  }

  host.innerHTML =
    `<div class="gdp-ow-detected-head">找到 ${fresh.length} 个未添加的程序</div>` +
    fresh
      .map(
        (candidate, index) => `
      <div class="gdp-ow-found" data-found="${index}">
        <span class="gdp-ow-found-name">${escHtml(candidate.label)}</span>
        <span class="gdp-chip">${candidate.group === 'shell' ? '终端' : '编辑器'}</span>
        <span class="gdp-ow-found-path" title="${escHtml(candidate.path)}">${escHtml(candidate.path)}</span>
        <button type="button" class="gdp-btn gdp-btn-sm gdp-ow-add">添加</button>
      </div>`,
      )
      .join('')

  return fresh
}

export function buildOpenWithTab(cfg: StoredConfig, ipc: IpcRenderer): HTMLElement {
  const div = document.createElement('div') as StatefulPanel
  div.className = 'gdp-tab-panel'

  const section = (cfg.open_with ?? {}) as Record<string, unknown>
  const rawItems = Array.isArray(section.items) ? (section.items as unknown[]) : []

  const state: PanelState = {
    items: rawItems
      .map((raw, index) => normalize(raw, index))
      .filter((item): item is OpenWithItem => item !== null),
    submenu: section.submenu === true,
  }
  div.__gdpOpenWith = state

  div.innerHTML = `
    <div class="gdp-group-label">显示方式</div>
    <section class="gdp-card">
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">折叠为子菜单</span>
          <span class="gdp-row-desc">条目较多时收进「打开方式 ▸」，而不是平铺在右键菜单里</span>
        </div>
        ${sw('gdp-ow-submenu', state.submenu)}
      </div>
    </section>

    <div class="gdp-group-label">条目 <span class="gdp-hint">按此顺序显示在右键菜单中</span></div>
    <section class="gdp-card" id="gdp-ow-list"></section>

    <div class="gdp-toolbar">
      <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-ow-detect">${icon('search', 13)}自动检测</button>
      <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-ow-browse">${icon('plus', 13)}手动添加</button>
      <span class="gdp-grow"></span>
      <span class="gdp-hint" style="text-transform:none;letter-spacing:0;">
        参数中的 ${TARGET_PATH_TOKEN} 会替换成仓库路径
      </span>
    </div>
    <section class="gdp-card gdp-hide" id="gdp-ow-detected"></section>
  `

  const listEl = div.querySelector<HTMLElement>('#gdp-ow-list')
  const detectedEl = div.querySelector<HTMLElement>('#gdp-ow-detected')

  const rerender = () => {
    if (listEl) renderList(state, listEl)
  }
  rerender()

  // Delegated once — renderList only ever rewrites the rows' markup.
  const itemAt = (ev: Event): { item: OpenWithItem; index: number } | null => {
    const row = (ev.target as Element).closest<HTMLElement>('.gdp-ow-item')
    if (!row) return null
    const index = Number(row.dataset.index)
    const item = state.items[index]
    return item ? { item, index } : null
  }

  listEl?.addEventListener('input', ev => {
    const found = itemAt(ev)
    if (!found) return
    const target = ev.target as HTMLInputElement
    if (target.classList.contains('gdp-ow-label')) found.item.label = target.value
    else if (target.classList.contains('gdp-ow-path')) found.item.path = target.value
    else if (target.classList.contains('gdp-ow-args')) found.item.args = target.value
  })

  listEl?.addEventListener('change', ev => {
    const found = itemAt(ev)
    if (!found) return
    const target = ev.target as HTMLInputElement & HTMLSelectElement
    if (target.classList.contains('gdp-ow-group')) {
      found.item.group = target.value === 'shell' ? 'shell' : 'editor'
    } else if (target.classList.contains('gdp-ow-console')) {
      found.item.console = target.checked
    } else if (target.id === `gdp-ow-enabled-${found.index}`) {
      found.item.enabled = target.checked
    }
  })

  listEl?.addEventListener('click', ev => {
    const found = itemAt(ev)
    if (!found) return
    const button = (ev.target as Element).closest('button')
    if (!button) return
    const { index } = found

    if (button.classList.contains('gdp-ow-remove')) {
      state.items.splice(index, 1)
    } else if (button.classList.contains('gdp-ow-up') && index > 0) {
      ;[state.items[index - 1], state.items[index]] = [state.items[index], state.items[index - 1]]
    } else if (button.classList.contains('gdp-ow-down') && index < state.items.length - 1) {
      ;[state.items[index + 1], state.items[index]] = [state.items[index], state.items[index + 1]]
    } else {
      return
    }
    rerender()
  })

  // Candidates currently rendered in the "detected" card.
  let detectedFresh: DetectedItem[] = []

  detectedEl?.addEventListener('click', ev => {
    const button = (ev.target as Element).closest('.gdp-ow-add')
    if (!button) return
    const row = button.closest<HTMLElement>('.gdp-ow-found')
    if (!row) return
    const candidate = detectedFresh[Number(row.dataset.found)]
    if (!candidate) return

    state.items.push({
      id: uniqueId(state.items, candidate.id),
      label: candidate.label,
      path: candidate.path,
      args: candidate.args,
      group: candidate.group,
      console: candidate.console,
      enabled: true,
    })
    row.remove()
    rerender()
  })

  div.querySelector<HTMLInputElement>('#gdp-ow-submenu')?.addEventListener('change', ev => {
    state.submenu = (ev.target as HTMLInputElement).checked
  })

  const detectBtn = div.querySelector<HTMLButtonElement>('#gdp-ow-detect')
  detectBtn?.addEventListener('click', () => {
    if (!detectedEl) return
    detectBtn.disabled = true
    detectedEl.classList.remove('gdp-hide')
    detectedEl.innerHTML = '<div class="gdp-empty">正在扫描…</div>'
    ipc
      .invoke('gdp:open-with-detect')
      .then(raw => {
        detectedFresh = renderDetected((raw as DetectedItem[]) ?? [], state, detectedEl)
      })
      .catch(e => {
        detectedEl.innerHTML = `<div class="gdp-empty">检测失败：${escHtml(String(e))}</div>`
      })
      .finally(() => {
        detectBtn.disabled = false
      })
  })

  div.querySelector<HTMLButtonElement>('#gdp-ow-browse')?.addEventListener('click', () => {
    ipc
      .invoke('gdp:open-with-browse')
      .then(raw => {
        const result = raw as { ok?: boolean; path?: string; label?: string; reason?: string } | null
        if (result?.ok !== true || !result.path) {
          if (result?.reason && result.reason !== 'canceled') {
            toast(`选择失败：${result.reason}`, 'error')
          }
          return
        }
        state.items.push({
          id: uniqueId(state.items, `custom-${state.items.length + 1}`),
          label: result.label ?? '',
          path: result.path,
          args: `"${TARGET_PATH_TOKEN}"`,
          group: 'editor',
          console: false,
          enabled: true,
        })
        rerender()
      })
      .catch(e => toast(`选择失败：${e}`, 'error'))
  })

  return div
}

export async function saveOpenWithTab(container: HTMLElement, ipc: IpcRenderer): Promise<void> {
  const state = (container as StatefulPanel).__gdpOpenWith
  if (!state) return

  // Entries without an executable would only ever fail at launch time.
  const items = state.items
    .filter(item => item.path.trim() !== '')
    .map(item => ({
      id: item.id,
      label: item.label.trim(),
      path: item.path.trim(),
      args: item.args,
      group: item.group,
      console: item.console,
      enabled: item.enabled,
    }))

  const current = (await ipc.invoke('gdp:get-config')) as StoredConfig
  const openWith: Record<string, unknown> = {
    ...((current.open_with as Record<string, unknown>) ?? {}),
    submenu: state.submenu,
    items,
  }
  // Written by older builds; the native entry is now always replaced.
  delete openWith.replace_native

  await ipc.invoke('gdp:set-config', { ...current, open_with: openWith })
}
