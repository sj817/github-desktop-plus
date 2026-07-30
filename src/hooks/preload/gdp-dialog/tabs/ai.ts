import type { StoredConfig, IpcRenderer } from '../types'
import { PROMPT_TEMPLATES } from '../templates'
import { sw, icon } from '../components'

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const MODEL_SUGGESTIONS = [
  'gpt-4o-mini', 'gpt-4o', 'o4-mini',
  'deepseek-chat', 'deepseek-reasoner',
  'qwen-plus', 'glm-4.5', 'moonshot-v1-8k',
]

export function buildAiTab(cfg: StoredConfig): HTMLElement {
  const ai = cfg.ai ?? {}
  const div = document.createElement('div')
  div.className = 'gdp-tab-panel'

  const templateOptions = PROMPT_TEMPLATES.map(
    (t) => `<option value="${escHtml(t.prompt)}">${escHtml(t.name)}</option>`,
  ).join('')

  const modelOptions = MODEL_SUGGESTIONS.map((m) => `<option value="${m}"></option>`).join('')

  div.innerHTML = `
    <div class="gdp-group-label">AI 提交</div>
    <section class="gdp-card">
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">启用 AI 提交信息</span>
          <span class="gdp-row-desc">接管提交框的 Copilot 按钮，改用下方配置的模型生成提交信息</span>
        </div>
        ${sw('gdp-ai-enabled', !!ai.enabled)}
      </div>
    </section>

    <div class="gdp-group-label">模型接入 <span class="gdp-hint" style="text-transform:none;letter-spacing:0;">任意 OpenAI 兼容接口</span></div>
    <section class="gdp-card">
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-ai-base-url">Base URL</label>
        <input class="gdp-input" id="gdp-ai-base-url" type="text" spellcheck="false"
          value="${escHtml(ai.base_url ?? 'https://api.openai.com/v1')}"
          placeholder="https://api.openai.com/v1">
      </div>
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-ai-api-key">API Key</label>
        <div class="gdp-input-wrap">
          <input class="gdp-input" id="gdp-ai-api-key" type="password" spellcheck="false"
            value="${escHtml(ai.api_key ?? '')}" placeholder="sk-…" autocomplete="off">
          <button type="button" class="gdp-input-trail" id="gdp-ai-key-toggle" title="显示 / 隐藏">
            ${icon('eye', 14)}
          </button>
        </div>
      </div>
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-ai-model">模型</label>
        <input class="gdp-input" id="gdp-ai-model" type="text" spellcheck="false" list="gdp-ai-model-list"
          value="${escHtml(ai.model ?? 'gpt-4o-mini')}" placeholder="gpt-4o-mini">
        <datalist id="gdp-ai-model-list">${modelOptions}</datalist>
      </div>
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">连通性</span>
          <span class="gdp-row-desc" id="gdp-ai-test-result">用当前填写的参数实际调用一次接口</span>
        </div>
        <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-ai-test">测试连接</button>
      </div>
    </section>

    <div class="gdp-group-label">高级</div>
    <section class="gdp-card">
      <div class="gdp-field">
        <label class="gdp-field-label" for="gdp-ai-system-prompt">
          System Prompt <span class="gdp-hint">留空使用内置默认</span>
        </label>
        <div class="gdp-toolbar" style="margin: 0 0 8px;">
          <select class="gdp-select gdp-grow" id="gdp-ai-template">
            <option value="">— 选择预设模板 —</option>
            ${templateOptions}
          </select>
          <button type="button" class="gdp-btn gdp-btn-sm" id="gdp-ai-apply-template">填入</button>
        </div>
        <textarea class="gdp-textarea" id="gdp-ai-system-prompt" rows="4"
          placeholder="留空使用内置默认 prompt">${escHtml(ai.system_prompt ?? '')}</textarea>
      </div>
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">请求超时</span>
          <span class="gdp-row-desc">单次生成请求的最长等待秒数</span>
        </div>
        <input class="gdp-input gdp-input-sm" id="gdp-ai-timeout" type="number" min="1" max="600"
          value="${Number(ai.timeout_secs) > 0 ? Number(ai.timeout_secs) : 30}">
      </div>
      <div class="gdp-row">
        <div class="gdp-row-text">
          <span class="gdp-row-label">失败时回退到 Copilot</span>
          <span class="gdp-row-desc">AI 请求失败时改用原生 Copilot 生成</span>
        </div>
        ${sw('gdp-ai-fallback', ai.fallback_to_copilot !== false)}
      </div>
    </section>
  `

  // API key visibility toggle
  const keyInput = div.querySelector<HTMLInputElement>('#gdp-ai-api-key')
  const keyToggle = div.querySelector<HTMLButtonElement>('#gdp-ai-key-toggle')
  keyToggle?.addEventListener('click', () => {
    if (!keyInput) return
    const show = keyInput.type === 'password'
    keyInput.type = show ? 'text' : 'password'
    keyToggle.innerHTML = icon(show ? 'eye-off' : 'eye', 14)
  })

  // Connectivity test — uses the CURRENT form values, not the saved config.
  const testBtn = div.querySelector<HTMLButtonElement>('#gdp-ai-test')
  const testResult = div.querySelector<HTMLElement>('#gdp-ai-test-result')
  testBtn?.addEventListener('click', async () => {
    if (!testResult) return
    testBtn.disabled = true
    testResult.style.color = ''
    testResult.textContent = '测试中…'
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ipc = (require as NodeRequire)('electron').ipcRenderer as {
        invoke(ch: string, ...a: unknown[]): Promise<unknown>
      }
      const val = (id: string) => div.querySelector<HTMLInputElement>(`#${id}`)?.value.trim() ?? ''
      const result = (await ipc.invoke('gdp:ai-test', {
        base_url: val('gdp-ai-base-url'),
        api_key: val('gdp-ai-api-key'),
        model: val('gdp-ai-model'),
        timeout_secs: parseInt(val('gdp-ai-timeout'), 10) || 15,
      })) as { ok: boolean; latency_ms?: number; reply?: string; reason?: string }
      if (result.ok) {
        testResult.style.color = 'var(--gdp-ok)'
        testResult.textContent = `✓ 连接正常 · ${result.latency_ms}ms · 模型响应：${result.reply || '(空)'}`
      } else {
        testResult.style.color = 'var(--gdp-danger)'
        testResult.textContent = `✗ ${result.reason ?? '未知错误'}`
      }
    } catch (e) {
      testResult.style.color = 'var(--gdp-danger)'
      testResult.textContent = `✗ ${e}`
    } finally {
      testBtn.disabled = false
    }
  })

  // Prompt template picker
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

  const current = (await ipc.invoke('gdp:get-config')) as StoredConfig

  const timeout = parseInt(str('gdp-ai-timeout'), 10)
  const aiPartial: NonNullable<StoredConfig['ai']> = {
    enabled: bool('gdp-ai-enabled'),
    base_url: str('gdp-ai-base-url').trim(),
    api_key: str('gdp-ai-api-key').trim(),
    model: str('gdp-ai-model').trim(),
    system_prompt: str('gdp-ai-system-prompt'),
    fallback_to_copilot: bool('gdp-ai-fallback'),
  }
  if (Number.isFinite(timeout) && timeout > 0) {
    aiPartial.timeout_secs = timeout
  }

  const merged = { ...current, ai: { ...(current.ai ?? {}), ...aiPartial } }
  await ipc.invoke('gdp:set-config', merged)
}
