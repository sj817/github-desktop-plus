import type { StoredConfig, IpcRenderer } from '../types'

function sw(id: string, on: boolean): string {
  return `<label class="gdp-switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="gdp-slider"></span></label>`
}

export function buildGeneralTab(cfg: StoredConfig): HTMLElement {
  const div = document.createElement('div')
  const limit = cfg.ui?.recent_repos_limit ?? 3
  // One UI switch drives both update-blocking mechanisms (auto + manual check).
  const updatesBlocked = cfg.updates?.disabled !== false || cfg.updates?.block_manual_check !== false
  const i18nOn = cfg.i18n?.enabled !== false
  const telemetryBlocked = cfg.telemetry?.disabled !== false
  const logLevel = cfg.logging?.level ?? ''

  div.innerHTML = `
    <div class="gdp-card">
      <div class="gdp-card-title">界面</div>
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">中文界面</span>
          <span class="gdp-row-desc">将 GitHub Desktop 的界面文本翻译为中文</span>
        </div>
        ${sw('gdp-enable-i18n', i18nOn)}
      </div>
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-recent-repos-limit">
          最近仓库显示数量 <span class="gdp-hint">当前 ${limit}</span>
        </label>
        <div class="gdp-range-row">
          <input type="range" id="gdp-recent-repos-limit" min="1" max="30" value="${limit}">
          <span class="gdp-range-value" id="gdp-recent-repos-limit-display">${limit}</span>
        </div>
      </div>
    </div>

    <div class="gdp-card">
      <div class="gdp-card-title">隐私与更新</div>
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
    </div>

    <details class="gdp-advanced">
      <summary>高级</summary>
      <div class="gdp-advanced-body">
        <div class="gdp-field">
          <label class="gdp-field-label" for="gdp-log-level">日志级别</label>
          <select class="gdp-select" id="gdp-log-level">
            <option value=""      ${!logLevel ? 'selected' : ''}>默认 (warn)</option>
            <option value="debug" ${logLevel === 'debug' ? 'selected' : ''}>debug</option>
            <option value="info"  ${logLevel === 'info' ? 'selected' : ''}>info</option>
            <option value="warn"  ${logLevel === 'warn' ? 'selected' : ''}>warn</option>
            <option value="error" ${logLevel === 'error' ? 'selected' : ''}>error</option>
          </select>
        </div>
      </div>
    </details>
  `

  const range = div.querySelector<HTMLInputElement>('#gdp-recent-repos-limit')
  const display = div.querySelector<HTMLSpanElement>('#gdp-recent-repos-limit-display')
  range?.addEventListener('input', () => {
    if (display) display.textContent = range.value
  })

  return div
}

export async function saveGeneralTab(container: HTMLElement, ipc: IpcRenderer): Promise<void> {
  const bool = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false
  const str = (id: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? ''
  const num = (id: string) =>
    parseInt(container.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '3', 10)

  const updatesBlocked = bool('gdp-block-updates')
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
    logging: { ...(current.logging ?? {}), level: str('gdp-log-level') },
    i18n: { ...(current.i18n ?? {}), enabled: bool('gdp-enable-i18n') },
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
