const STYLE_ID = 'gdp-dialog-styles'

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* GDP Settings — sidebar + cards, themed via GHD CSS vars + color-mix.
       Subtle surfaces use color-mix so they adapt to light/dark automatically. */

    #gdp-settings-dialog {
      --gdp-accent: var(--button-background, #2da44e);
      --gdp-fg: var(--text-color, #1f2328);
      --gdp-fg-muted: var(--text-secondary-color, #656d76);
      --gdp-bg: var(--background-color, #ffffff);
      --gdp-line: color-mix(in srgb, var(--text-color, #1f2328) 12%, transparent);
      --gdp-surface: color-mix(in srgb, var(--text-color, #1f2328) 3%, transparent);
      --gdp-surface-hover: color-mix(in srgb, var(--text-color, #1f2328) 7%, transparent);
      border: none;
      padding: 0;
      background: transparent;
      max-width: 100vw;
      max-height: 100vh;
      overflow: visible;
    }

    #gdp-settings-dialog::backdrop {
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
    }

    #gdp-settings-dialog .gdp-dialog-container {
      display: flex;
      width: 760px;
      max-width: 92vw;
      height: 560px;
      max-height: 84vh;
      background: var(--gdp-bg);
      border: 1px solid var(--gdp-line);
      border-radius: 12px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      color: var(--gdp-fg);
      box-shadow: 0 12px 48px rgba(0,0,0,0.28);
    }

    /* ── Sidebar ─────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-nav {
      flex: none;
      width: 184px;
      display: flex;
      flex-direction: column;
      padding: 16px 12px;
      gap: 2px;
      background: var(--gdp-surface);
      border-right: 1px solid var(--gdp-line);
    }

    #gdp-settings-dialog .gdp-nav-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px 14px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    #gdp-settings-dialog .gdp-nav-brand .gdp-nav-logo {
      width: 22px; height: 22px;
      display: grid; place-items: center;
      background: var(--gdp-accent);
      color: #fff;
      border-radius: 6px;
      font-size: 11px; font-weight: 700;
    }

    #gdp-settings-dialog .gdp-nav-item {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 10px;
      border: none;
      border-radius: 7px;
      background: none;
      color: var(--gdp-fg-muted);
      font: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    #gdp-settings-dialog .gdp-nav-item:hover {
      background: var(--gdp-surface-hover);
      color: var(--gdp-fg);
    }
    #gdp-settings-dialog .gdp-nav-item.active {
      background: color-mix(in srgb, var(--gdp-accent) 14%, transparent);
      color: var(--gdp-accent);
      font-weight: 600;
    }
    #gdp-settings-dialog .gdp-nav-item .gdp-nav-icon { font-size: 15px; width: 18px; text-align: center; }

    /* ── Main pane ───────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    #gdp-settings-dialog .gdp-main-header {
      padding: 20px 24px 12px;
    }
    #gdp-settings-dialog .gdp-main-title {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    #gdp-settings-dialog .gdp-main-subtitle {
      margin: 3px 0 0;
      font-size: 12px;
      color: var(--gdp-fg-muted);
    }

    #gdp-settings-dialog .gdp-content {
      flex: 1;
      overflow-y: auto;
      padding: 4px 24px 20px;
    }

    #gdp-settings-dialog .gdp-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 24px;
      border-top: 1px solid var(--gdp-line);
    }
    #gdp-settings-dialog .gdp-footer .gdp-saved-hint {
      margin-right: auto;
      font-size: 12px;
      color: var(--gdp-accent);
      opacity: 0;
      transition: opacity 0.2s;
    }
    #gdp-settings-dialog .gdp-footer .gdp-saved-hint.show { opacity: 1; }

    /* ── Cards & rows ────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-card {
      border: 1px solid var(--gdp-line);
      border-radius: 10px;
      padding: 2px 16px;
      margin-bottom: 14px;
      background: var(--gdp-surface);
    }
    #gdp-settings-dialog .gdp-card-title,
    #gdp-settings-dialog .gdp-section-heading {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--gdp-fg-muted);
      padding: 12px 2px 4px;
      margin: 0 0 8px;
    }
    #gdp-settings-dialog .gdp-section-heading:not(:first-child) { margin-top: 8px; }

    #gdp-settings-dialog .gdp-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 2px;
    }
    #gdp-settings-dialog .gdp-row + .gdp-row,
    #gdp-settings-dialog .gdp-field + .gdp-field,
    #gdp-settings-dialog .gdp-row + .gdp-field,
    #gdp-settings-dialog .gdp-field + .gdp-row {
      border-top: 1px solid var(--gdp-line);
    }
    #gdp-settings-dialog .gdp-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    #gdp-settings-dialog .gdp-row-label { font-size: 13px; font-weight: 500; }
    #gdp-settings-dialog .gdp-row-desc { font-size: 11.5px; color: var(--gdp-fg-muted); line-height: 1.4; }

    #gdp-settings-dialog .gdp-field { padding: 12px 2px; }
    #gdp-settings-dialog .gdp-field-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 7px; }
    #gdp-settings-dialog .gdp-field-label .gdp-hint { font-weight: 400; color: var(--gdp-fg-muted); font-size: 11.5px; }

    /* ── Toggle switch ───────────────────────────────────────── */
    #gdp-settings-dialog .gdp-switch { position: relative; flex: none; width: 38px; height: 22px; }
    #gdp-settings-dialog .gdp-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
    #gdp-settings-dialog .gdp-switch .gdp-slider {
      position: absolute; inset: 0;
      background: color-mix(in srgb, var(--gdp-fg) 25%, transparent);
      border-radius: 999px;
      transition: background 0.15s;
    }
    #gdp-settings-dialog .gdp-switch .gdp-slider::before {
      content: ""; position: absolute;
      width: 18px; height: 18px; left: 2px; top: 2px;
      background: #fff; border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
      transition: transform 0.15s;
    }
    #gdp-settings-dialog .gdp-switch input:checked + .gdp-slider { background: var(--gdp-accent); }
    #gdp-settings-dialog .gdp-switch input:checked + .gdp-slider::before { transform: translateX(16px); }
    #gdp-settings-dialog .gdp-switch input:focus-visible + .gdp-slider {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--gdp-accent) 35%, transparent);
    }

    /* ── Inputs ──────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-input,
    #gdp-settings-dialog .gdp-select,
    #gdp-settings-dialog .gdp-textarea {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--gdp-line);
      border-radius: 7px;
      background: var(--gdp-bg);
      color: var(--gdp-fg);
      font-family: inherit;
      font-size: 12.5px;
      box-sizing: border-box;
    }
    #gdp-settings-dialog .gdp-input:focus,
    #gdp-settings-dialog .gdp-select:focus,
    #gdp-settings-dialog .gdp-textarea:focus {
      outline: none;
      border-color: var(--gdp-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--gdp-accent) 20%, transparent);
    }
    #gdp-settings-dialog .gdp-textarea {
      resize: vertical;
      min-height: 84px;
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      line-height: 1.5;
    }

    #gdp-settings-dialog .gdp-range-row { display: flex; align-items: center; gap: 12px; }
    #gdp-settings-dialog .gdp-range-row input[type="range"] { flex: 1; accent-color: var(--gdp-accent); }
    #gdp-settings-dialog .gdp-range-value {
      flex: none; min-width: 34px; text-align: center;
      font-size: 12px; font-weight: 600;
      padding: 3px 8px; border-radius: 6px;
      background: color-mix(in srgb, var(--gdp-accent) 14%, transparent);
      color: var(--gdp-accent);
    }

    /* ── Buttons ─────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-btn {
      padding: 7px 16px;
      border-radius: 7px;
      font-size: 12.5px;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid var(--gdp-line);
      background: var(--gdp-bg);
      color: var(--gdp-fg);
      transition: background 0.12s;
    }
    #gdp-settings-dialog .gdp-btn:hover { background: var(--gdp-surface-hover); }
    #gdp-settings-dialog .gdp-btn-primary {
      background: var(--gdp-accent);
      border-color: var(--gdp-accent);
      color: var(--button-text-color, #ffffff);
      font-weight: 600;
    }
    #gdp-settings-dialog .gdp-btn-primary:hover { background: var(--gdp-accent); opacity: 0.9; }
    #gdp-settings-dialog .gdp-btn-sm { padding: 4px 10px; font-size: 11.5px; border-radius: 6px; }
    #gdp-settings-dialog .gdp-btn-danger { color: #cf222e; border-color: color-mix(in srgb, #cf222e 45%, var(--gdp-line)); }
    #gdp-settings-dialog .gdp-btn-danger:hover { background: color-mix(in srgb, #cf222e 10%, transparent); }

    /* ── Advanced disclosure ─────────────────────────────────── */
    #gdp-settings-dialog .gdp-advanced {
      border: 1px solid var(--gdp-line);
      border-radius: 10px;
      margin-bottom: 14px;
      overflow: hidden;
    }
    #gdp-settings-dialog .gdp-advanced > summary {
      display: flex; align-items: center; gap: 7px;
      padding: 11px 16px;
      font-size: 12.5px; font-weight: 600;
      color: var(--gdp-fg-muted);
      cursor: pointer; user-select: none;
      list-style: none;
    }
    #gdp-settings-dialog .gdp-advanced > summary::-webkit-details-marker { display: none; }
    #gdp-settings-dialog .gdp-advanced > summary::before {
      content: "›"; font-size: 15px; line-height: 1;
      transition: transform 0.15s;
    }
    #gdp-settings-dialog .gdp-advanced[open] > summary::before { transform: rotate(90deg); }
    #gdp-settings-dialog .gdp-advanced[open] > summary { border-bottom: 1px solid var(--gdp-line); }
    #gdp-settings-dialog .gdp-advanced-body { padding: 2px 16px 8px; }

    /* ── Logs tab ────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-log-container {
      background: color-mix(in srgb, var(--gdp-fg) 4%, transparent);
      border: 1px solid var(--gdp-line);
      border-radius: 8px;
      padding: 10px 12px;
      height: 380px;
      overflow-y: auto;
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 11px;
      line-height: 1.55;
    }
    #gdp-settings-dialog .gdp-log-entry { margin: 0; padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
    #gdp-settings-dialog .gdp-log-entry.level-error { color: #cf222e; }
    #gdp-settings-dialog .gdp-log-entry.level-warn  { color: #9a6700; }
    #gdp-settings-dialog .gdp-log-entry.level-block { color: #cf222e; }
    #gdp-settings-dialog .gdp-log-entry.level-info  { color: var(--gdp-fg); }

    /* ── Locales tab ─────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-locale-list {
      list-style: none; margin: 0 0 12px; padding: 0;
      border: 1px solid var(--gdp-line); border-radius: 8px; overflow: hidden;
    }
    #gdp-settings-dialog .gdp-locale-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid var(--gdp-line); font-size: 12.5px;
    }
    #gdp-settings-dialog .gdp-locale-item:last-child { border-bottom: none; }
    #gdp-settings-dialog .gdp-locale-item-actions { display: flex; gap: 6px; }

    /* Utility */
    #gdp-settings-dialog .gdp-toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
    #gdp-settings-dialog .gdp-grow { flex: 1; }
  `
  document.head.appendChild(style)
}
