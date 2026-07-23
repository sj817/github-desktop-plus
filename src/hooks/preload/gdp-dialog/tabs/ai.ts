import type { StoredConfig, IpcRenderer } from '../types'
import { PROMPT_TEMPLATES } from '../templates'

function sw(id: string, on: boolean): string {
  return `<label class="gdp-switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="gdp-slider"></span></label>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function buildAiTab(cfg: StoredConfig): HTMLElement {
  const ai = cfg.ai ?? {}
  const div = document.createElement('div')

  const templateOptions = PROMPT_TEMPLATES.map(
    (t) => `<option value="${escHtml(t.prompt)}">${escHtml(t.name)}</option>`,
  ).join('')

  div.innerHTML = `
    <div class="gdp-card">
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">启用 AI 提交信息</span>
          <span class="gdp-row-desc">接管提交框的 Copilot 按钮，用下面的模型生成提交信息</span>
        </div>
        ${sw('gdp-ai-enabled', !!ai.enabled)}
      </div>
    </div>

    <div class="gdp-card">
      <div class="gdp-card-title">模型接入</div>
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-ai-base-url">Base URL</label>
        <input class="gdp-input" id="gdp-ai-base-url" type="text"
          value="${escHtml(ai.base_url ?? 'https://api.openai.com/v1')}"
          placeholder="https://api.openai.com/v1">
      </div>
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-ai-api-key">API Key</label>
        <input class="gdp-input" id="gdp-ai-api-key" type="password"
          value="${escHtml(ai.api_key ?? '')}" placeholder="sk-…">
      </div>
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-ai-model">模型</label>
        <input class="gdp-input" id="gdp-ai-model" type="text"
          value="${escHtml(ai.model ?? 'gpt-4o-mini')}" placeholder="gpt-4o-mini">
      </div>
    </div>

    <details class="gdp-advanced">
      <summary>高级</summary>
      <div class="gdp-advanced-body">
        <div class="gdp-field">
          <label class="gdp-field-label" for="gdp-ai-template">
            System Prompt <span class="gdp-hint">留空使用内置默认</span>
          </label>
          <div class="gdp-toolbar">
            <select class="gdp-select gdp-grow" id="gdp-ai-template">
              <option value="">— 选择预设模板 —</option>
              ${templateOptions}
            </select>
            <button class="gdp-btn gdp-btn-sm" id="gdp-ai-apply-template">填入</button>
          </div>
          <textarea class="gdp-textarea" id="gdp-ai-system-prompt" rows="4"
            placeholder="留空使用内置默认 prompt">${escHtml(ai.system_prompt ?? '')}</textarea>
        </div>
        <div class="gdp-row">
          <div class="gdp-row-text">
            <span class="gdp-row-label">失败时回退到 Copilot</span>
            <span class="gdp-row-desc">AI 请求失败时改用原生 Copilot 生成</span>
          </div>
          ${sw('gdp-ai-fallback', ai.fallback_to_copilot !== false)}
        </div>
      </div>
    </details>
  `

  const templateSelect = div.querySelector<HTMLSelectElement>('#gdp-ai-template')
  const applyBtn = div.querySelector<HTMLButtonElement>('#gdp-ai-apply-template')
  const promptArea = div.querySelector<HTMLTextAreaElement>('#gdp-ai-system-prompt')
  applyBtn?.addEventListener('click', () => {
    if (templateSelect?.value && promptArea) promptArea.value = templateSelect.value
  })

  return div
}

export async function saveAiTab(container: HTMLElement, ipc: IpcRenderer): Promise<void> {
  const bool = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false
  const str = (id: string) =>
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? ''

  const aiPartial = {
    enabled: bool('gdp-ai-enabled'),
    base_url: str('gdp-ai-base-url'),
    api_key: str('gdp-ai-api-key'),
    model: str('gdp-ai-model'),
    system_prompt: str('gdp-ai-system-prompt'),
    fallback_to_copilot: bool('gdp-ai-fallback'),
  }

  const current = (await ipc.invoke('gdp:get-config')) as StoredConfig
  const merged = { ...current, ai: { ...(current.ai ?? {}), ...aiPartial } }
  await ipc.invoke('gdp:set-config', merged)
}
