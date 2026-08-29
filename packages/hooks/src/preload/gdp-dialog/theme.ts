import type { Theme } from '@github-desktop-plus/shared'

/**
 * GitHub Desktop's theme is a single class on <body> (renderer.css only ever
 * defines `body.theme-dark`; anything else is the light theme), and it toggles
 * live when the user switches themes or the OS does.
 */
export function currentTheme(): Theme {
  return document.body.classList.contains('theme-dark') ? 'dark' : 'light'
}

/** Calls back on every theme change. Returns an unsubscribe function. */
export function watchTheme(onChange: (theme: Theme) => void): () => void {
  let last = currentTheme()
  const observer = new MutationObserver(() => {
    const next = currentTheme()
    if (next === last) return
    last = next
    onChange(next)
  })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
