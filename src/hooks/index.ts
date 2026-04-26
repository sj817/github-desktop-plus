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

interface HookConfig {
  blockUpdates: boolean
  blockManualUpdateCheck: boolean
  blockTelemetry: boolean
  logLevel: string
  enableI18n: boolean
  locale: string
  dataDir: string
  /** Max number of repos to keep in the "Recent" group (default: 3) */
  recentReposLimit: number
}

interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'block'
  category: 'update' | 'telemetry' | 'i18n' | 'menu' | 'system' | 'navbar'
  message: string
}

function parseConfig(): HookConfig {
  const defaults: HookConfig = {
    blockUpdates: true,
    blockManualUpdateCheck: true,
    blockTelemetry: true,
    logLevel: '',
    enableI18n: true,
    locale: 'zh-CN',
    dataDir: '',
    recentReposLimit: 3,
  }

  try {
    const raw = process.env.GDP_CONFIG
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HookConfig> | null
      if (parsed && typeof parsed === 'object') {
        return { ...defaults, ...parsed }
      }
    }
  } catch { /* ignore */ }
  return defaults
}

const _fs: typeof import('fs') = require('fs')
const _path: typeof import('path') = require('path')
const _os: typeof import('os') = require('os')

const LOG_FILE = _path.join(_os.tmpdir(), 'gdp-hooks.log')
const LOG_JSON_FILE = _path.join(_os.tmpdir(), 'gdp-hooks-stream.jsonl')

// ── Locale reload watcher (poll <dataDir>/.gdp-locale-reload) ──────────────
// The Rust serve.rs writes to this marker file after any locale CRUD.
// We re-read translation files when its mtime changes.
let _reloadCallbacks: Array<() => void> = []
function _registerReload(cb: () => void): void {
  _reloadCallbacks.push(cb)
}
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

// Sliding 1-second dedup window for repeated log lines.
const _logLevelOrder: Record<string, number> = { debug: 0, info: 1, warn: 2, warning: 2, error: 3, block: 3 }
let _lastLogKey: string | null = null
let _lastLogTs: number = 0
let _lastLogCount: number = 0

/** Structured log — written as JSONL for streaming to frontend */
function gdpLog(msg: string, level: LogEntry['level'] = 'info', category: LogEntry['category'] = 'system'): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message: msg,
  }
  const key = `${level}|${category}|${msg}`
  const now = Date.now()
  if (_lastLogKey === key && now - _lastLogTs < 1000) {
    _lastLogCount += 1
    // JSONL stream gets every event so the WebUI can show full history.
    try { _fs.appendFileSync(LOG_JSON_FILE, JSON.stringify(entry) + '\n') } catch { /* best-effort */ }
    return
  }
  // Flush prior dedup tail, if any.
  if (_lastLogKey && _lastLogCount > 0) {
    const tail = ` (repeated ${_lastLogCount}x in 1s)`
    console.log(tail)
    try { _fs.appendFileSync(LOG_FILE, tail + '\n') } catch { /* best-effort */ }
  }
  _lastLogKey = key
  _lastLogTs = now
  _lastLogCount = 0

  const line = `${entry.ts} [${entry.level.toUpperCase()}][${entry.category}] ${msg}`
  // console.log filter: drop entries below `warn` unless the configured
  // logLevel allows them. The JSONL stream always retains every entry.
  const cfgLvl = (_currentLogLevel || 'warn').toLowerCase()
  const minOrder = _logLevelOrder[cfgLvl] ?? 2
  if ((_logLevelOrder[level] ?? 1) >= minOrder) {
    console.log(line)
  }
  try {
    _fs.appendFileSync(LOG_FILE, line + '\n')
    _fs.appendFileSync(LOG_JSON_FILE, JSON.stringify(entry) + '\n')
  } catch { /* best-effort */ }
}

// Resolved on first hook config parse so gdpLog can read it.
let _currentLogLevel: string = ''

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
  id?: string
  label?: string
  submenu?: MenuItem[]
  role?: string
  type?: string
  enabled?: boolean
  click?: () => void
}

interface TrackedWebContents {
  executeJavaScript(code: string): Promise<unknown>
  isDestroyed(): boolean
}

function loadTranslationFiles(
  localeDir: string,
  excludedFileNames: ReadonlySet<string>
): Record<string, string> {
  if (!_fs.existsSync(localeDir)) {
    return {}
  }

  const translations: Record<string, string> = {}
  const files = _fs
    .readdirSync(localeDir, { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        !excludedFileNames.has(entry.name)
    )
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))

  for (const fileName of files) {
    const filePath = _path.join(localeDir, fileName)
    const data = JSON.parse(_fs.readFileSync(filePath, 'utf-8')) as Record<
      string,
      string
    >

    delete data._meta
    Object.assign(translations, data)
  }

  return translations
}

function loadMenuTranslations(dir: string, locale: string, dataDir: string): Record<string, string> {
  // Layer 1: built-in translations (shipped with GDP)
  const builtinFile = _path.join(dir, '..', 'locales', locale, 'menu.json')
  let translations: Record<string, string> = {}
  try {
    const data = JSON.parse(_fs.readFileSync(builtinFile, 'utf-8'))
    delete data._meta
    translations = data
    gdpLog(`Loaded ${Object.keys(data).length} built-in menu translations from ${builtinFile}`, 'info', 'menu')
  } catch {
    gdpLog(`Built-in menu locale file not found: ${builtinFile}`, 'warn', 'menu')
  }

  // Layer 2: user-custom translations (override built-in)
  if (dataDir) {
    const userFile = _path.join(dataDir, 'locales', locale, 'menu.json')
    try {
      if (_fs.existsSync(userFile)) {
        const userData = JSON.parse(_fs.readFileSync(userFile, 'utf-8'))
        delete userData._meta
        const overrideCount = Object.keys(userData).length
        Object.assign(translations, userData)
        gdpLog(`Applied ${overrideCount} user menu overrides from ${userFile}`, 'info', 'menu')
      }
    } catch (e) {
      gdpLog(`Failed to load user menu overrides: ${e}`, 'warn', 'menu')
    }
  }

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
  const excludedFileNames = new Set(['menu.json'])

  // Layer 1: built-in translations
  let translations: Record<string, string> = {}
  const builtinDir = _path.join(dir, '..', 'locales', locale)
  try {
    translations = loadTranslationFiles(builtinDir, excludedFileNames)
    gdpLog(
      `Loaded ${Object.keys(translations).length} built-in UI translations from ${builtinDir}`,
      'info',
      'i18n'
    )
  } catch {
    gdpLog(`Built-in UI locale directory not found or invalid: ${builtinDir}`, 'warn', 'i18n')
  }

  // Layer 2: user-custom translations (override built-in)
  if (dataDir) {
    const userDir = _path.join(dataDir, 'locales', locale)
    try {
      if (_fs.existsSync(userDir)) {
        const userData = loadTranslationFiles(userDir, excludedFileNames)
        const overrideCount = Object.keys(userData).length
        Object.assign(translations, userData)
        gdpLog(`Applied ${overrideCount} user UI overrides from ${userDir}`, 'info', 'i18n')
      }
    } catch (e) {
      gdpLog(`Failed to load user UI overrides: ${e}`, 'warn', 'i18n')
    }
  }

  return translations
}

function setupRendererI18n(
  app: { on(event: string, cb: (...args: unknown[]) => void): void },
  uiTranslations: Record<string, string>,
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

  const injectScript = `(function(){` +
    `window.__GDP_TRANSLATIONS__=${JSON.stringify(uiTranslations)};` +
    `window.__GDP_CONFIG__=${JSON.stringify(config)};` +
    `window.__GDP_LOG_FILE__=${JSON.stringify(LOG_JSON_FILE)};` +
    `${preloadCode}` +
    (navbarCode ? `\n${navbarCode}` : '') +
    (updateInterceptorCode ? `\n${updateInterceptorCode}` : '') +
    `})();`

  // Track active webContents for hot-reload push
  const activeWebContents: TrackedWebContents[] = []

  app.on('browser-window-created', (...args: unknown[]) => {
    const win = args[1] as {
      webContents: {
        on(event: string, cb: () => void): void
        once(event: string, cb: () => void): void
        executeJavaScript(code: string): Promise<unknown>
        isDestroyed(): boolean
      }
    }
    gdpLog('browser-window-created — attaching i18n + navbar + update-interceptor injection', 'info', 'i18n')

    activeWebContents.push(win.webContents)
    win.webContents.once('destroyed', () => {
      const idx = activeWebContents.indexOf(win.webContents)
      if (idx >= 0) activeWebContents.splice(idx, 1)
    })

    win.webContents.on('did-finish-load', () => {
      gdpLog('did-finish-load — injecting scripts', 'info', 'i18n')
      win.webContents.executeJavaScript(injectScript).catch((e: unknown) => {
        gdpLog(`executeJavaScript failed: ${e}`, 'error', 'i18n')
      })
    })
  })
  gdpLog('Renderer i18n injection registered', 'info', 'i18n')

  // Return activeWebContents so hot-reload watcher can push translation updates
  return activeWebContents
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
// 5. GDP Menu — inject a "GDP" top-level menu into the menu bar
//    Independent of i18n toggle — always injected when hooks are active.
// ---------------------------------------------------------------------------
const GDP_WEBUI_URL = 'http://127.0.0.1:7788'

function buildGDPMenuItems(
  shell: { openExternal(url: string): Promise<void> },
  config: HookConfig
): MenuItem[] {
  const check = (v: boolean) => v ? '✓' : '✗'
  return [
    {
      id: 'gdp.open-webui',
      label: '打开控制面板 (WebUI)',
      click: () => { shell.openExternal(GDP_WEBUI_URL).catch(() => {}) },
    },
    { id: 'gdp.separator.1', type: 'separator' },
    {
      id: 'gdp.status.updates',
      label: `更新拦截: ${check(config.blockUpdates)} ${config.blockUpdates ? '已启用' : '已禁用'}`,
      enabled: false,
    },
    {
      id: 'gdp.status.manual-updates',
      label: `手动更新拦截: ${check(config.blockManualUpdateCheck)} ${config.blockManualUpdateCheck ? '已启用' : '已禁用'}`,
      enabled: false,
    },
    {
      id: 'gdp.status.telemetry',
      label: `遥测拦截: ${check(config.blockTelemetry)} ${config.blockTelemetry ? '已启用' : '已禁用'}`,
      enabled: false,
    },
    {
      id: 'gdp.status.i18n',
      label: `中文界面: ${check(config.enableI18n)} ${config.enableI18n ? '已启用' : '已禁用'}`,
      enabled: false,
    },
    { id: 'gdp.separator.2', type: 'separator' },
    {
      id: 'gdp.about',
      label: '关于 GitHub Desktop Plus',
      click: () => { shell.openExternal('https://github.com/nicexipi/github-desktop-plus').catch(() => {}) },
    },
  ]
}

function setupGDPMenu(
  Menu: { buildFromTemplate(template: MenuItem[]): unknown },
  shell: { openExternal(url: string): Promise<void> },
  config: HookConfig,
  menuTranslations: Record<string, string> | null
): void {
  const originalBuild = Menu.buildFromTemplate.bind(Menu)
  let isBuildingMenu = false

  Menu.buildFromTemplate = function (template: MenuItem[]): unknown {
    if (isBuildingMenu) {
      return originalBuild(template)
    }

    isBuildingMenu = true

    // Translate menu labels if i18n is enabled
    try {
      if (menuTranslations && Object.keys(menuTranslations).length > 0) {
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
          submenu: buildGDPMenuItems(shell, config),
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
// 6. Dev-mode Hot-Reload — watch locale source files for changes
//    and push updated translations to active renderers.
// ---------------------------------------------------------------------------
function setupLocaleHotReload(
  dir: string,
  config: HookConfig,
  activeWebContents: TrackedWebContents[]
): void {
  // Watch both built-in and user-custom locale directories
  const watchDirs: string[] = []
  const builtinDir = _path.join(dir, '..', 'locales', config.locale)
  if (_fs.existsSync(builtinDir)) watchDirs.push(builtinDir)
  if (config.dataDir) {
    const userDir = _path.join(config.dataDir, 'locales', config.locale)
    if (_fs.existsSync(userDir)) watchDirs.push(userDir)
  }

  if (watchDirs.length === 0) {
    gdpLog('No locale directories to watch for hot-reload', 'warn', 'i18n')
    return
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const onFileChange = (_eventType: string, filename: string | null) => {
    if (!filename || !filename.endsWith('.json')) return
    // Debounce — coalesce rapid changes
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      gdpLog(`Locale file changed: ${filename} — hot-reloading translations`, 'info', 'i18n')

      // Reload UI translations
      const newUiTranslations = loadUiTranslations(dir, config.locale, config.dataDir)
      const updateScript = `(function(){` +
        `var newT=${JSON.stringify(newUiTranslations)};` +
        `var oldT=window.__GDP_TRANSLATIONS__||{};` +
        `var changed=false;` +
        `for(var k in newT){if(oldT[k]!==newT[k]){changed=true;break;}}` +
        `if(!changed){for(var k in oldT){if(!(k in newT)){changed=true;break;}}}` +
        `if(changed){` +
        `window.__GDP_TRANSLATIONS__=newT;` +
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

      // Also reload menu translations for next menu rebuild
      if (filename.includes('menu')) {
        const newMenuTranslations = loadMenuTranslations(dir, config.locale, config.dataDir)
        gdpLog(`Menu translations reloaded (${Object.keys(newMenuTranslations).length} entries)`, 'info', 'menu')
      }
    }, 300)
  }

  for (const watchDir of watchDirs) {
    try {
      _fs.watch(watchDir, { persistent: false }, onFileChange)
      gdpLog(`Watching locale directory for changes: ${watchDir}`, 'info', 'i18n')
    } catch (e) {
      gdpLog(`Failed to watch ${watchDir}: ${e}`, 'warn', 'i18n')
    }
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

  // Make logging.level visible to gdpLog's console-filter.
  _currentLogLevel = config.logLevel || 'warn'

  // Clear previous log stream
  try { _fs.writeFileSync(LOG_JSON_FILE, '') } catch { /* ignore */ }

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

  // 1. Block auto-updates
  if (config.blockUpdates && electron.autoUpdater) {
    blockUpdates(electron.autoUpdater as Record<string, unknown>)
  }

  // 2. Menu patching — always inject GDP menu, optionally translate labels
  const menuTranslations = config.enableI18n
    ? loadMenuTranslations(dir, config.locale, config.dataDir)
    : null

  if (electron.Menu && electron.shell) {
    setupGDPMenu(
      electron.Menu as { buildFromTemplate(template: MenuItem[]): unknown },
      electron.shell as { openExternal(url: string): Promise<void> },
      config,
      menuTranslations
    )
  }

  // 3. Renderer i18n + navbar + update-interceptor injection
  let activeWebContents: Array<{
    executeJavaScript(code: string): Promise<unknown>
    isDestroyed(): boolean
  }> = []

  if (electron.app) {
    const uiTranslations = config.enableI18n
      ? loadUiTranslations(dir, config.locale, config.dataDir)
      : {}
    activeWebContents = setupRendererI18n(
      electron.app as { on(event: string, cb: (...args: unknown[]) => void): void },
      uiTranslations,
      dir,
      config
    ) ?? []
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

  // 5. Dev-mode hot-reload for locale files
  if (config.enableI18n && activeWebContents) {
    setupLocaleHotReload(
      dir,
      config,
      activeWebContents
    )
  }

  gdpLog('====== Hook setup complete ======')
}

main()
