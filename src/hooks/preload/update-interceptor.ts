/**
 * Update Interceptor — runs inside GitHub Desktop's renderer process.
 * Detects the About dialog's "Check for Updates" and "Quit and Install Update" buttons,
 * intercepts their click events, and shows a GDP informational modal instead.
 *
 * Controlled by window.__GDP_CONFIG__.blockManualUpdateCheck (boolean).
 * When false, this script does nothing (manual check is allowed through).
 */
(function () {
  const gdpConfig = (window as unknown as Record<string, unknown>).__GDP_CONFIG__ as {
    blockManualUpdateCheck?: boolean
    blockUpdates?: boolean
  } | undefined

  const interceptorState = ((window as unknown as Record<string, unknown>).__GDP_UPDATE_INTERCEPTOR_STATE__ as {
    active?: boolean
    scans?: number
    interceptions?: string[]
  } | undefined) ?? {
    active: false,
    scans: 0,
    interceptions: [],
  }
  ;(window as unknown as Record<string, unknown>).__GDP_UPDATE_INTERCEPTOR_STATE__ = interceptorState

  // Only intercept if blockManualUpdateCheck is explicitly enabled
  if (!gdpConfig?.blockManualUpdateCheck) return

  interceptorState.active = true

  let modalShown = false

  /** Read a CSS variable from the body element (falls back to a sensible default). */
  function cssVar(name: string, fallback: string): string {
    const val = getComputedStyle(document.body).getPropertyValue(name).trim()
    return val || fallback
  }

  /** Return a colors object that reflects the current GitHub Desktop theme. */
  function getThemeColors() {
    const isDark = document.body.classList.contains('theme-dark')
    return {
      bg:      cssVar('--background-color',    isDark ? '#1c2128' : '#ffffff'),
      text:    cssVar('--text-color',           isDark ? '#cdd9e5' : '#24292f'),
      textDim: cssVar('--text-secondary-color', isDark ? '#768390' : '#57606a'),
      border:  cssVar('--box-border-color',     isDark ? '#444c56' : '#d0d7de'),
      accent:  cssVar('--button-background',    '#2da44e'),
      btnText: cssVar('--button-text-color',    '#ffffff'),
      warn:    cssVar('--dialog-warning-color', isDark ? '#c69026' : '#9a6700'),
      overlay: cssVar('--overlay-background-color', 'rgba(0,0,0,0.4)'),
    }
  }

  function showGDPModal() {
    if (modalShown) return
    modalShown = true

    const c = getThemeColors()
    const FF = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

    // Use a <dialog> element so it lands in the browser top-layer and appears
    // above any existing showModal() dialogs (e.g. the About dialog).
    const dlg = document.createElement('dialog')
    dlg.id = 'gdp-update-modal-dialog'
    Object.assign(dlg.style, {
      border: 'none',
      padding: '0',
      margin: 'auto',
      background: 'transparent',
      maxWidth: '100vw',
      maxHeight: '100vh',
      overflow: 'visible',
    })

    // Style the ::backdrop via a <style> tag so it covers the viewport.
    const styleEl = document.createElement('style')
    styleEl.textContent = `
      #gdp-update-modal-dialog::backdrop {
        background: ${c.overlay};
      }
    `
    document.head.appendChild(styleEl)

    const modal = document.createElement('div')
    Object.assign(modal.style, {
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: '8px',
      padding: '24px',
      maxWidth: '420px',
      width: '90vw',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      fontFamily: FF,
    })

    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="${c.warn}"/>
        </svg>
        <span style="font-size:14px;font-weight:600;color:${c.text}">更新功能已被拦截</span>
      </div>
      <p style="font-size:12px;color:${c.textDim};line-height:1.6;margin:0 0 16px">
        GitHub Desktop Plus 已拦截更新检查功能。<br><br>
        如需修改更新设置，请打开 GDP 设置进行配置。
      </p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="gdp-modal-cancel" style="
          padding:7px 16px;
          border:1px solid ${c.border};
          background:transparent;
          color:${c.text};
          border-radius:6px;
          cursor:pointer;
          font-size:12px;
          font-family:${FF};
        ">关闭</button>
        <button id="gdp-modal-open-settings" style="
          padding:7px 16px;
          border:1px solid ${c.accent};
          background:${c.accent};
          color:${c.btnText};
          border-radius:6px;
          cursor:pointer;
          font-size:12px;
          font-weight:500;
          font-family:${FF};
        ">打开设置</button>
      </div>
    `

    dlg.appendChild(modal)
    document.body.appendChild(dlg)
    dlg.showModal()

    const closeModal = () => {
      dlg.close()
      dlg.remove()
      styleEl.remove()
      modalShown = false
    }

    // Clicking the ::backdrop (outside the modal div) closes the dialog
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) closeModal()
    })

    modal.querySelector<HTMLButtonElement>('#gdp-modal-cancel')?.addEventListener('click', closeModal)

    modal.querySelector<HTMLButtonElement>('#gdp-modal-open-settings')?.addEventListener('click', () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ipcRenderer = (require as NodeRequire)('electron').ipcRenderer as {
          invoke(channel: string, ...args: unknown[]): Promise<unknown>
        }
        ipcRenderer.invoke('gdp:open-settings', 'general').catch(() => { /* ignore */ })
      } catch { /* ignore if ipc unavailable */ }
      closeModal()
    })

    // Re-apply colours if the theme changes while the dialog is open
    const themeObserver = new MutationObserver(() => {
      const nc = getThemeColors()
      modal.style.background = nc.bg
      modal.style.border = `1px solid ${nc.border}`
      styleEl.textContent = `#gdp-update-modal-dialog::backdrop { background: ${nc.overlay}; }`
    })
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })

    dlg.addEventListener('close', () => themeObserver.disconnect(), { once: true })
  }

  // Intercept update-related buttons inside the About dialog
  // The About dialog uses class "dialog" and has buttons with specific text content
  const UPDATE_BUTTON_TEXTS = [
    'Check for Updates',
    '检查更新',
    'Quit and Install Update',
    '退出并安装更新',
  ]

  function isAboutDialogUpdateButton(button: HTMLButtonElement) {
    const aboutDialog = button.closest('#about')
    if (!aboutDialog) return false

    // The About dialog currently has exactly one actionable update button in
    // the content area. The default Close button lives in `.dialog-footer`.
    return button.closest('.dialog-footer') === null
  }

  function isUpdateButton(button: HTMLButtonElement): boolean {
    const text = button.textContent?.trim() ?? ''
    const matchesText = UPDATE_BUTTON_TEXTS.some(t => text.includes(t))
    return matchesText || isAboutDialogUpdateButton(button)
  }

  function recordInterception(button: HTMLButtonElement) {
    const text = button.textContent?.trim() ?? ''
    interceptorState.interceptions ??= []
    interceptorState.interceptions.push(text)
    interceptorState.interceptions = interceptorState.interceptions.slice(-10)
  }

  document.addEventListener('click', (event) => {
    interceptorState.scans = (interceptorState.scans ?? 0) + 1

    const target = event.target
    const button = target instanceof Element ? target.closest('button') : null
    if (!(button instanceof HTMLButtonElement) || !isUpdateButton(button)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    recordInterception(button)
    showGDPModal()
    console.log('[GDP] Update button click intercepted — showing GDP modal')
  }, true)

  console.log('[GDP] Update interceptor active')
})()
