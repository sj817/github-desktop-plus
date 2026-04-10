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

  const ACCENT = '#58a6ff'
  const BG_OVERLAY = 'rgba(0, 0, 0, 0.6)'
  const BG_MODAL = '#0d1117'
  const BORDER = '#30363d'
  const TEXT = '#c9d1d9'
  const TEXT_DIM = '#8b949e'
  const WARN_COLOR = '#d29922'
  const WEBUI_URL = 'http://127.0.0.1:7788'

  let modalShown = false

  function showGDPModal() {
    if (modalShown) return
    modalShown = true

    const overlay = document.createElement('div')
    overlay.id = 'gdp-update-modal-overlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: BG_OVERLAY,
      zIndex: '100000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    })

    const modal = document.createElement('div')
    Object.assign(modal.style, {
      background: BG_MODAL,
      border: `1px solid ${BORDER}`,
      borderRadius: '12px',
      padding: '24px',
      maxWidth: '420px',
      width: '90%',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    })

    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="${WARN_COLOR}"/>
        </svg>
        <span style="font-size:16px;font-weight:600;color:${TEXT}">更新功能已被拦截</span>
      </div>
      <div style="font-size:13px;color:${TEXT_DIM};line-height:1.6;margin-bottom:16px">
        GitHub Desktop Plus 已拦截更新检查功能。<br><br>
        如需修改更新设置，请打开 GDP 控制面板进行配置：
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="gdp-modal-cancel" style="
          padding:8px 16px;
          border:1px solid ${BORDER};
          background:transparent;
          color:${TEXT};
          border-radius:6px;
          cursor:pointer;
          font-size:13px;
        ">关闭</button>
        <button id="gdp-modal-open-webui" style="
          padding:8px 16px;
          border:1px solid ${ACCENT};
          background:${ACCENT}22;
          color:${ACCENT};
          border-radius:6px;
          cursor:pointer;
          font-size:13px;
          font-weight:500;
        ">打开控制面板</button>
      </div>
    `

    overlay.appendChild(modal)
    document.body.appendChild(overlay)

    // Close modal
    const closeModal = () => {
      overlay.remove()
      modalShown = false
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal()
    })

    document.getElementById('gdp-modal-cancel')?.addEventListener('click', closeModal)

    document.getElementById('gdp-modal-open-webui')?.addEventListener('click', () => {
      // Use window.open as a fallback since we're in the renderer
      window.open(WEBUI_URL, '_blank')
      closeModal()
    })
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

  function interceptButton(button: HTMLButtonElement) {
    if (button.dataset.gdpIntercepted === '1') return

    const text = button.textContent?.trim() ?? ''
    const matchesText = UPDATE_BUTTON_TEXTS.some(t => text.includes(t))
    if (!matchesText && !isAboutDialogUpdateButton(button)) return

    button.dataset.gdpIntercepted = '1'
    interceptorState.interceptions ??= []
    interceptorState.interceptions.push(text)
    interceptorState.interceptions = interceptorState.interceptions.slice(-10)

    // Insert our handler at the capturing phase to prevent the original click
    button.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      showGDPModal()
      console.log('[GDP] Update button click intercepted — showing GDP modal')
    }, true)

    console.log(`[GDP] Intercepted update button: "${text}"`)
  }

  function scanForUpdateButtons(root: Element | Document) {
    interceptorState.scans = (interceptorState.scans ?? 0) + 1

    if (root instanceof HTMLButtonElement) {
      interceptButton(root)
    }

    const buttons = root.querySelectorAll('button')
    buttons.forEach(btn => interceptButton(btn as HTMLButtonElement))
  }

  // Initial scan
  if (document.body) {
    scanForUpdateButtons(document)
  }

  // Watch for About dialog appearing (React renders it dynamically)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        if (mutation.target instanceof Element) {
          scanForUpdateButtons(mutation.target)
        }

        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanForUpdateButtons(node as Element)
          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            scanForUpdateButtons(node.parentElement)
          }
        })
      } else if (mutation.type === 'characterData' && mutation.target.parentElement) {
        scanForUpdateButtons(mutation.target.parentElement)
      }
    }
  })

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  // Fallback polling: some React update sequences can temporarily expose the
  // About dialog button before its final structure/text settles, which may
  // evade a single mutation callback path. A lightweight periodic rescan keeps
  // the interception robust without depending on exact render timing.
  window.setInterval(() => {
    if (document.body) {
      scanForUpdateButtons(document)
    }
  }, 400)

  console.log('[GDP] Update interceptor active — monitoring for update buttons')
})()
