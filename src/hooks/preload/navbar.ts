/**
 * GDP Navbar — injected into GitHub Desktop's renderer process.
 * Creates a small floating button that opens a control panel overlay,
 * allowing quick access to GDP settings without a separate window.
 */
(function () {
  if ((window as unknown as Record<string, unknown>).__GDP_NAVBAR_INJECTED__) return;
  (window as unknown as Record<string, unknown>).__GDP_NAVBAR_INJECTED__ = true;

  const ACCENT = '#58a6ff';
  const BG_DARK = '#161b22';
  const BG_PANEL = '#0d1117';
  const BORDER = '#30363d';
  const TEXT = '#c9d1d9';
  const TEXT_DIM = '#8b949e';

  // --- Floating trigger button ---
  const btn = document.createElement('div');
  btn.id = 'gdp-navbar-btn';
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8S12.42 0 8 0zm.75 12h-1.5v-1.5h1.5V12zm0-3h-1.5V4h1.5v5z" fill="${ACCENT}"/>
  </svg><span style="margin-left:6px;font-size:11px;font-weight:600;color:${TEXT}">GDP</span>`;
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    zIndex: '99999',
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    background: BG_DARK,
    border: `1px solid ${BORDER}`,
    borderRadius: '20px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    transition: 'all 0.2s ease',
    userSelect: 'none',
    opacity: '0.7',
  });
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.transform = 'scale(1.05)'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.7'; btn.style.transform = 'scale(1)'; });

  // --- Panel overlay ---
  const panel = document.createElement('div');
  panel.id = 'gdp-navbar-panel';
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '52px',
    right: '12px',
    width: '320px',
    maxHeight: '480px',
    zIndex: '99998',
    background: BG_PANEL,
    border: `1px solid ${BORDER}`,
    borderRadius: '8px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    display: 'none',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  });

  const config = (window as unknown as Record<string, unknown>).__GDP_CONFIG__ as Record<string, unknown> | undefined;

  panel.innerHTML = `
    <div style="padding:12px 16px;background:${BG_DARK};border-bottom:1px solid ${BORDER};display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:${ACCENT}">GitHub Desktop Plus</span>
      <span id="gdp-panel-close" style="cursor:pointer;color:${TEXT_DIM};font-size:16px;line-height:1">&times;</span>
    </div>
    <div style="padding:12px 16px;flex:1;overflow-y:auto">
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:${TEXT_DIM};margin-bottom:4px">状态</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap" id="gdp-status-badges"></div>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:${TEXT_DIM};margin-bottom:4px">最近日志</div>
        <div id="gdp-log-mini" style="font-size:11px;font-family:monospace;color:${TEXT_DIM};max-height:200px;overflow-y:auto;background:${BG_DARK};border-radius:4px;padding:8px;line-height:1.6"></div>
      </div>
    </div>
    <div style="padding:8px 16px;border-top:1px solid ${BORDER};display:flex;gap:8px">
      <button id="gdp-btn-settings" style="flex:1;padding:6px;border:1px solid ${BORDER};background:${BG_DARK};color:${TEXT};border-radius:4px;cursor:pointer;font-size:11px">⚙ 设置</button>
      <button id="gdp-btn-locale" style="flex:1;padding:6px;border:1px solid ${BORDER};background:${BG_DARK};color:${TEXT};border-radius:4px;cursor:pointer;font-size:11px">🌐 语言</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // --- Badge renderer ---
  function renderBadges() {
    const badges = document.getElementById('gdp-status-badges');
    if (!badges) return;
    const items = [
      { label: '更新拦截', active: config?.blockUpdates !== false, color: '#f85149' },
      { label: '遥测拦截', active: config?.blockTelemetry !== false, color: '#d29922' },
      { label: '中文界面', active: config?.enableI18n !== false, color: '#3fb950' },
    ];
    badges.innerHTML = items.map(i =>
      `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:${i.active ? i.color + '22' : '#21262d'};color:${i.active ? i.color : TEXT_DIM};border:1px solid ${i.active ? i.color + '55' : BORDER}">${i.active ? '●' : '○'} ${i.label}</span>`
    ).join('');
  }

  // --- Log display ---
  const logLines: string[] = [];
  const MAX_LOG_LINES = 50;
  const origConsoleLog = console.log;

  // Intercept console.log to capture GDP log lines
  console.log = function (...args: unknown[]) {
    origConsoleLog.apply(console, args);
    const msg = args.map(a => String(a)).join(' ');
    if (msg.includes('[GDP') || msg.includes('[gdp') || msg.includes('GDP')) {
      logLines.push(msg);
      if (logLines.length > MAX_LOG_LINES) logLines.shift();
      updateLogDisplay();
    }
  };

  function updateLogDisplay() {
    const logEl = document.getElementById('gdp-log-mini');
    if (!logEl) return;
    logEl.innerHTML = logLines.slice(-20).map(line => {
      let color = TEXT_DIM;
      if (line.includes('BLOCK') || line.includes('blocked')) color = '#f85149';
      else if (line.includes('WARN')) color = '#d29922';
      else if (line.includes('ERROR') || line.includes('failed')) color = '#f85149';
      else if (line.includes('INFO') || line.includes('✓')) color = '#3fb950';
      return `<div style="color:${color};word-break:break-all">${line.replace(/</g, '&lt;')}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  // --- Toggle panel ---
  let panelOpen = false;
  btn.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'flex' : 'none';
    if (panelOpen) {
      renderBadges();
      updateLogDisplay();
    }
  });

  document.getElementById('gdp-panel-close')?.addEventListener('click', () => {
    panelOpen = false;
    panel.style.display = 'none';
  });

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (panelOpen && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      panelOpen = false;
      panel.style.display = 'none';
    }
  });

  // Initial render
  renderBadges();

  // Add initial log entry
  logLines.push(`[GDP i18n] Active with ${Object.keys((window as unknown as Record<string, unknown>).__GDP_TRANSLATIONS__ as Record<string, string> ?? {}).length} entries`);
  updateLogDisplay();

  origConsoleLog('[GDP] Navbar injected successfully');
})();
