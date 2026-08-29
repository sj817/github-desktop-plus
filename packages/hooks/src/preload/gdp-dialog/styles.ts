const STYLE_ID = 'gdp-dialog-shell-styles'

/**
 * Styles for the dialog shell only — the frame, the backdrop and the box the UI
 * is rendered into. Everything inside is the settings UI's own (Tailwind)
 * stylesheet, which it injects when it mounts.
 *
 * The bulk of this is neutralising GitHub Desktop's global `dialog` rules: it
 * styles and positions its own dialogs, so every property that would otherwise
 * be inherited from those rules is set explicitly here.
 */
export function injectShellStyles(): void {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #gdp-settings-dialog {
      position: fixed; top: 50%; left: 50%; right: auto; bottom: auto;
      transform: translate(-50%, -50%);
      margin: 0; padding: 0; border: none;
      background: transparent; box-shadow: none;
      width: auto; height: auto; min-width: 0; min-height: 0;
      max-width: 100vw; max-height: 100vh; overflow: visible;
    }

    #gdp-settings-dialog::backdrop {
      background: rgba(10, 12, 16, 0.45);
      backdrop-filter: blur(4px);
    }

    #gdp-settings-dialog[open]::backdrop { animation: gdp-shell-fade 0.22s ease both; }
    #gdp-settings-dialog[open] .gdp-shell {
      animation: gdp-shell-pop 0.26s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes gdp-shell-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes gdp-shell-pop {
      from { opacity: 0; transform: scale(0.975) translateY(8px); }
      to   { opacity: 1; transform: none; }
    }

    #gdp-settings-dialog .gdp-shell {
      display: flex;
      width: 880px; max-width: 94vw;
      height: 610px; max-height: 88vh;
      overflow: hidden;
      border: 1px solid rgba(127, 137, 149, 0.35);
      border-radius: 12px;
      /* Paint GitHub Desktop's own background until the UI takes over, so a
         dark theme never flashes white while the bundle mounts. */
      background: var(--background-color, #ffffff);
      box-shadow:
        0 16px 48px -12px rgba(0, 0, 0, 0.28),
        0 4px 12px -4px rgba(0, 0, 0, 0.12);
    }

    #gdp-settings-dialog .gdp-shell > * { flex: 1 1 auto; min-width: 0; }
    #gdp-settings-dialog iframe.gdp-frame { border: 0; display: block; }
  `
  document.head.appendChild(style)
}
