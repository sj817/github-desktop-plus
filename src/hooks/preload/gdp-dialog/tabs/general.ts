import type { StoredConfig, IpcRenderer } from '../types'
import { sw } from '../components'

const LOG_LEVELS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '默认' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
]

export function buildGeneralTab(cfg: StoredConfig, ipc: IpcRenderer): HTMLElement {
  const div = document.createElement('div')
  div.className = 'gdp-tab-panel'

  const limit = cfg.ui?.recent_repos_limit ?? 3
  // One UI switch drives both update-blocking mechanisms (auto + manual check).
  const updatesBlocked = cfg.updates?.disabled !== false || cfg.updates?.block_manual_check !== false
  const i18nOn = cfg.i18n?.enabled !== false
  const currentLocale = cfg.i18n?.locale ?? 'zh-CN'
  const telemetryBlocked = cfg.telemetry?.disabled !== false
  const logLevel = cfg.logging?.level ?? ''

  const levelButtons = LOG_LEVELS.map(
    (l) =>
      `<button type="button" data-value="${l.value}" class="${l.value === logLevel ? 'active' : ''}">${l.label}</button>`,
  ).join('')

  div.innerHTML = `
    <div class="gdp-group-label">界面</div>
    <section class="gdp-card">
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">界面翻译</span>
          <span class="gdp-row-desc">用下方选中的语言包翻译界面文本，保存后界面自动刷新</span>
        </div>
        ${sw('gdp-enable-i18n', i18nOn)}
      </div>
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">语言包</span>
          <span class="gdp-row-desc">从「语言包」页导入或新建后可在此切换</span>
        </div>
        <select class="gdp-select" id="gdp-i18n-locale" style="width: 170px; flex: none;">
          <option value="${currentLocale}" selected>${currentLocale}</option>
        </select>
      </div>
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-recent-repos-limit">
          最近仓库显示数量 <span class="gdp-hint">导航栏下拉列表中的条数</span>
        </label>
        <div class="gdp-range-row">
          <input type="range" id="gdp-recent-repos-limit" min="1" max="30" value="${limit}">
          <span class="gdp-range-value" id="gdp-recent-repos-limit-display">${limit}</span>
        </div>
      </div>
    </section>

    <div class="gdp-group-label">隐私与更新</div>
    <section class="gdp-card">
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">禁用更新</span>
          <span class="gdp-row-desc">阻止自动更新和手动检查更新，保持当前打了补丁的版本</span>
        </div>
        ${sw('gdp-block-updates', updatesBlocked)}
      </div>
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">拦截遥测</span>
          <span class="gdp-row-desc">不向 GitHub 上报使用数据与统计信息</span>
        </div>
        ${sw('gdp-block-telemetry', telemetryBlocked)}
      </div>
    </section>

    <div class="gdp-group-label">高级</div>
    <section class="gdp-card">
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">日志级别</span>
          <span class="gdp-row-desc">默认等同于 warn，仅记录警告与错误</span>
        </div>
        <div class="gdp-seg" id="gdp-log-level-seg">${levelButtons}</div>
      </div>
    </section>
  `

  // Range slider: live value badge + gradient fill position
  const range = div.querySelector<HTMLInputElement>('#gdp-recent-repos-limit')
  const display = div.querySelector<HTMLSpanElement>('#gdp-recent-repos-limit-display')
  const syncRange = () => {
    if (!range) return
    if (display) display.textContent = range.value
    const min = Number(range.min), max = Number(range.max), val = Number(range.value)
    range.style.setProperty('--gdp-fill', `${((val - min) / (max - min)) * 100}%`)
  }
  range?.addEventListener('input', syncRange)
  syncRange()

  // Segmented control: single-select
  const seg = div.querySelector<HTMLElement>('#gdp-log-level-seg')
  seg?.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLButtonElement>('button[data-value]')
    if (!btn) return
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn))
  })

  // Populate the locale picker from the installed language packs.
  const localeSelect = div.querySelector<HTMLSelectElement>('#gdp-i18n-locale')
  ipc.invoke('gdp:list-locales')
    .then((raw) => {
      const locales = raw as string[]
      if (!localeSelect || locales.length === 0) return
      const values = locales.includes(currentLocale) ? locales : [currentLocale, ...locales]
      localeSelect.innerHTML = values
        .map((l) => `<option value="${l}" ${l === currentLocale ? 'selected' : ''}>${l}</option>`)
        .join('')
    })
    .catch(() => { /* keep the current-value-only fallback */ })

  return div
}

export async function saveGeneralTab(container: HTMLElement, ipc: IpcRenderer): Promise<void> {
  const bool = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false
  const num = (id: string) =>
    parseInt(container.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '3', 10)

  const updatesBlocked = bool('gdp-block-updates')
  const logLevel =
    container.querySelector<HTMLButtonElement>('#gdp-log-level-seg button.active')?.dataset.value ?? ''
  const current = (await ipc.invoke('gdp:get-config')) as StoredConfig

  // Write the NESTED shape the Rust launcher + hook actually read.
  const merged: StoredConfig = {
    ...current,
    updates: {
      ...(current.updates ?? {}),
      // Single UI switch fans out to both granular schema fields.
      disabled: updatesBlocked,
      block_manual_check: updatesBlocked,
    },
    telemetry: { ...(current.telemetry ?? {}), disabled: bool('gdp-block-telemetry') },
    logging: { ...(current.logging ?? {}), level: logLevel },
    i18n: {
      ...(current.i18n ?? {}),
      enabled: bool('gdp-enable-i18n'),
      locale:
        container.querySelector<HTMLSelectElement>('#gdp-i18n-locale')?.value ||
        current.i18n?.locale || 'zh-CN',
    },
    ui: { ...(current.ui ?? {}), recent_repos_limit: num('gdp-recent-repos-limit') },
  }

  // Drop stale flat keys written by older builds so config.json stays clean.
  for (const k of [
    'block_updates', 'block_manual_update_check', 'block_telemetry',
    'log_level', 'enable_i18n', 'locale', 'recent_repos_limit',
  ]) {
    delete (merged as Record<string, unknown>)[k]
  }

  await ipc.invoke('gdp:set-config', merged)
}
