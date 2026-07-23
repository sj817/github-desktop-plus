/**
 * Copilot Hijack — runs inside GitHub Desktop's renderer process.
 * Intercepts the "Generate commit message with Copilot" button and redirects
 * to a user-configured OpenAI-compatible endpoint via IPC.
 *
 * Controlled by window.__GDP_CONFIG__.ai.enabled (boolean).
 * When false, the button is shown but original Copilot handler runs.
 */
import { getSelectedRepositoryPath } from './lib/gd-db'
;(function () {
  type GdpConfig = {
    ai?: {
      enabled?: boolean
      fallbackToCopilot?: boolean
    }
  }

  function getConfig(): GdpConfig {
    return ((window as unknown as Record<string, unknown>).__GDP_CONFIG__ as GdpConfig) ?? {}
  }

  // Selectors to locate the Copilot button across GHD versions
  const COPILOT_SELECTORS = [
    'button[aria-label*="Copilot"]',
    'button[title*="Copilot"]',
    'button[aria-label*="使用 Copilot"]',
    'button[title*="使用 Copilot"]',
    'button[aria-label*="Generate commit message"]',
  ]

  const GDP_AI_BUTTON_ID = 'gdp-ai-button'
  const NATIVE_MARKER = 'gdpNativeCopilot' // dataset key on the hijacked native button

  // Finds GHD's OWN copilot button (never our injected one).  GHD only
  // renders it when the signed-in account has the
  // desktop_copilot_generate_commit_message feature AND Copilot desktop is
  // enabled — for everyone else renderCopilotButton() returns null and we
  // must inject our own button instead (see ensureInjectedButton).
  function findCopilotButton(): HTMLButtonElement | null {
    // Once hijacked we relabel the native button (aria-label → GDP text), so it
    // no longer matches the label selectors. Match our stable marker first,
    // otherwise ensureInjectedButton would think the native button is gone and
    // inject a duplicate.
    const marked = document.querySelector<HTMLButtonElement>(`button[data-gdp-native-copilot="1"]`)
    if (marked) return marked

    for (const sel of COPILOT_SELECTORS) {
      const el = document.querySelector<HTMLButtonElement>(sel)
      if (el && el.id !== GDP_AI_BUTTON_ID) return el
    }
    // Fallback: find button containing an octicon-copilot SVG
    const allButtons = document.querySelectorAll<HTMLButtonElement>('button')
    for (const btn of allButtons) {
      if (btn.id === GDP_AI_BUTTON_ID) continue
      if (btn.querySelector('.octicon-copilot, [class*="copilot"]')) return btn
    }
    return null
  }

  // React controlled input trick — triggers onChange without React losing control
  function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  // GD renders the summary via AutocompletingInput: the `summary-field` class
  // lands on the WRAPPER div, the real <input> inside only has role="combobox"
  // and a generated id. The description <textarea> has a stable id
  // (inputId="commit-message-description"). See GD commit-message.tsx /
  // autocompleting-text-input.tsx.
  function findCommitSummaryInput(): HTMLInputElement | null {
    return (
      document.querySelector<HTMLInputElement>('.summary-field input') ??
      document.querySelector<HTMLInputElement>('input[role="combobox"]') ??
      document.querySelector<HTMLInputElement>('input[placeholder*="Summary"]') ??
      document.querySelector<HTMLInputElement>('input[placeholder*="摘要"]') ??
      null
    )
  }

  function findCommitDescriptionInput(): HTMLTextAreaElement | null {
    return (
      document.querySelector<HTMLTextAreaElement>('textarea#commit-message-description') ??
      document.querySelector<HTMLTextAreaElement>('.description-field textarea') ??
      document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Description"]') ??
      document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="描述"]') ??
      null
    )
  }

  // Forward diagnostics to the main-process hook log (renderer console isn't
  // visible in the log file). Best-effort.
  function rlog(msg: string): void {
    try {
      const ipc = (require as NodeRequire)('electron').ipcRenderer as {
        invoke(channel: string, ...args: unknown[]): Promise<unknown>
      }
      ipc.invoke('gdp:log', `[copilot] ${msg}`).catch(() => {})
    } catch { /* ignore */ }
  }

  function ensureStyles(): void {
    if (document.getElementById('gdp-ai-style')) return
    const s = document.createElement('style')
    s.id = 'gdp-ai-style'
    s.textContent =
      `@keyframes gdp-spin{to{transform:rotate(360deg)}}` +
      `.gdp-spin{display:inline-block;width:13px;height:13px;border:2px solid currentColor;` +
      `border-right-color:transparent;border-radius:50%;animation:gdp-spin .7s linear infinite;vertical-align:-2px;margin-right:7px}`
    document.head.appendChild(s)
  }

  function findCommitButton(): HTMLButtonElement | null {
    return (
      document.querySelector<HTMLButtonElement>('.commit-message-component .commit-button') ??
      document.querySelector<HTMLButtonElement>('button.commit-button')
    )
  }

  // IMPORTANT: never mutate React-controlled DOM (the commit button's children,
  // or appending into .commit-message-component). React reconciliation would
  // then crash with "insertBefore … not a child". Instead we render our own
  // body-level overlays positioned over the commit button — React never sees them.
  function positionOver(el: HTMLElement, target: Element | null): void {
    if (!target) { el.style.display = 'none'; return }
    const r = target.getBoundingClientRect()
    el.style.display = 'flex'
    el.style.left = `${r.left}px`
    el.style.top = `${r.top}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
  }

  let genOverlay: HTMLElement | null = null
  let genReposition: ReturnType<typeof setInterval> | null = null
  function setCommitGenerating(on: boolean): void {
    if (on) {
      ensureStyles()
      if (!genOverlay) {
        genOverlay = document.createElement('div')
        genOverlay.id = 'gdp-ai-overlay'
        genOverlay.innerHTML = `<span class="gdp-spin"></span>正在生成提交信息…`
        Object.assign(genOverlay.style, {
          position: 'fixed', zIndex: '99998', boxSizing: 'border-box',
          alignItems: 'center', justifyContent: 'center', gap: '0',
          padding: '0 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
          background: 'var(--button-background, #2da44e)', color: 'var(--button-text-color, #fff)',
          cursor: 'default', userSelect: 'none', overflow: 'hidden', whiteSpace: 'nowrap',
        })
        document.body.appendChild(genOverlay)
      }
      positionOver(genOverlay, findCommitButton())
      // Keep it aligned if the layout shifts during generation.
      if (!genReposition) {
        genReposition = setInterval(() => {
          if (genOverlay) positionOver(genOverlay, findCommitButton())
        }, 250)
      }
    } else {
      if (genReposition) { clearInterval(genReposition); genReposition = null }
      genOverlay?.remove()
      genOverlay = null
    }
  }

  // Error pill floated just above the commit button (body-level, React-safe).
  function showError(msg: string): void {
    ensureStyles()
    document.getElementById('gdp-ai-error')?.remove()
    const el = document.createElement('div')
    el.id = 'gdp-ai-error'
    el.textContent = msg
    Object.assign(el.style, {
      position: 'fixed', zIndex: '99999', maxWidth: '340px',
      padding: '8px 12px', borderRadius: '6px', fontSize: '12px', lineHeight: '1.4',
      background: 'var(--background-color, #1c2128)', color: '#cf222e',
      border: '1px solid #cf222e', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      cursor: 'pointer',
    })
    el.title = '点击关闭'
    el.addEventListener('click', () => el.remove())
    document.body.appendChild(el)
    const cb = findCommitButton()
    const r = cb?.getBoundingClientRect()
    if (r) {
      el.style.left = `${r.left}px`
      el.style.top = `${Math.max(8, r.top - el.offsetHeight - 8)}px`
    } else {
      el.style.right = '20px'
      el.style.bottom = '20px'
    }
    setTimeout(() => el.remove(), 2500)
  }

  function clearError(): void {
    document.getElementById('gdp-ai-error')?.remove()
  }

  function getCurrentRepoPath(): string {
    const cfg = getConfig() as Record<string, unknown>
    return (cfg['currentRepoPath'] as string) ?? ''
  }

  const REASON_MESSAGES: Record<string, string> = {
    ai_disabled: 'AI 未启用（请在 GDP 设置 → AI 提交中开启）',
    api_key_missing: '请先在 GDP 设置里填写 API Key',
    no_changes: '没有可提交的变更',
    invalid_base_url: 'Base URL 无效，请检查设置',
  }

  let generating = false

  async function triggerAiGenerate(btn: HTMLButtonElement): Promise<void> {
    if (generating) return
    generating = true

    // Native-style loading: the Commit submit button shows the spinner + text,
    // just like GHD's own Copilot flow. Plus a spinner on the trigger button.
    ensureStyles()
    clearError()
    setCommitGenerating(true)
    btn.setAttribute('aria-busy', 'true')
    btn.style.opacity = '0.6'
    rlog('triggerAiGenerate: start')

    try {
      const ipcRenderer = (require as NodeRequire)('electron').ipcRenderer as {
        invoke(channel: string, ...args: unknown[]): Promise<unknown>
      }

      // Resolve the selected repo path from GD's own IndexedDB/localStorage —
      // __GDP_CONFIG__.currentRepoPath is never populated.
      let repoPath = await getSelectedRepositoryPath()
      if (!repoPath) repoPath = getCurrentRepoPath()
      rlog(`repoPath=${repoPath || '(none)'}`)

      const result = await ipcRenderer.invoke('gdp:ai-generate-commit', { repo_path: repoPath }) as {
        ok: boolean
        summary?: string
        description?: string
        reason?: string
      }
      rlog(`result ok=${result.ok} reason=${result.reason ?? ''}`)

      if (result.ok) {
        // Restore the commit button BEFORE filling fields — setReactInputValue
        // triggers a React re-render that renders the button correctly anyway.
        setCommitGenerating(false)
        const summaryInput = findCommitSummaryInput()
        if (summaryInput && result.summary) setReactInputValue(summaryInput, result.summary)
        const descInput = findCommitDescriptionInput()
        if (descInput && result.description) setReactInputValue(descInput, result.description)
        if (!summaryInput) showError('已生成，但找不到提交信息输入框')
      } else {
        showError(REASON_MESSAGES[result.reason ?? ''] ?? `AI 生成失败：${result.reason ?? 'unknown'}`)
      }
    } catch (e) {
      rlog(`error ${e}`)
      showError(`AI 请求出错：${e}`)
    } finally {
      setCommitGenerating(false)
      btn.removeAttribute('aria-busy')
      btn.style.removeProperty('opacity')
      generating = false
    }
  }

  // Is this button GHD's Copilot button (native, possibly hijacked) or our
  // injected one? Used by the delegated click handler.
  function isCopilotButton(btn: Element): boolean {
    if (btn.id === GDP_AI_BUTTON_ID) return true
    if ((btn as HTMLElement).dataset?.gdpNativeCopilot === '1') return true
    if (btn.classList.contains('copilot-button')) return true
    const al = btn.getAttribute('aria-label') ?? ''
    const ti = btn.getAttribute('title') ?? ''
    return /Copilot|Generate commit message/i.test(al + ' ' + ti)
  }

  // Single delegated capture-phase handler — survives React re-renders that
  // replace the button node (per-node listeners would be lost).
  function onDocumentClickCapture(ev: MouseEvent): void {
    const target = ev.target as Element | null
    const btn = target?.closest('button')
    if (!btn || !isCopilotButton(btn)) return

    const cfg = getConfig()
    if (!cfg.ai?.enabled) {
      rlog('click ignored — ai.enabled is false in __GDP_CONFIG__')
      return // let GHD's native Copilot run
    }
    ev.stopImmediatePropagation()
    ev.preventDefault()
    rlog('click intercepted → AI generate')
    triggerAiGenerate(btn as HTMLButtonElement).catch(() => {})
  }

  function hijackButton(btn: HTMLButtonElement): void {
    if (btn.dataset.gdpHijacked) return
    btn.dataset.gdpHijacked = '1'
    // Stable identity so findCopilotButton keeps recognizing it after we
    // relabel its aria-label/title below (prevents a duplicate injected button).
    btn.dataset[NATIVE_MARKER] = '1'

    // Always show the button regardless of Copilot auth state
    btn.style.removeProperty('display')
    btn.removeAttribute('hidden')
    // Do NOT touch disabled state — it correctly reflects "no files staged"

    const cfg = getConfig()
    if (cfg.ai?.enabled) {
      btn.setAttribute('aria-label', '使用 AI 生成提交消息（GDP）')
      btn.setAttribute('title', '使用 AI 生成提交消息（GDP）')
    }
    // Click handled by the delegated document listener (no per-node listener).
  }

  // Exact copilot octicon paths extracted from GHD 3.5.12's renderer bundle
  // (octicons.copilot, 16px variant) so the injected button matches the
  // native one pixel-for-pixel.
  const COPILOT_ICON_PATHS = [
    'M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z',
    'M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z',
  ]

  function buildCopilotIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'octicon')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('aria-hidden', 'true')
    for (const d of COPILOT_ICON_PATHS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      path.setAttribute('fill-rule', 'evenodd')
      svg.appendChild(path)
    }
    return svg
  }

  function removeInjectedButton(): void {
    document.getElementById(`${GDP_AI_BUTTON_ID}-separator`)?.remove()
    document.getElementById(GDP_AI_BUTTON_ID)?.remove()
  }

  // GHD gates its copilot button on account features (see findCopilotButton).
  // When AI mode is on and GHD didn't render one, inject our own button into
  // the commit box action bar, styled like the native one.
  function ensureInjectedButton(): void {
    const cfg = getConfig()
    if (!cfg.ai?.enabled || findCopilotButton()) {
      removeInjectedButton()
      return
    }
    if (document.getElementById(GDP_AI_BUTTON_ID)) return

    const actionBar = document.querySelector<HTMLDivElement>(
      '.commit-message-component .action-bar'
    )
    if (!actionBar) return

    const btn = document.createElement('button')
    btn.id = GDP_AI_BUTTON_ID
    btn.type = 'button'
    btn.className = 'button-component copilot-button'
    btn.setAttribute('aria-label', '使用 AI 生成提交消息（GDP）')
    btn.setAttribute('title', '使用 AI 生成提交消息（GDP）')
    btn.dataset.gdpHijacked = '1'
    btn.appendChild(buildCopilotIcon())
    // Click handled by the delegated document listener (no per-node listener).

    const optionsBtn = actionBar.querySelector<HTMLButtonElement>('.commit-options-button')
    if (optionsBtn) {
      actionBar.insertBefore(btn, optionsBtn)
      const separator = document.createElement('div')
      separator.id = `${GDP_AI_BUTTON_ID}-separator`
      separator.className = 'separator'
      actionBar.insertBefore(separator, optionsBtn)
    } else {
      actionBar.appendChild(btn)
    }
    console.log('[GDP] AI commit button injected (no native Copilot button)')
  }

  function scan(): void {
    const btn = findCopilotButton()
    if (btn && !btn.dataset.gdpHijacked) {
      hijackButton(btn)
    }
    ensureInjectedButton()
  }

  // One delegated capture-phase click listener for the whole document —
  // robust against React re-renders that swap out the button node.
  document.addEventListener('click', onDocumentClickCapture, true)

  // Initial scan + watch for React re-renders that replace the button
  scan()

  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })

  // Re-apply when config changes (e.g. AI enabled/disabled at runtime)
  window.addEventListener('gdp:config-updated', () => {
    rlog(`config-updated received; ai.enabled=${getConfig().ai?.enabled}`)
    scan() // (re)hijack or inject/remove the button to match the new state
    const btn = findCopilotButton()
    if (btn && getConfig().ai?.enabled) {
      btn.setAttribute('aria-label', '使用 AI 生成提交消息（GDP）')
      btn.setAttribute('title', '使用 AI 生成提交消息（GDP）')
    }
  })

  rlog('copilot hijack active')
  console.log('[GDP] Copilot hijack active')
})()
