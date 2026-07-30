const STYLE_ID = 'gdp-dialog-styles'

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* ═══════════════════════════════════════════════════════════════════
       GDP Settings — design system.
       Restrained, monochrome-first: neutral surfaces + hairline borders +
       typographic hierarchy. GHD's accent blue appears only where controls
       are natively expected to carry color (switch, slider, focus ring).
       Neutrals derive from GHD's own CSS vars via color-mix, so light/dark
       adapt automatically. All rules scoped under #gdp-settings-dialog.
       ═══════════════════════════════════════════════════════════════════ */

    #gdp-settings-dialog {
      /* ── Color tokens ── */
      --gdp-accent: var(--button-background, #0969da);
      --gdp-focus: var(--focus-color, #0969da);
      --gdp-fg: var(--text-color, #1f2328);
      --gdp-fg-muted: var(--text-secondary-color, #656d76);
      --gdp-fg-subtle: color-mix(in srgb, var(--text-color, #1f2328) 45%, transparent);
      --gdp-bg: var(--background-color, #ffffff);
      --gdp-surface: color-mix(in srgb, var(--gdp-fg) 2.5%, transparent);
      --gdp-surface-2: color-mix(in srgb, var(--gdp-fg) 5%, transparent);
      --gdp-surface-hover: color-mix(in srgb, var(--gdp-fg) 7%, transparent);
      --gdp-line: color-mix(in srgb, var(--gdp-fg) 11%, transparent);
      --gdp-line-soft: color-mix(in srgb, var(--gdp-fg) 6%, transparent);
      --gdp-danger: #d1242f;
      --gdp-warn: #bf8700;
      --gdp-ok: #1a7f37;
      /* ── Shape ── */
      --gdp-r-sm: 7px; --gdp-r-md: 10px; --gdp-r-lg: 12px;
      --gdp-ease: cubic-bezier(0.16, 1, 0.3, 1);

      /* neutralize GHD's global dialog styling and force true centering —
         GHD positions its own dialogs, so be explicit about every prop */
      position: fixed; top: 50%; left: 50%; right: auto; bottom: auto;
      transform: translate(-50%, -50%);
      margin: 0; border: none; padding: 0;
      background: transparent; box-shadow: none;
      width: auto; height: auto; min-width: 0; min-height: 0;
      max-width: 100vw; max-height: 100vh; overflow: visible;
      color: var(--gdp-fg);
    }

    #gdp-settings-dialog::backdrop {
      background: rgba(10, 12, 16, 0.45);
      backdrop-filter: blur(4px);
    }
    #gdp-settings-dialog[open]::backdrop { animation: gdp-fade 0.22s ease both; }

    @keyframes gdp-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes gdp-pop {
      from { opacity: 0; transform: scale(0.975) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes gdp-tab-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes gdp-toast-in {
      from { opacity: 0; transform: translateY(10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes gdp-pulse {
      0%, 100% { opacity: 1; }
      55%      { opacity: 0.45; }
    }

    #gdp-settings-dialog * { box-sizing: border-box; }
    #gdp-settings-dialog .gdp-icon { display: block; flex: none; }
    #gdp-settings-dialog .gdp-hide { display: none !important; }

    /* ── Shell ─────────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-dialog-container {
      position: relative;
      display: flex;
      width: 820px; max-width: 94vw;
      height: 588px; max-height: 88vh;
      background: var(--gdp-bg);
      border: 1px solid var(--gdp-line);
      border-radius: var(--gdp-r-lg);
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px; line-height: 1.45;
      -webkit-font-smoothing: antialiased;
      box-shadow:
        0 16px 48px -12px rgba(0, 0, 0, 0.28),
        0 4px 12px -4px rgba(0, 0, 0, 0.12);
    }
    #gdp-settings-dialog[open] .gdp-dialog-container {
      animation: gdp-pop 0.26s var(--gdp-ease) both;
    }

    /* ── Sidebar ───────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-nav {
      flex: none; width: 196px;
      display: flex; flex-direction: column; gap: 2px;
      padding: 16px 10px 14px;
      background: var(--gdp-surface);
      border-right: 1px solid var(--gdp-line-soft);
    }
    #gdp-settings-dialog .gdp-brand {
      display: flex; align-items: center; gap: 10px;
      padding: 2px 8px 16px;
    }
    #gdp-settings-dialog .gdp-brand-logo {
      width: 30px; height: 30px; flex: none;
      display: grid; place-items: center;
      background: var(--gdp-fg); color: var(--gdp-bg);
      border-radius: 8px;
      font-size: 12px; font-weight: 800; letter-spacing: -0.02em;
    }
    #gdp-settings-dialog .gdp-brand-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    #gdp-settings-dialog .gdp-brand-name { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; }
    #gdp-settings-dialog .gdp-brand-sub {
      font-size: 10.5px; color: var(--gdp-fg-subtle);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    #gdp-settings-dialog .gdp-nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 10px;
      border: none; border-radius: var(--gdp-r-sm);
      background: none; color: var(--gdp-fg-muted);
      font: inherit; font-size: 13px; font-weight: 500; text-align: left;
      cursor: pointer;
      transition: background 0.13s, color 0.13s;
    }
    #gdp-settings-dialog .gdp-nav-item .gdp-icon { opacity: 0.75; transition: opacity 0.13s; }
    #gdp-settings-dialog .gdp-nav-item:hover { background: var(--gdp-surface-hover); color: var(--gdp-fg); }
    #gdp-settings-dialog .gdp-nav-item:hover .gdp-icon { opacity: 1; }
    #gdp-settings-dialog .gdp-nav-item.active {
      background: color-mix(in srgb, var(--gdp-fg) 8%, transparent);
      color: var(--gdp-fg); font-weight: 600;
    }
    #gdp-settings-dialog .gdp-nav-item.active .gdp-icon { opacity: 1; }
    #gdp-settings-dialog .gdp-nav-item:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--gdp-focus) 45%, transparent);
    }

    #gdp-settings-dialog .gdp-nav-spacer { flex: 1; }
    #gdp-settings-dialog .gdp-nav-hint {
      display: flex; align-items: center; gap: 4px;
      padding: 8px 8px 2px;
    }
    #gdp-settings-dialog .gdp-nav-hint kbd {
      padding: 2px 6px;
      border: 1px solid var(--gdp-line); border-bottom-width: 2px; border-radius: 5px;
      background: var(--gdp-bg);
      font-family: inherit; font-size: 10px; font-weight: 600; color: var(--gdp-fg-muted);
    }

    /* ── Main pane ─────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

    #gdp-settings-dialog .gdp-main-header {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 20px 18px 12px 26px;
    }
    #gdp-settings-dialog .gdp-head-text { flex: 1; min-width: 0; }
    #gdp-settings-dialog .gdp-main-title {
      margin: 0; font-size: 16.5px; font-weight: 700; letter-spacing: -0.015em;
    }
    #gdp-settings-dialog .gdp-main-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--gdp-fg-muted); }

    #gdp-settings-dialog .gdp-content {
      flex: 1; overflow-y: auto;
      padding: 2px 26px 22px;
      scrollbar-gutter: stable;
    }
    #gdp-settings-dialog .gdp-content::-webkit-scrollbar,
    #gdp-settings-dialog .gdp-log-view::-webkit-scrollbar { width: 10px; }
    #gdp-settings-dialog .gdp-content::-webkit-scrollbar-thumb,
    #gdp-settings-dialog .gdp-log-view::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--gdp-fg) 15%, transparent);
      border-radius: 8px; border: 3px solid transparent; background-clip: padding-box;
    }
    #gdp-settings-dialog .gdp-content::-webkit-scrollbar-thumb:hover,
    #gdp-settings-dialog .gdp-log-view::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--gdp-fg) 26%, transparent);
      border: 3px solid transparent; background-clip: padding-box;
    }

    #gdp-settings-dialog .gdp-tab-panel.gdp-tab-in { animation: gdp-tab-in 0.22s var(--gdp-ease) both; }

    #gdp-settings-dialog .gdp-footer {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 18px 12px 26px;
      border-top: 1px solid var(--gdp-line-soft);
    }
    #gdp-settings-dialog .gdp-footer-link {
      display: inline-flex; align-items: center; gap: 6px;
      margin-right: auto;
      font-size: 12px; color: var(--gdp-fg-muted);
      text-decoration: none; cursor: pointer;
      transition: color 0.13s;
    }
    #gdp-settings-dialog .gdp-footer-link:hover { color: var(--gdp-fg); }

    /* ── Groups ────────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-group-label {
      margin: 18px 2px 7px;
      font-size: 11px; font-weight: 650;
      text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--gdp-fg-subtle);
    }
    #gdp-settings-dialog .gdp-group-label:first-child { margin-top: 6px; }
    #gdp-settings-dialog .gdp-card {
      border: 1px solid var(--gdp-line); border-radius: var(--gdp-r-lg);
      padding: 0 16px;
      background: var(--gdp-surface);
    }

    /* ── Rows & fields ─────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-row {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 12px 0;
    }
    #gdp-settings-dialog .gdp-row + .gdp-row,
    #gdp-settings-dialog .gdp-field + .gdp-field,
    #gdp-settings-dialog .gdp-row + .gdp-field,
    #gdp-settings-dialog .gdp-field + .gdp-row { border-top: 1px solid var(--gdp-line-soft); }

    #gdp-settings-dialog .gdp-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    #gdp-settings-dialog .gdp-row-label { font-size: 13px; font-weight: 550; }
    #gdp-settings-dialog .gdp-row-desc { font-size: 11.5px; color: var(--gdp-fg-muted); line-height: 1.45; }

    #gdp-settings-dialog .gdp-field { padding: 12px 0; }
    #gdp-settings-dialog .gdp-field-label {
      display: flex; align-items: baseline; gap: 8px;
      font-size: 12.5px; font-weight: 550; margin-bottom: 7px;
    }
    #gdp-settings-dialog .gdp-hint { font-weight: 400; color: var(--gdp-fg-subtle); font-size: 11.5px; }

    /* small status chip: "重启生效" / "使用中" */
    #gdp-settings-dialog .gdp-chip {
      display: inline-flex; align-items: center; flex: none;
      padding: 1px 7px; border-radius: 999px;
      border: 1px solid var(--gdp-line);
      font-size: 10px; font-weight: 600; letter-spacing: 0.02em;
      color: var(--gdp-fg-subtle);
      vertical-align: 2px;
    }
    #gdp-settings-dialog .gdp-chip-accent {
      border-color: color-mix(in srgb, var(--gdp-accent) 35%, transparent);
      color: var(--gdp-accent);
      background: color-mix(in srgb, var(--gdp-accent) 7%, transparent);
    }

    /* ── Toggle switch ─────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-switch { position: relative; flex: none; width: 40px; height: 23px; cursor: pointer; }
    #gdp-settings-dialog .gdp-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
    #gdp-settings-dialog .gdp-switch .gdp-slider {
      position: absolute; inset: 0; border-radius: 999px;
      background: color-mix(in srgb, var(--gdp-fg) 20%, transparent);
      transition: background 0.18s;
    }
    #gdp-settings-dialog .gdp-switch .gdp-slider::before {
      content: ""; position: absolute; width: 19px; height: 19px; left: 2px; top: 2px;
      background: #ffffff; border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      transition: transform 0.2s var(--gdp-ease);
    }
    #gdp-settings-dialog .gdp-switch input:checked + .gdp-slider { background: var(--gdp-accent); }
    #gdp-settings-dialog .gdp-switch input:checked + .gdp-slider::before { transform: translateX(17px); }
    #gdp-settings-dialog .gdp-switch:active .gdp-slider::before { transform: scale(0.94); }
    #gdp-settings-dialog .gdp-switch:active input:checked + .gdp-slider::before { transform: translateX(17px) scale(0.94); }
    #gdp-settings-dialog .gdp-switch input:focus-visible + .gdp-slider {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--gdp-focus) 32%, transparent);
    }

    /* ── Inputs ────────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-input,
    #gdp-settings-dialog .gdp-select,
    #gdp-settings-dialog .gdp-textarea {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid var(--gdp-line); border-radius: var(--gdp-r-sm);
      background: var(--gdp-bg); color: var(--gdp-fg);
      font-family: inherit; font-size: 12.5px;
      transition: border-color 0.13s, box-shadow 0.13s;
    }
    #gdp-settings-dialog .gdp-input:hover,
    #gdp-settings-dialog .gdp-select:hover,
    #gdp-settings-dialog .gdp-textarea:hover { border-color: color-mix(in srgb, var(--gdp-fg) 22%, transparent); }
    #gdp-settings-dialog .gdp-input:focus,
    #gdp-settings-dialog .gdp-select:focus,
    #gdp-settings-dialog .gdp-textarea:focus {
      outline: none; border-color: var(--gdp-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--gdp-focus) 15%, transparent);
    }
    #gdp-settings-dialog .gdp-input::placeholder,
    #gdp-settings-dialog .gdp-textarea::placeholder { color: var(--gdp-fg-subtle); }
    #gdp-settings-dialog .gdp-textarea {
      resize: vertical; min-height: 92px; line-height: 1.55;
      font-family: ui-monospace, "SFMono-Regular", "Cascadia Code", Consolas, monospace;
      font-size: 12px;
    }
    #gdp-settings-dialog .gdp-input-sm { width: 110px; flex: none; text-align: right; }
    #gdp-settings-dialog .gdp-input-inline { width: 190px; flex: none; }

    /* input with trailing icon button (password reveal) */
    #gdp-settings-dialog .gdp-input-wrap { position: relative; }
    #gdp-settings-dialog .gdp-input-wrap .gdp-input { padding-right: 36px; }
    #gdp-settings-dialog .gdp-input-trail {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 26px; height: 26px;
      display: grid; place-items: center;
      border: none; border-radius: 6px;
      background: none; color: var(--gdp-fg-subtle); cursor: pointer;
      transition: background 0.13s, color 0.13s;
    }
    #gdp-settings-dialog .gdp-input-trail:hover { background: var(--gdp-surface-hover); color: var(--gdp-fg); }

    /* select with custom chevron */
    #gdp-settings-dialog .gdp-select {
      appearance: none; -webkit-appearance: none;
      padding-right: 30px;
      background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 9px center;
      cursor: pointer;
    }

    /* ── Segmented control ─────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-seg {
      display: inline-flex; gap: 2px; padding: 3px;
      background: var(--gdp-surface-2);
      border-radius: 8px;
    }
    #gdp-settings-dialog .gdp-seg button {
      padding: 4px 11px;
      border: none; border-radius: 6px;
      background: none; color: var(--gdp-fg-muted);
      font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
      transition: background 0.13s, color 0.13s, box-shadow 0.13s;
    }
    #gdp-settings-dialog .gdp-seg button:hover { color: var(--gdp-fg); }
    #gdp-settings-dialog .gdp-seg button.active {
      background: var(--gdp-bg); color: var(--gdp-fg); font-weight: 600;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
    }
    #gdp-settings-dialog .gdp-seg button:focus-visible {
      outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--gdp-focus) 45%, transparent);
    }

    /* ── Range slider ──────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-range-row { display: flex; align-items: center; gap: 14px; }
    #gdp-settings-dialog .gdp-range-row input[type="range"] {
      -webkit-appearance: none; appearance: none;
      flex: 1; height: 5px; border-radius: 999px;
      background: linear-gradient(to right,
        var(--gdp-accent) var(--gdp-fill, 10%),
        color-mix(in srgb, var(--gdp-fg) 13%, transparent) var(--gdp-fill, 10%));
      cursor: pointer;
    }
    #gdp-settings-dialog .gdp-range-row input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 17px; height: 17px; border-radius: 50%;
      background: #fff;
      border: 1px solid color-mix(in srgb, var(--gdp-fg) 20%, transparent);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
      transition: transform 0.13s;
    }
    #gdp-settings-dialog .gdp-range-row input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.1); }
    #gdp-settings-dialog .gdp-range-row input[type="range"]:focus-visible {
      outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--gdp-focus) 22%, transparent);
    }
    #gdp-settings-dialog .gdp-range-value {
      flex: none; min-width: 36px; text-align: center;
      font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums;
      padding: 3px 8px; border-radius: 6px;
      background: var(--gdp-surface-2); color: var(--gdp-fg);
    }

    /* ── Buttons ───────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 6px 14px; border-radius: var(--gdp-r-sm);
      font-family: inherit; font-size: 12.5px; font-weight: 550; cursor: pointer;
      border: 1px solid var(--gdp-line); background: var(--gdp-bg); color: var(--gdp-fg);
      transition: background 0.13s, border-color 0.13s, opacity 0.13s;
    }
    #gdp-settings-dialog .gdp-btn:hover { background: var(--gdp-surface-hover); }
    #gdp-settings-dialog .gdp-btn:disabled { opacity: 0.5; cursor: default; }
    #gdp-settings-dialog .gdp-btn:focus-visible {
      outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--gdp-focus) 25%, transparent);
    }
    /* primary: inverted monochrome — near-black in light theme, near-white in dark */
    #gdp-settings-dialog .gdp-btn-primary {
      background: var(--gdp-fg); border-color: var(--gdp-fg);
      color: var(--gdp-bg); font-weight: 600;
    }
    #gdp-settings-dialog .gdp-btn-primary:hover {
      background: color-mix(in srgb, var(--gdp-fg) 82%, var(--gdp-bg));
      border-color: transparent;
    }
    #gdp-settings-dialog .gdp-btn-ghost { border-color: transparent; background: none; color: var(--gdp-fg-muted); }
    #gdp-settings-dialog .gdp-btn-ghost:hover { background: var(--gdp-surface-hover); color: var(--gdp-fg); }
    #gdp-settings-dialog .gdp-btn-sm { padding: 4px 10px; font-size: 11.5px; border-radius: 6px; }
    #gdp-settings-dialog .gdp-btn-danger {
      color: var(--gdp-danger);
      border-color: color-mix(in srgb, var(--gdp-danger) 35%, var(--gdp-line));
    }
    #gdp-settings-dialog .gdp-btn-danger:hover { background: color-mix(in srgb, var(--gdp-danger) 8%, transparent); }
    #gdp-settings-dialog .gdp-btn-danger.confirm {
      background: var(--gdp-danger); border-color: var(--gdp-danger); color: #fff; font-weight: 600;
    }
    #gdp-settings-dialog .gdp-btn-danger.confirm:hover { filter: brightness(1.06); }

    #gdp-settings-dialog .gdp-icon-btn {
      width: 28px; height: 28px; flex: none;
      display: grid; place-items: center;
      border: none; border-radius: var(--gdp-r-sm);
      background: none; color: var(--gdp-fg-muted); cursor: pointer;
      transition: background 0.13s, color 0.13s;
    }
    #gdp-settings-dialog .gdp-icon-btn:hover { background: var(--gdp-surface-hover); color: var(--gdp-fg); }
    #gdp-settings-dialog .gdp-icon-btn:focus-visible {
      outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--gdp-focus) 45%, transparent);
    }

    /* ── Toolbar ───────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-toolbar { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; }
    #gdp-settings-dialog .gdp-grow { flex: 1; }

    #gdp-settings-dialog .gdp-search { position: relative; flex: 1; max-width: 230px; }
    #gdp-settings-dialog .gdp-search .gdp-icon {
      position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
      color: var(--gdp-fg-subtle); pointer-events: none;
    }
    #gdp-settings-dialog .gdp-search .gdp-input { padding: 5px 10px 5px 29px; font-size: 12px; }

    #gdp-settings-dialog .gdp-live {
      display: inline-flex; align-items: center; gap: 7px;
      font-size: 11.5px; font-weight: 600; color: var(--gdp-fg-muted);
    }
    #gdp-settings-dialog .gdp-live::before {
      content: ""; width: 6px; height: 6px; border-radius: 50%;
      background: var(--gdp-ok);
      animation: gdp-pulse 2s ease infinite;
    }

    /* ── Logs ──────────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-log-view {
      background: color-mix(in srgb, var(--gdp-fg) 3.5%, transparent);
      border: 1px solid var(--gdp-line); border-radius: var(--gdp-r-lg);
      padding: 12px 14px;
      height: 402px; overflow-y: auto;
      font-family: ui-monospace, "SFMono-Regular", "Cascadia Code", Consolas, monospace;
      font-size: 11.5px; line-height: 1.6;
    }
    #gdp-settings-dialog .gdp-log-entry {
      display: flex; align-items: baseline; gap: 8px;
      padding: 1px 0;
    }
    #gdp-settings-dialog .gdp-log-time { flex: none; color: var(--gdp-fg-subtle); font-size: 10.5px; }
    #gdp-settings-dialog .gdp-log-badge {
      flex: none; align-self: center;
      font-size: 9px; font-weight: 700; letter-spacing: 0.05em;
      padding: 1px 6px; border-radius: 4px;
      background: var(--gdp-surface-2); color: var(--gdp-fg-muted);
    }
    #gdp-settings-dialog .gdp-log-entry.level-warn .gdp-log-badge {
      background: color-mix(in srgb, var(--gdp-warn) 16%, transparent);
      color: color-mix(in srgb, var(--gdp-warn) 80%, var(--gdp-fg));
    }
    #gdp-settings-dialog .gdp-log-entry.level-error .gdp-log-badge,
    #gdp-settings-dialog .gdp-log-entry.level-block .gdp-log-badge {
      background: color-mix(in srgb, var(--gdp-danger) 13%, transparent); color: var(--gdp-danger);
    }
    #gdp-settings-dialog .gdp-log-cat { flex: none; color: var(--gdp-fg-muted); }
    #gdp-settings-dialog .gdp-log-msg { white-space: pre-wrap; word-break: break-word; min-width: 0; }
    #gdp-settings-dialog .gdp-log-entry.level-error .gdp-log-msg,
    #gdp-settings-dialog .gdp-log-entry.level-block .gdp-log-msg { color: var(--gdp-danger); }

    /* ── Locales ───────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-locale-list {
      list-style: none; margin: 0 0 14px; padding: 0;
      border: 1px solid var(--gdp-line); border-radius: var(--gdp-r-lg);
      background: var(--gdp-surface);
      overflow: hidden;
    }
    #gdp-settings-dialog .gdp-locale-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--gdp-line-soft);
      transition: background 0.13s;
    }
    #gdp-settings-dialog .gdp-locale-item:last-child { border-bottom: none; }
    #gdp-settings-dialog .gdp-locale-item:hover { background: var(--gdp-surface-hover); }
    #gdp-settings-dialog .gdp-locale-ico {
      width: 28px; height: 28px; flex: none;
      display: grid; place-items: center;
      border-radius: 8px;
      background: var(--gdp-surface-2); color: var(--gdp-fg-muted);
    }
    #gdp-settings-dialog .gdp-locale-name {
      flex: 1; min-width: 0;
      font-weight: 600; font-size: 12.5px;
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #gdp-settings-dialog .gdp-locale-actions {
      display: flex; align-items: center; gap: 6px;
      opacity: 0; transition: opacity 0.13s;
    }
    #gdp-settings-dialog .gdp-locale-item:hover .gdp-locale-actions,
    #gdp-settings-dialog .gdp-locale-actions:focus-within,
    #gdp-settings-dialog .gdp-locale-actions:has(.confirm) { opacity: 1; }

    /* ── Empty state ───────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-empty {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 44px 0; color: var(--gdp-fg-subtle); font-size: 12.5px;
    }
    #gdp-settings-dialog .gdp-empty .gdp-icon { opacity: 0.35; }

    /* ── Toast ─────────────────────────────────────────────────────── */
    #gdp-settings-dialog .gdp-toast-region {
      position: absolute; left: 50%; bottom: 68px; transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      z-index: 10; pointer-events: none;
    }
    #gdp-settings-dialog .gdp-toast {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 15px; border-radius: 999px;
      background: color-mix(in srgb, var(--gdp-fg) 92%, var(--gdp-bg));
      color: var(--gdp-bg);
      font-size: 12.5px; font-weight: 550; white-space: nowrap;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
      animation: gdp-toast-in 0.24s var(--gdp-ease) both;
      transition: opacity 0.22s, transform 0.22s;
    }
    #gdp-settings-dialog .gdp-toast.out { opacity: 0; transform: translateY(8px); }
    #gdp-settings-dialog .gdp-toast-success .gdp-icon { color: #4ade80; }
    #gdp-settings-dialog .gdp-toast-error .gdp-icon { color: #f87171; }
  `
  document.head.appendChild(style)
}
