/**
 * Hook entry point injected into GitHub Desktop's Electron main process
 * via V8 Inspector before GitHub Desktop's main.js runs.
 *
 * Strategy (based on Electron 40 module diagnostics):
 *   - electron module properties (autoUpdater, BrowserWindow, etc.) are
 *     non-configurable getters and CANNOT be replaced via Object.defineProperty.
 *   - BUT the objects themselves are mutable: autoUpdater.checkForUpdates is writable.
 *   - app.on('browser-window-created') works for intercepting new windows.
 *   - session.defaultSession.webRequest can intercept network requests.
 *   - Menu.buildFromTemplate can be monkey-patched for menu i18n.
 *
 * So we use Electron's own event APIs instead of trying to replace module exports.
 *
 * Directory: GDP_HOOK_DIR env var set by the Rust launcher.
 */

import { parseConfig, type HookConfig } from './config'
import { configureLogLevel, gdpLog, LOG_JSON_FILE, resetLogStream } from './logger'
import { setupTelemetryBlocker } from './telemetry-blocker'
import { blockUpdates } from './update-blocker'
import { setupGdpIpc } from './ipc'

const _fs: typeof import('fs') = require('fs')
const _path: typeof import('path') = require('path')

type StoredConfig = {
  updates?: {
    disabled?: unknown
    block_manual_check?: unknown
  }
  telemetry?: {
    disabled?: unknown
  }
  logging?: {
    level?: unknown
  }
  i18n?: {
    enabled?: unknown
    locale?: unknown
  }
  ui?: {
    recent_repos_limit?: unknown
  }
  ai?: {
    enabled?: unknown
    base_url?: unknown
    api_key?: unknown
    model?: unknown
    system_prompt?: unknown
    timeout_secs?: unknown
    fallback_to_copilot?: unknown
  }
}

function boolOrCurrent(value: unknown, current: boolean): boolean {
  return typeof value === 'boolean' ? value : current
}

function stringOrCurrent(value: unknown, current: string): string {
  return typeof value === 'string' ? value : current
}

// Swap a shared record's contents in place — consumers hold the reference.
function replaceRecordContents<T>(target: Record<string, T>, next: Record<string, T>): void {
  for (const key of Object.keys(target)) {
    delete target[key]
  }
  Object.assign(target, next)
}

function positiveIntOrCurrent(value: unknown, current: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return current
  }
  return Math.max(1, Math.floor(parsed))
}

function applyStoredConfig(config: HookConfig, stored: StoredConfig): boolean {
  const before = JSON.stringify(config)

  config.blockUpdates = boolOrCurrent(stored.updates?.disabled, config.blockUpdates)
  config.blockManualUpdateCheck = boolOrCurrent(
    stored.updates?.block_manual_check,
    config.blockManualUpdateCheck
  )
  config.blockTelemetry = boolOrCurrent(stored.telemetry?.disabled, config.blockTelemetry)
  config.logLevel = stringOrCurrent(stored.logging?.level, config.logLevel)
  config.enableI18n = boolOrCurrent(stored.i18n?.enabled, config.enableI18n)
  config.locale = stringOrCurrent(stored.i18n?.locale, config.locale)
  config.recentReposLimit = positiveIntOrCurrent(
    stored.ui?.recent_repos_limit,
    config.recentReposLimit
  )
  if (stored.ai && typeof stored.ai === 'object') {
    config.ai = {
      enabled: boolOrCurrent(stored.ai.enabled, config.ai.enabled),
      baseUrl: stringOrCurrent(stored.ai.base_url, config.ai.baseUrl),
      model: stringOrCurrent(stored.ai.model, config.ai.model),
      systemPrompt: stringOrCurrent(stored.ai.system_prompt, config.ai.systemPrompt),
      timeoutSecs: typeof stored.ai.timeout_secs === 'number' ? stored.ai.timeout_secs : config.ai.timeoutSecs,
      fallbackToCopilot: boolOrCurrent(stored.ai.fallback_to_copilot, config.ai.fallbackToCopilot),
    }
  }

  return JSON.stringify(config) !== before
}

// ── Locale reload watcher (poll <dataDir>/.gdp-locale-reload) ──────────────
// The Rust serve.rs writes to this marker file after any locale CRUD.
// We re-read translation files when its mtime changes.
let _reloadCallbacks: Array<() => void> = []
function _watchLocaleReload(dataDir: string): void {
  if (!dataDir) return
  const marker = _path.join(dataDir, '.gdp-locale-reload')
  try {
    _fs.watchFile(marker, { interval: 1500 }, () => {
      for (const cb of _reloadCallbacks) {
        try { cb() } catch { /* ignore */ }
      }
    })
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// 2. Menu i18n — monkey-patch Menu.buildFromTemplate to translate labels
//    This is how the community tool achieves accurate menu translation.
//    Menus are created in main process via Electron Menu API, not in DOM.
// ---------------------------------------------------------------------------
interface MenuItem {
  id?: string
  label?: string
  submenu?: MenuItem[]
  role?: string
  type?: string
  enabled?: boolean
  accelerator?: string
  click?: () => void
}

interface TrackedWebContents {
  executeJavaScript(code: string): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

type LocaleCategory = Record<string, unknown>
type LocaleBundle = Record<string, LocaleCategory>

function localeBundlePath(dir: string, locale: string, dataDir: string): string {
  if (dataDir) {
    return _path.join(dataDir, 'locales', `${locale}.json`)
  }
  return _path.join(dir, '..', 'locales', `${locale}.json`)
}

function loadLocaleBundle(dir: string, locale: string, dataDir: string): LocaleBundle {
  const filePath = localeBundlePath(dir, locale, dataDir)
  try {
    const parsed = JSON.parse(_fs.readFileSync(filePath, 'utf-8')) as LocaleBundle
    gdpLog(`Loaded locale package from ${filePath}`, 'info', 'i18n')
    return parsed
  } catch (e) {
    gdpLog(`Locale package unavailable: ${filePath} (${e})`, 'warn', 'i18n')
    return {}
  }
}

function flattenLocaleBundle(
  bundle: LocaleBundle,
  excludedCategories: ReadonlySet<string>
): Record<string, string> {
  const translations: Record<string, string> = {}
  for (const [category, entries] of Object.entries(bundle)) {
    if (excludedCategories.has(category) || !entries || typeof entries !== 'object') {
      continue
    }
    const copy = { ...entries }
    delete copy._meta
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value === 'string') {
        translations[key] = value
      }
    }
  }
  return translations
}

function loadMenuTranslations(dir: string, locale: string, dataDir: string): Record<string, string> {
  const menu = loadLocaleBundle(dir, locale, dataDir).menu ?? {}
  const translations: Record<string, string> = {}
  for (const [key, value] of Object.entries(menu)) {
    if (typeof value === 'string') {
      translations[key] = value
    }
  }
  delete translations._meta
  gdpLog(`Loaded ${Object.keys(translations).length} menu translations from aggregate package`, 'info', 'menu')
  return translations
}

function buildTranslationPattern(pattern: string): {
  readonly regex: RegExp
  readonly names: ReadonlyArray<string>
} | null {
  const token = /(\{\{(\w+)\}\}|\{(\w+)\})/g
  const names = new Array<string>()
  let cursor = 0
  let regexSource = ''

  for (const match of pattern.matchAll(token)) {
    const raw = match[0]
    const name = match[2] ?? match[3]
    const index = match.index ?? -1
    if (!raw || !name || index < 0) {
      continue
    }

    regexSource += pattern
      .slice(cursor, index)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    regexSource += '(.+)'
    names.push(name)
    cursor = index + raw.length
  }

  if (names.length === 0) {
    return null
  }

  regexSource += pattern.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
    regex: new RegExp(`^${regexSource}$`),
    names,
  }
}

function translateLabel(
  label: string,
  translations: Record<string, string>
): string | null {
  const exact = translations[label]
  if (exact !== undefined) {
    return exact
  }

  for (const [pattern, replacement] of Object.entries(translations).sort((a, b) => b[0].length - a[0].length)) {
    const compiled = buildTranslationPattern(pattern)
    if (compiled === null) {
      continue
    }

    const match = label.match(compiled.regex)
    if (match === null) {
      continue
    }

    let translated = replacement
    compiled.names.forEach((name, index) => {
      const value = match[index + 1] ?? ''
      translated = translated.replace(`{{${name}}}`, value)
      translated = translated.replace(`{${name}}`, value)
    })
    return translated
  }

  return null
}

function translateMenuItem(item: MenuItem, translations: Record<string, string>): void {
  if (item.label) {
    const translated = translateLabel(item.label, translations)
    if (translated) {
      gdpLog(`Menu: "${item.label}" → "${translated}"`, 'info', 'menu')
      item.label = translated
    }
  }
  if (item.submenu && Array.isArray(item.submenu)) {
    for (const sub of item.submenu) {
      translateMenuItem(sub, translations)
    }
  }
}

// setupMenuI18n removed — replaced by setupGDPMenu which handles both i18n and GDP menu injection

// ---------------------------------------------------------------------------
// 3. Renderer i18n — use app.on('browser-window-created') + executeJavaScript
// ---------------------------------------------------------------------------
function loadUiTranslations(dir: string, locale: string, dataDir: string): Record<string, string> {
  const translations = flattenLocaleBundle(loadLocaleBundle(dir, locale, dataDir), new Set(['menu']))
  gdpLog(`Loaded ${Object.keys(translations).length} UI translations from aggregate package`, 'info', 'i18n')
  return translations
}

// Anchor-based disambiguation overrides. Each category may carry an `_overrides`
// map { englishKey: [{ anchor, value }] } that lets the same English string
// resolve to different translations depending on the DOM subtree it appears in.
// Collected here (menu excluded, like translations) and pushed to the renderer
// as window.__GDP_OVERRIDES__.
type OverrideEntry = { anchor: string; value: string }

function collectOverrides(
  bundle: LocaleBundle,
  excludedCategories: ReadonlySet<string>
): Record<string, OverrideEntry[]> {
  const overrides: Record<string, OverrideEntry[]> = {}
  for (const [category, entries] of Object.entries(bundle)) {
    if (excludedCategories.has(category) || !entries || typeof entries !== 'object') {
      continue
    }
    const raw = (entries as Record<string, unknown>)._overrides
    if (!raw || typeof raw !== 'object') {
      continue
    }
    for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) {
        continue
      }
      const valid = list.filter(
        (entry): entry is OverrideEntry =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as OverrideEntry).anchor === 'string' &&
          typeof (entry as OverrideEntry).value === 'string'
      )
      if (valid.length > 0) {
        overrides[key] = (overrides[key] ?? []).concat(valid)
      }
    }
  }
  return overrides
}

function loadUiOverrides(dir: string, locale: string, dataDir: string): Record<string, OverrideEntry[]> {
  const overrides = collectOverrides(loadLocaleBundle(dir, locale, dataDir), new Set(['menu']))
  const count = Object.keys(overrides).length
  if (count > 0) {
    gdpLog(`Loaded ${count} anchor override keys`, 'info', 'i18n')
  }
  return overrides
}

function setupRendererI18n(
  app: { on(event: string, cb: (...args: unknown[]) => void): void },
  uiTranslations: Record<string, string>,
  uiOverrides: Record<string, OverrideEntry[]>,
  dir: string,
  config: HookConfig
): TrackedWebContents[] {
  const preloadPath = _path.join(dir, 'preload', 'index.js')
  if (!_fs.existsSync(preloadPath)) {
    gdpLog(`Preload not found: ${preloadPath}`, 'error', 'i18n')
    return []
  }

  const translationCount = Object.keys(uiTranslations).length
  gdpLog(`Loaded ${translationCount} UI translation entries for ${config.locale}`, 'info', 'i18n')

  let preloadCode: string
  try {
    preloadCode = _fs.readFileSync(preloadPath, 'utf-8')
  } catch {
    gdpLog(`Cannot read preload: ${preloadPath}`, 'error', 'i18n')
    return []
  }

  // Build injection script — navbar injection is included as a separate module
  const recentRepositoriesPath = _path.join(dir, 'preload', 'recent-repositories.js')
  let recentRepositoriesCode = ''
  try {
    if (_fs.existsSync(recentRepositoriesPath)) {
      recentRepositoriesCode = _fs.readFileSync(recentRepositoriesPath, 'utf-8')
      gdpLog('Recent repositories script loaded', 'info', 'system')
    }
  } catch { /* optional */ }

  const navbarPath = _path.join(dir, 'preload', 'navbar.js')
  let navbarCode = ''
  try {
    if (_fs.existsSync(navbarPath)) {
      navbarCode = _fs.readFileSync(navbarPath, 'utf-8')
      gdpLog('Navbar injection script loaded', 'info', 'navbar')
    }
  } catch { /* optional */ }

  // Update interceptor — intercepts "Check for Updates" button in About dialog
  const updateInterceptorPath = _path.join(dir, 'preload', 'update-interceptor.js')
  let updateInterceptorCode = ''
  try {
    if (_fs.existsSync(updateInterceptorPath)) {
      updateInterceptorCode = _fs.readFileSync(updateInterceptorPath, 'utf-8')
      gdpLog('Update interceptor script loaded', 'info', 'update')
    }
  } catch { /* optional */ }

  // Copilot button hijack — redirects AI commit generation to user-configured endpoint
  const copilotHijackPath = _path.join(dir, 'preload', 'copilot-hijack.js')
  let copilotHijackCode = ''
  try {
    if (_fs.existsSync(copilotHijackPath)) {
      copilotHijackCode = _fs.readFileSync(copilotHijackPath, 'utf-8')
      gdpLog('Copilot hijack script loaded', 'info', 'system')
    }
  } catch { /* optional */ }

  // GDP settings dialog — native DOM dialog with 4 tabs
  const gdpDialogPath = _path.join(dir, 'preload', 'gdp-dialog.js')
  let gdpDialogCode = ''
  try {
    if (_fs.existsSync(gdpDialogPath)) {
      gdpDialogCode = _fs.readFileSync(gdpDialogPath, 'utf-8')
      gdpLog('GDP dialog script loaded', 'info', 'system')
    }
  } catch { /* optional */ }

  const buildInjectScript = () => `(function(){` +
    `window.__GDP_TRANSLATIONS__=${JSON.stringify(uiTranslations)};` +
    `window.__GDP_OVERRIDES__=${JSON.stringify(uiOverrides)};` +
    `window.__GDP_CONFIG__=${JSON.stringify(config)};` +
    `window.__GDP_LOG_FILE__=${JSON.stringify(LOG_JSON_FILE)};` +
    `${preloadCode}` +
    (navbarCode ? `\n${navbarCode}` : '') +
    (updateInterceptorCode ? `\n${updateInterceptorCode}` : '') +
    (copilotHijackCode ? `\n${copilotHijackCode}` : '') +
    (gdpDialogCode ? `\n${gdpDialogCode}` : '') +
    `})();`

  const buildEarlyInjectScript = () => recentRepositoriesCode
    ? `(function(){window.__GDP_CONFIG__=${JSON.stringify(config)};\n${recentRepositoriesCode}\n})();`
    : ''

  // Track active webContents for hot-reload push
  const activeWebContents: TrackedWebContents[] = []

  app.on('browser-window-created', (...args: unknown[]) => {
    const win = args[1] as {
      webContents: {
        on(event: string, cb: () => void): void
        once(event: string, cb: () => void): void
        executeJavaScript(code: string): Promise<unknown>
        send(channel: string, ...args: unknown[]): void
        isDestroyed(): boolean
      }
    }
    gdpLog('browser-window-created — attaching i18n + navbar + update-interceptor injection', 'info', 'i18n')

    activeWebContents.push(win.webContents)
    win.webContents.once('destroyed', () => {
      const idx = activeWebContents.indexOf(win.webContents)
      if (idx >= 0) activeWebContents.splice(idx, 1)
    })

    let earlyInjected = false
    const injectEarly = () => {
      const earlyInjectScript = buildEarlyInjectScript()
      if (!earlyInjectScript || earlyInjected || win.webContents.isDestroyed()) {
        return
      }
      win.webContents.executeJavaScript(earlyInjectScript)
        .then(() => { earlyInjected = true })
        .catch(() => {})
    }

    win.webContents.on('did-start-loading', injectEarly)
    win.webContents.on('dom-ready', injectEarly)

    win.webContents.on('did-finish-load', () => {
      gdpLog('did-finish-load — injecting scripts', 'info', 'i18n')
      injectEarly()
      win.webContents.executeJavaScript(buildInjectScript()).catch((e: unknown) => {
        gdpLog(`executeJavaScript failed: ${e}`, 'error', 'i18n')
      })
    })
  })
  gdpLog('Renderer i18n injection registered', 'info', 'i18n')

  // Return activeWebContents so hot-reload watcher can push translation updates
  return activeWebContents
}

// ---------------------------------------------------------------------------
// 5. GDP Menu — inject a "GDP" top-level menu into the menu bar
//    Independent of i18n toggle — always injected when hooks are active.
// ---------------------------------------------------------------------------

interface GDPBrowserWindowConstructor {
  new(options: Record<string, unknown>): unknown
  getFocusedWindow?: () => { webContents: TrackedWebContents } | null
  getAllWindows?: () => Array<{ webContents: TrackedWebContents }>
}

function sendToFocusedWindow(
  BrowserWindow: GDPBrowserWindowConstructor,
  channel: string,
  ...args: unknown[]
): void {
  const wins = BrowserWindow.getAllWindows?.() ?? []
  const win = BrowserWindow.getFocusedWindow?.() ?? wins[0] ?? null
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}

// Single item — GHD's Windows menu bar only renders top-level *submenus*, so the
// "GDP" entry must be a dropdown; clicking its one item opens the dialog. The
// dialog's own sidebar covers AI / logs / locales, so no submenu clutter is
// needed. The Ctrl+Alt+G accelerator is shown on the item and registered by
// Electron (the global shortcut in setupGDPShortcut gives one-key open too).
function buildGDPMenuItems(BrowserWindow: GDPBrowserWindowConstructor): MenuItem[] {
  return [
    {
      id: 'gdp.open',
      label: 'GDP 设置',
      accelerator: 'CmdOrCtrl+Alt+G',
      click: () => { sendToFocusedWindow(BrowserWindow, 'gdp:show-dialog', { tab: 'general' }) },
    },
  ]
}

function setupGDPMenu(
  Menu: { buildFromTemplate(template: MenuItem[]): unknown },
  BrowserWindow: GDPBrowserWindowConstructor,
  menuTranslationsRef: { current: Record<string, string> }
): void {
  const originalBuild = Menu.buildFromTemplate.bind(Menu)
  let isBuildingMenu = false

  Menu.buildFromTemplate = function (template: MenuItem[]): unknown {
    if (isBuildingMenu) {
      return originalBuild(template)
    }

    isBuildingMenu = true

    // Translate menu labels if i18n is enabled — read the ref LIVE so a
    // runtime language switch applies on the next menu rebuild.
    try {
      const menuTranslations = menuTranslationsRef.current
      if (Object.keys(menuTranslations).length > 0) {
        for (const item of template) {
          translateMenuItem(item, menuTranslations)
        }
      }

      const nextTemplate = template.slice()
      const hasGDPMenu = nextTemplate.some(item => item.id === 'gdp')

      if (!hasGDPMenu) {
        const gdpMenu: MenuItem = {
          id: 'gdp',
          label: 'GDP',
          submenu: buildGDPMenuItems(BrowserWindow),
        }

        // Insert before Help when present, otherwise append to end.
        const helpIdx = nextTemplate.findIndex(
          (item) => item.label === '&Help' || item.label === '帮助(&H)' || item.role === 'help'
        )

        if (helpIdx >= 0) {
          nextTemplate.splice(helpIdx, 0, gdpMenu)
        } else {
          nextTemplate.push(gdpMenu)
        }
      }

      return originalBuild(nextTemplate)
    } finally {
      isBuildingMenu = false
    }
  }
  gdpLog('Menu.buildFromTemplate patched (i18n + GDP menu)', 'info', 'menu')
}

// ---------------------------------------------------------------------------
// 5b. Global Shortcut — Ctrl/Cmd+Alt+G sends gdp:show-dialog to focused window
// ---------------------------------------------------------------------------
function setupGDPShortcut(
  app: { isReady(): boolean; whenReady(): Promise<void> },
  globalShortcut: {
    register(accelerator: string, cb: () => void): boolean
    isRegistered(accelerator: string): boolean
  },
  BrowserWindow: GDPBrowserWindowConstructor,
): void {
  const ACCELERATOR = 'CommandOrControl+Alt+G'
  const register = () => {
    try {
      if (globalShortcut.isRegistered(ACCELERATOR)) return
      const ok = globalShortcut.register(ACCELERATOR, () => {
        gdpLog('Global shortcut triggered — opening GDP settings dialog', 'info', 'system')
        sendToFocusedWindow(BrowserWindow, 'gdp:show-dialog', { tab: 'general' })
      })
      gdpLog(
        ok ? `Global shortcut registered: ${ACCELERATOR}` : `Global shortcut failed: ${ACCELERATOR}`,
        ok ? 'info' : 'warn',
        'system'
      )
    } catch (e) {
      gdpLog(`Global shortcut error: ${e}`, 'error', 'system')
    }
  }
  if (app.isReady()) { register() }
  else { app.whenReady().then(register).catch(() => {}) }
}

// ---------------------------------------------------------------------------
// 6. Locale Hot-Reload — watch the aggregate locale package
//    and push updated translations to active renderers.
// ---------------------------------------------------------------------------
function setupLocaleHotReload(
  dir: string,
  config: HookConfig,
  activeWebContents: TrackedWebContents[],
  holders: {
    uiTranslations: Record<string, string>
    uiOverrides: Record<string, OverrideEntry[]>
    menuTranslationsRef: { current: Record<string, string> }
  }
): void {
  const watchDir = _path.dirname(localeBundlePath(dir, config.locale, config.dataDir))

  if (!_fs.existsSync(watchDir)) {
    gdpLog(`No locale package directory to watch: ${watchDir}`, 'warn', 'i18n')
    return
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const onFileChange = (_eventType: string, filename: string | null) => {
    // config.locale can change at runtime — resolve the watched name per event.
    if (!config.enableI18n) return
    const watchName = _path.basename(localeBundlePath(dir, config.locale, config.dataDir))
    if (filename && filename !== watchName) return
    // Debounce — coalesce rapid changes
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const localeFile = localeBundlePath(dir, config.locale, config.dataDir)
      gdpLog(`Locale package changed: ${localeFile} — hot-reloading translations`, 'info', 'i18n')

      // Reload UI translations + anchor overrides; keep the injection holders
      // in sync so later renderer reloads see the same data.
      const newUiTranslations = loadUiTranslations(dir, config.locale, config.dataDir)
      const newUiOverrides = loadUiOverrides(dir, config.locale, config.dataDir)
      replaceRecordContents(holders.uiTranslations, newUiTranslations)
      replaceRecordContents(holders.uiOverrides, newUiOverrides)
      const updateScript = `(function(){` +
        `var newT=${JSON.stringify(newUiTranslations)};` +
        `var newO=${JSON.stringify(newUiOverrides)};` +
        `var oldT=window.__GDP_TRANSLATIONS__||{};` +
        `var changed=false;` +
        `for(var k in newT){if(oldT[k]!==newT[k]){changed=true;break;}}` +
        `if(!changed){for(var k in oldT){if(!(k in newT)){changed=true;break;}}}` +
        // Overrides are compared structurally — any diff forces a re-translate.
        `if(!changed){changed=JSON.stringify(window.__GDP_OVERRIDES__||{})!==JSON.stringify(newO);}` +
        `if(changed){` +
        `window.__GDP_TRANSLATIONS__=newT;` +
        `window.__GDP_OVERRIDES__=newO;` +
        `console.log("[GDP i18n] Hot-reload: "+Object.keys(newT).length+" entries updated");` +
        // Re-translate the entire document body
        `if(window.__gdpTranslateTree&&document.body){window.__gdpTranslateTree(document.body);}` +
        `}else{console.log("[GDP i18n] Hot-reload: no changes detected");}` +
        `})();`

      // Push to all active renderers
      const alive = activeWebContents.filter(wc => !wc.isDestroyed())
      for (const wc of alive) {
        wc.executeJavaScript(updateScript).catch((e: unknown) => {
          gdpLog(`Hot-reload push failed: ${e}`, 'error', 'i18n')
        })
      }

      const newMenuTranslations = loadMenuTranslations(dir, config.locale, config.dataDir)
      holders.menuTranslationsRef.current = newMenuTranslations
      gdpLog(`Menu translations reloaded (${Object.keys(newMenuTranslations).length} entries)`, 'info', 'menu')
    }, 300)
  }

  try {
    _fs.watch(watchDir, { persistent: false }, onFileChange)
    gdpLog(`Watching locale package directory: ${watchDir}`, 'info', 'i18n')
  } catch (e) {
    gdpLog(`Failed to watch ${watchDir}: ${e}`, 'warn', 'i18n')
  }
}

// ---------------------------------------------------------------------------
// 5c. Early preload — register recent-repositories.js as a REAL Electron
//     preload script so it runs before any page script.  The previous
//     executeJavaScript("did-start-loading") approach raced against the app:
//     GHD reads + truncates the recently-selected-repositories key during
//     boot, before executeJavaScript ever runs, so the storage/slice patches
//     landed too late and the configured limit never applied.
//     GHD windows use nodeIntegration + no sandbox, so the preload shares the
//     page's window object.
// ---------------------------------------------------------------------------
interface GDPSessionModule {
  defaultSession?: {
    registerPreloadScript?(script: { type: string; filePath: string }): unknown
    setPreloads?(paths: string[]): void
    getPreloads?(): string[]
  }
}

interface GDPAppModule {
  isReady(): boolean
  on(event: string, cb: (...args: unknown[]) => void): void
}

function setupEarlyPreload(
  app: GDPAppModule,
  session: GDPSessionModule,
  dir: string,
  config: HookConfig
): (() => void) | null {
  const sourcePath = _path.join(dir, 'preload', 'recent-repositories.js')
  const earlyPath = _path.join(dir, 'preload', 'gdp-early.js')

  const writeEarlyPreload = (): boolean => {
    try {
      const code = _fs.readFileSync(sourcePath, 'utf-8')
      const content =
        `try{window.__GDP_CONFIG__=${JSON.stringify(config)};\n` +
        `${code}\n` +
        `}catch(e){console.warn('[GDP] early preload failed',e)}`
      _fs.writeFileSync(earlyPath, content)
      return true
    } catch (e) {
      gdpLog(`Early preload write failed: ${e}`, 'warn', 'system')
      return false
    }
  }

  if (!writeEarlyPreload()) {
    return null
  }

  const register = () => {
    try {
      const ses = session.defaultSession
      if (!ses) {
        gdpLog('defaultSession unavailable — early preload not registered', 'warn', 'system')
        return
      }
      if (typeof ses.registerPreloadScript === 'function') {
        ses.registerPreloadScript({ type: 'frame', filePath: earlyPath })
        gdpLog(`Early preload registered (registerPreloadScript): ${earlyPath}`, 'info', 'system')
      } else if (typeof ses.setPreloads === 'function') {
        const existing = typeof ses.getPreloads === 'function' ? ses.getPreloads() : []
        ses.setPreloads([...existing, earlyPath])
        gdpLog(`Early preload registered (setPreloads): ${earlyPath}`, 'info', 'system')
      } else {
        gdpLog('No preload registration API — early patches degrade to late injection', 'warn', 'system')
      }
    } catch (e) {
      gdpLog(`Early preload registration failed: ${e}`, 'error', 'system')
    }
  }

  // Our 'ready' listener is attached before GHD's main.js runs, so it fires
  // ahead of GHD's own ready handler — i.e. before any BrowserWindow exists.
  if (app.isReady()) {
    register()
  } else {
    app.on('ready', register)
  }

  return writeEarlyPreload
}

function pushRuntimeConfig(
  config: HookConfig,
  activeWebContents: TrackedWebContents[]
): void {
  const updateScript = `(function(){` +
    `window.__GDP_CONFIG__=${JSON.stringify(config)};` +
    `if(typeof window.__gdpApplyRecentReposLimit==="function"){window.__gdpApplyRecentReposLimit();}` +
    // Notify renderer features (e.g. the Copilot-button hijack) that config
    // changed, so an AI toggle takes effect without an app relaunch.
    `try{window.dispatchEvent(new Event('gdp:config-updated'));}catch(e){}` +
    `})();`

  const alive = activeWebContents.filter(wc => !wc.isDestroyed())
  for (const wc of alive) {
    wc.executeJavaScript(updateScript).catch((e: unknown) => {
      gdpLog(`Runtime config push failed: ${e}`, 'error', 'system')
    })
  }
}

function setupConfigHotReload(
  config: HookConfig,
  activeWebContents: TrackedWebContents[],
  onConfigChanged?: () => void
): void {
  if (!config.configDir) {
    return
  }

  const configPath = _path.join(config.configDir, 'config.json')
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const reload = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      try {
        const parsed = JSON.parse(_fs.readFileSync(configPath, 'utf-8')) as StoredConfig
        if (applyStoredConfig(config, parsed)) {
          configureLogLevel(config.logLevel)
          pushRuntimeConfig(config, activeWebContents)
          onConfigChanged?.()
          gdpLog(`Runtime config reloaded from ${configPath}`, 'info', 'system')
        }
      } catch (e) {
        gdpLog(`Runtime config reload skipped: ${e}`, 'warn', 'system')
      }
    }, 250)
  }

  try {
    _fs.watchFile(configPath, { interval: 1000 }, reload)
    gdpLog(`Watching runtime config: ${configPath}`, 'info', 'system')
  } catch (e) {
    gdpLog(`Failed to watch runtime config: ${e}`, 'warn', 'system')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  // Suppress EPIPE errors on stdout/stderr.
  // GitHub Desktop's stderr is piped to the Rust launcher process.
  // If the read end of that pipe is closed (e.g. daemon exits early or the
  // background reader thread terminates), Node.js raises an EPIPE error on
  // the next write.  Without an 'error' handler the error becomes an uncaught
  // exception and GitHub Desktop shows the "encountered an error" dialog.
  const _silenceEpipe = (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  }
  try { process.stdout.on('error', _silenceEpipe) } catch { /* ignore */ }
  try { process.stderr.on('error', _silenceEpipe) } catch { /* ignore */ }

  const config = parseConfig()
  const dir = process.env.GDP_HOOK_DIR || __dirname

  configureLogLevel(config.logLevel)
  resetLogStream()

  gdpLog('====== GitHub Desktop Plus hooks loading ======')
  gdpLog(`Config: ${JSON.stringify(config)}`)
  gdpLog(`hookDir: ${dir}`)

  // Subscribe to Rust-side locale CRUD reload events.
  if (config.dataDir) _watchLocaleReload(config.dataDir)

  let electron: Record<string, unknown>
  try {
    electron = require('electron') as Record<string, unknown>
  } catch (e) {
    gdpLog(`Failed to require("electron"): ${e}`, 'error', 'system')
    return
  }

  // 1. Auto-update blocking — always patched; each call consults live config,
  //    so the settings toggle applies at runtime without a relaunch.
  if (electron.autoUpdater) {
    blockUpdates(electron.autoUpdater as Record<string, unknown>, () => config.blockUpdates)
  }

  // 2. Menu patching — always inject GDP menu, optionally translate labels.
  //    Translations live in a mutable ref so a runtime language switch applies
  //    on the next menu rebuild.
  const menuTranslationsRef = {
    current: config.enableI18n ? loadMenuTranslations(dir, config.locale, config.dataDir) : {},
  }

  if (electron.Menu && electron.BrowserWindow) {
    setupGDPMenu(
      electron.Menu as { buildFromTemplate(template: MenuItem[]): unknown },
      electron.BrowserWindow as GDPBrowserWindowConstructor,
      menuTranslationsRef
    )
  }

  // 2b. Global keyboard shortcut — Ctrl/Cmd+Alt+G opens GDP settings dialog in renderer
  if (electron.app && electron.globalShortcut && electron.BrowserWindow) {
    setupGDPShortcut(
      electron.app as { isReady(): boolean; whenReady(): Promise<void> },
      electron.globalShortcut as {
        register(accelerator: string, cb: () => void): boolean
        isRegistered(accelerator: string): boolean
      },
      electron.BrowserWindow as GDPBrowserWindowConstructor,
    )
  }

  // 2c. Early preload — recent-repositories patches must run before page
  //     scripts (GHD truncates the recent-repos key during boot).
  let regenerateEarlyPreload: (() => void) | null = null
  if (electron.app && electron.session) {
    regenerateEarlyPreload = setupEarlyPreload(
      electron.app as unknown as GDPAppModule,
      electron.session as GDPSessionModule,
      dir,
      config
    )
  }

  // 3. Renderer i18n + navbar + update-interceptor injection
  let activeWebContents: Array<{
    executeJavaScript(code: string): Promise<unknown>
    send(channel: string, ...args: unknown[]): void
    isDestroyed(): boolean
  }> = []

  // Mutable holders — buildInjectScript() serializes these at injection time,
  // so replacing their CONTENTS lets a renderer reload pick up new
  // translations (i18n toggle / locale switch) without an app relaunch.
  const uiTranslations: Record<string, string> = {}
  const uiOverrides: Record<string, OverrideEntry[]> = {}
  if (config.enableI18n) {
    Object.assign(uiTranslations, loadUiTranslations(dir, config.locale, config.dataDir))
    Object.assign(uiOverrides, loadUiOverrides(dir, config.locale, config.dataDir))
  }

  if (electron.app) {
    activeWebContents = setupRendererI18n(
      electron.app as { on(event: string, cb: (...args: unknown[]) => void): void },
      uiTranslations,
      uiOverrides,
      dir,
      config
    ) ?? []
  }

  // Apply a stored (snake_case) config into the live HookConfig and push it to
  // renderers. Used by both the file-watch (best-effort) and the IPC save path
  // (reliable — fs.watchFile can silently miss same-process writes on Windows).
  const applyConfigAndPush = (parsed: StoredConfig): void => {
    try {
      const prevEnableI18n = config.enableI18n
      const prevLocale = config.locale
      const changed = applyStoredConfig(config, parsed)
      gdpLog(`applyConfigAndPush: changed=${changed} ai.enabled=${config.ai.enabled} renderers=${activeWebContents.length}`, 'info', 'system')
      // Always push (even if our snake_case diff saw no change) so the renderer's
      // __GDP_CONFIG__ and the gdp:config-updated event are guaranteed fresh.
      configureLogLevel(config.logLevel)
      pushRuntimeConfig(config, activeWebContents)
      if (changed) regenerateEarlyPreload?.()

      // i18n toggled or locale switched: swap the translation holders and
      // soft-reload the renderers. did-finish-load re-injects everything with
      // the fresh data, so the language applies without an app relaunch.
      if (config.enableI18n !== prevEnableI18n || config.locale !== prevLocale) {
        replaceRecordContents(
          uiTranslations,
          config.enableI18n ? loadUiTranslations(dir, config.locale, config.dataDir) : {}
        )
        replaceRecordContents(
          uiOverrides,
          config.enableI18n ? loadUiOverrides(dir, config.locale, config.dataDir) : {}
        )
        menuTranslationsRef.current = config.enableI18n
          ? loadMenuTranslations(dir, config.locale, config.dataDir)
          : {}
        gdpLog(
          `i18n hot-apply: enabled=${config.enableI18n} locale=${config.locale} — reloading renderers`,
          'info', 'i18n'
        )
        // Slight delay so the settings dialog's "saved" feedback can render
        // before the page reloads. GHD registers a beforeunload guard that
        // silently cancels reloads, so allow the unload via
        // 'will-prevent-unload' and reload from the main process.
        setTimeout(() => {
          for (const wc of activeWebContents.filter(w => !w.isDestroyed())) {
            const full = wc as unknown as {
              reload?: () => void
              once?: (event: string, cb: (e: { preventDefault(): void }) => void) => void
            }
            try {
              full.once?.('will-prevent-unload', e => e.preventDefault())
              if (typeof full.reload === 'function') {
                full.reload()
              } else {
                wc.executeJavaScript('window.location.reload()').catch(() => {})
              }
            } catch (e) {
              gdpLog(`Renderer reload failed: ${e}`, 'error', 'i18n')
            }
          }
        }, 600)
      }
    } catch (e) {
      gdpLog(`applyConfigAndPush failed: ${e}`, 'error', 'system')
    }
  }

  setupConfigHotReload(config, activeWebContents, () => regenerateEarlyPreload?.())

  // 4. Telemetry interceptor — always installed; each request consults live
  //    config, so the toggle applies at runtime without a relaunch.
  if (electron.app && electron.session) {
    setupTelemetryBlocker(
      electron.app as {
        on(event: string, cb: () => void): void
        isReady(): boolean
        whenReady(): Promise<void>
      },
      electron.session as { defaultSession: { webRequest: {
        onBeforeRequest(
          filter: { urls: string[] },
          cb: (details: { url: string }, callback: (resp: { cancel: boolean }) => void) => void
        ): void
      } } },
      () => config.blockTelemetry
    )
  }

  // 5. Hot-reload for locale files — installed regardless of the current i18n
  //    state so enabling i18n at runtime still gets live locale edits.
  setupLocaleHotReload(dir, config, activeWebContents, {
    uiTranslations,
    uiOverrides,
    menuTranslationsRef,
  })

  // 6. GDP IPC bridge — config read/write, locale CRUD, logs, AI
  if (electron.ipcMain && electron.shell && electron.BrowserWindow) {
    setupGdpIpc(
      _path.join(config.configDir, 'config.json'),
      config.dataDir,
      electron.ipcMain as { handle(ch: string, fn: (...a: unknown[]) => unknown): void },
      electron.shell as { openPath(p: string): Promise<string>; showItemInFolder(p: string): void },
      electron.BrowserWindow as GDPBrowserWindowConstructor,
      activeWebContents,
      applyConfigAndPush,
    )
  }

  gdpLog('====== Hook setup complete ======')
}

main()
