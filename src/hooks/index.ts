/**
 * Hook entry point injected into GitHub Desktop's Electron main process
 * via patched main.js.
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
 * Directory: GDP_HOOK_DIR env var set by bun/index.ts (Bun hardcodes __dirname).
 */

interface HookConfig {
  blockUpdates: boolean
  blockTelemetry: boolean
  logLevel: string
  enableI18n: boolean
  locale: string
}

interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'block'
  category: 'update' | 'telemetry' | 'i18n' | 'menu' | 'system' | 'navbar'
  message: string
}

function parseConfig(): HookConfig {
  try {
    const raw = process.env.GDP_CONFIG
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { blockUpdates: true, blockTelemetry: true, logLevel: '', enableI18n: true, locale: 'zh-CN' }
}

const _fs: typeof import('fs') = require('fs')
const _path: typeof import('path') = require('path')
const _os: typeof import('os') = require('os')

const LOG_FILE = _path.join(_os.tmpdir(), 'gdp-hooks.log')
const LOG_JSON_FILE = _path.join(_os.tmpdir(), 'gdp-hooks-stream.jsonl')

/** Structured log — written as JSONL for streaming to frontend */
function gdpLog(msg: string, level: LogEntry['level'] = 'info', category: LogEntry['category'] = 'system'): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message: msg,
  }
  const line = `${entry.ts} [${entry.level.toUpperCase()}][${entry.category}] ${msg}`
  console.log(line)
  try {
    _fs.appendFileSync(LOG_FILE, line + '\n')
    _fs.appendFileSync(LOG_JSON_FILE, JSON.stringify(entry) + '\n')
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// 1. Update Blocker — monkey-patch autoUpdater methods (they are writable)
// ---------------------------------------------------------------------------
function blockUpdates(autoUpdater: Record<string, unknown>): void {
  try {
    autoUpdater.checkForUpdates = () => {
      gdpLog('autoUpdater.checkForUpdates() blocked', 'block', 'update')
    }
    autoUpdater.quitAndInstall = () => {
      gdpLog('autoUpdater.quitAndInstall() blocked', 'block', 'update')
    }
    autoUpdater.setFeedURL = (..._args: unknown[]) => {
      gdpLog('autoUpdater.setFeedURL() blocked', 'block', 'update')
    }
    gdpLog('autoUpdater methods overridden — updates blocked', 'info', 'update')
  } catch (e) {
    gdpLog(`autoUpdater patch failed: ${e}`, 'error', 'update')
  }
}

// ---------------------------------------------------------------------------
// 2. Menu i18n — monkey-patch Menu.buildFromTemplate to translate labels
//    This is how the community tool achieves accurate menu translation.
//    Menus are created in main process via Electron Menu API, not in DOM.
// ---------------------------------------------------------------------------
interface MenuItem {
  label?: string
  submenu?: MenuItem[]
  role?: string
  type?: string
}

function loadMenuTranslations(dir: string, locale: string): Record<string, string> {
  const menuFile = _path.join(dir, '..', 'locales', locale, 'menu.json')
  try {
    const data = JSON.parse(_fs.readFileSync(menuFile, 'utf-8'))
    // Remove _meta key
    delete data._meta
    gdpLog(`Loaded ${Object.keys(data).length} menu translations from ${menuFile}`, 'info', 'menu')
    return data
  } catch {
    gdpLog(`Menu locale file not found: ${menuFile}`, 'warn', 'menu')
    return {}
  }
}

function translateMenuItem(item: MenuItem, translations: Record<string, string>): void {
  if (item.label) {
    const translated = translations[item.label]
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

function setupMenuI18n(
  Menu: { buildFromTemplate(template: MenuItem[]): unknown },
  translations: Record<string, string>
): void {
  if (Object.keys(translations).length === 0) return

  const originalBuild = Menu.buildFromTemplate.bind(Menu)
  Menu.buildFromTemplate = function (template: MenuItem[]): unknown {
    for (const item of template) {
      translateMenuItem(item, translations)
    }
    return originalBuild(template)
  }
  gdpLog('Menu.buildFromTemplate patched for i18n', 'info', 'menu')
}

// ---------------------------------------------------------------------------
// 3. Renderer i18n — use app.on('browser-window-created') + executeJavaScript
// ---------------------------------------------------------------------------
function loadUiTranslations(dir: string, locale: string): Record<string, string> {
  const uiFile = _path.join(dir, '..', 'locales', locale, 'ui.json')
  try {
    const data = JSON.parse(_fs.readFileSync(uiFile, 'utf-8'))
    delete data._meta
    return data
  } catch {
    // Fallback to flat locale file
    const flatFile = _path.join(dir, '..', 'locales', `${locale}.json`)
    try {
      return JSON.parse(_fs.readFileSync(flatFile, 'utf-8'))
    } catch {
      gdpLog(`UI locale files not found for ${locale}`, 'warn', 'i18n')
      return {}
    }
  }
}

function setupRendererI18n(
  app: { on(event: string, cb: (...args: unknown[]) => void): void },
  uiTranslations: Record<string, string>,
  dir: string,
  config: HookConfig
): void {
  const preloadPath = _path.join(dir, 'preload', 'index.js')
  if (!_fs.existsSync(preloadPath)) {
    gdpLog(`Preload not found: ${preloadPath}`, 'error', 'i18n')
    return
  }

  const translationCount = Object.keys(uiTranslations).length
  gdpLog(`Loaded ${translationCount} UI translation entries for ${config.locale}`, 'info', 'i18n')

  let preloadCode: string
  try {
    preloadCode = _fs.readFileSync(preloadPath, 'utf-8')
  } catch {
    gdpLog(`Cannot read preload: ${preloadPath}`, 'error', 'i18n')
    return
  }

  // Build injection script — navbar injection is included as a separate module
  const navbarPath = _path.join(dir, 'preload', 'navbar.js')
  let navbarCode = ''
  try {
    if (_fs.existsSync(navbarPath)) {
      navbarCode = _fs.readFileSync(navbarPath, 'utf-8')
      gdpLog('Navbar injection script loaded', 'info', 'navbar')
    }
  } catch { /* optional */ }

  const injectScript = `(function(){` +
    `window.__GDP_TRANSLATIONS__=${JSON.stringify(uiTranslations)};` +
    `window.__GDP_CONFIG__=${JSON.stringify(config)};` +
    `window.__GDP_LOG_FILE__=${JSON.stringify(LOG_JSON_FILE)};` +
    `${preloadCode}` +
    (navbarCode ? `\n${navbarCode}` : '') +
    `})();`

  app.on('browser-window-created', (...args: unknown[]) => {
    const win = args[1] as {
      webContents: {
        on(event: string, cb: () => void): void
        executeJavaScript(code: string): Promise<unknown>
      }
    }
    gdpLog('browser-window-created — attaching i18n + navbar injection', 'info', 'i18n')
    win.webContents.on('did-finish-load', () => {
      gdpLog('did-finish-load — injecting scripts', 'info', 'i18n')
      win.webContents.executeJavaScript(injectScript).catch((e: unknown) => {
        gdpLog(`executeJavaScript failed: ${e}`, 'error', 'i18n')
      })
    })
  })
  gdpLog('Renderer i18n injection registered', 'info', 'i18n')
}

// ---------------------------------------------------------------------------
// 4. Telemetry Blocker — use session.webRequest after app ready
// ---------------------------------------------------------------------------
function setupTelemetryBlocker(
  app: {
    on(event: string, cb: () => void): void
    isReady(): boolean
    whenReady(): Promise<void>
  },
  session: { defaultSession: { webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      cb: (details: { url: string }, callback: (resp: { cancel: boolean }) => void) => void
    ): void
  } } }
): void {
  const BLOCKED_PATTERNS = [
    '*://central.github.com/*',
    '*://usage.github.com/*',
    '*://stats.github.com/*',
  ]

  const handler = () => {
    try {
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: BLOCKED_PATTERNS },
        (details: { url: string }, callback: (resp: { cancel: boolean }) => void) => {
          gdpLog(`Telemetry blocked: ${details.url}`, 'block', 'telemetry')
          callback({ cancel: true })
        }
      )
      gdpLog('Telemetry blocker active via session.webRequest', 'info', 'telemetry')
    } catch (e) {
      gdpLog(`Telemetry blocker failed: ${e}`, 'error', 'telemetry')
    }
  }

  if (app.isReady()) {
    handler()
  } else {
    app.on('ready', handler)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const config = parseConfig()
  const dir = process.env.GDP_HOOK_DIR || __dirname

  // Clear previous log stream
  try { _fs.writeFileSync(LOG_JSON_FILE, '') } catch { /* ignore */ }

  gdpLog('====== GitHub Desktop Plus hooks loading ======')
  gdpLog(`Config: ${JSON.stringify(config)}`)
  gdpLog(`hookDir: ${dir}`)

  let electron: Record<string, unknown>
  try {
    electron = require('electron') as Record<string, unknown>
  } catch (e) {
    gdpLog(`Failed to require("electron"): ${e}`, 'error', 'system')
    return
  }

  // 1. Block auto-updates
  if (config.blockUpdates && electron.autoUpdater) {
    blockUpdates(electron.autoUpdater as Record<string, unknown>)
  }

  // 2. Menu i18n (main process — intercept Menu.buildFromTemplate)
  if (config.enableI18n && electron.Menu) {
    const menuTranslations = loadMenuTranslations(dir, config.locale)
    setupMenuI18n(
      electron.Menu as { buildFromTemplate(template: MenuItem[]): unknown },
      menuTranslations
    )
  }

  // 3. Renderer i18n + navbar injection
  if (config.enableI18n && electron.app) {
    const uiTranslations = loadUiTranslations(dir, config.locale)
    setupRendererI18n(
      electron.app as { on(event: string, cb: (...args: unknown[]) => void): void },
      uiTranslations,
      dir,
      config
    )
  }

  // 4. Telemetry blocking
  if (config.blockTelemetry && electron.app && electron.session) {
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
      } } }
    )
  }

  gdpLog('====== Hook setup complete ======')
}

main()
