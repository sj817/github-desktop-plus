import type {
  GDPBridge,
  GdpEventChannel,
  GdpEventMap,
  GdpInvokeArgs,
  GdpInvokeChannel,
  GdpInvokeResult,
  LogEntry,
  StoredConfig,
  Theme,
} from '@github-desktop-plus/shared'

/**
 * Development-only bridge for opening the UI directly in a browser tab
 * (`?mock=1`) with no GitHub Desktop behind it. Everything is in-memory and
 * mildly delayed so loading and pending states are visible.
 *
 * Never bundled into production: `main.tsx` only imports it under
 * `import.meta.env.DEV`, and the production entry (`mount.tsx`) never touches
 * it.
 */
export function createMockBridge(): GDPBridge {
  const url = new URL(window.location.href)
  let theme: Theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
  const themeHandlers = new Set<(theme: Theme) => void>()
  const scenario = url.searchParams.get('scenario') ?? ''

  let config: StoredConfig =
    scenario === 'empty'
      ? {}
      : {
          i18n: { enabled: true, locale: 'zh-CN' },
          ui: { recent_repos_limit: 5 },
          updates: { disabled: true, block_manual_check: true },
          telemetry: { disabled: true },
          logging: { level: '' },
          copilot: { unlock: true },
          open_with: {
            submenu: false,
            items: [
              {
                id: 'vscode',
                label: 'Visual Studio Code',
                path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
                args: '"%TARGET_PATH%"',
                group: 'editor',
                console: false,
                enabled: true,
              },
              {
                id: 'wt',
                label: 'Windows Terminal',
                path: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
                args: '-d "%TARGET_PATH%"',
                group: 'shell',
                console: true,
                enabled: false,
              },
            ],
          },
          ai: {
            enabled: true,
            base_url: 'https://api.deepseek.com/v1',
            api_key: 'sk-1234567890abcdef1234567890abcdef',
            model: 'deepseek-chat',
            system_prompt: '',
            timeout_secs: 30,
            fallback_to_copilot: true,
          },
        }

  let locales = scenario === 'empty' ? [] : ['zh-CN', 'zh-TW', 'ja-JP']
  const logHandlers = new Set<(entry: LogEntry) => void>()

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  const sampleLogs: Array<[LogEntry['level'], string, string]> = [
    ['info', 'core', 'GDP 0.1.0 attached to GitHub Desktop 3.4.12 (pid 18240)'],
    ['info', 'i18n', 'loaded locale zh-CN (1 842 strings, 3 missing)'],
    ['block', 'updates', 'blocked GET https://central.github.com/api/deployments/desktop/desktop/latest'],
    ['block', 'telemetry', 'dropped stats payload (14 events)'],
    ['info', 'open-with', 'registered 2 launchers: vscode, wt'],
    ['warn', 'copilot', 'subscription probe returned 402; unlock patch applied'],
    ['info', 'ai', 'POST /chat/completions model=deepseek-chat 812ms'],
    ['error', 'ai', 'request timed out after 30s: ETIMEDOUT https://api.deepseek.com/v1/chat/completions'],
    ['info', 'settings', 'config.json saved'],
  ]

  const makeEntry = (i: number): LogEntry => {
    const [level, category, message] = sampleLogs[i % sampleLogs.length]!
    return { ts: new Date(Date.now() - (sampleLogs.length - i) * 1300).toISOString(), level, category, message }
  }

  let ticker = 0
  if (scenario !== 'empty') {
    setInterval(() => {
      ticker += 1
      const entry = makeEntry(ticker)
      entry.ts = new Date().toISOString()
      for (const handler of logHandlers) handler(entry)
    }, 4000)
  }

  const handlers: { [C in GdpInvokeChannel]: (...args: GdpInvokeArgs<C>) => Promise<GdpInvokeResult<C>> } = {
    'gdp:get-config': async () => {
      await delay(350)
      return structuredClone(config)
    },
    'gdp:set-config': async next => {
      await delay(500)
      config = structuredClone(next)
      return { ok: true }
    },
    'gdp:open-with-detect': async () => {
      await delay(900)
      return [
        {
          id: 'sublime',
          label: 'Sublime Text',
          path: 'C:\\Program Files\\Sublime Text\\sublime_text.exe',
          args: '"%TARGET_PATH%"',
          group: 'editor',
          console: false,
        },
        {
          id: 'pwsh',
          label: 'PowerShell 7',
          path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
          args: '-NoExit -Command "Set-Location -LiteralPath \'%TARGET_PATH%\'"',
          group: 'shell',
          console: true,
        },
      ]
    },
    'gdp:open-with-browse': async () => {
      await delay(300)
      return { ok: true, path: 'D:\\Tools\\my-editor.exe', label: 'My Editor' }
    },
    'gdp:list-locales': async () => {
      await delay(400)
      return [...locales]
    },
    'gdp:create-locale': async name => {
      await delay(300)
      if (locales.includes(name)) return { ok: false, reason: '已存在' }
      locales = [...locales, name]
      return { ok: true }
    },
    'gdp:delete-locale': async name => {
      await delay(300)
      locales = locales.filter(item => item !== name)
      return { ok: true }
    },
    'gdp:import-locale': async name => {
      await delay(300)
      if (!locales.includes(name)) locales = [...locales, name]
      return { ok: true }
    },
    'gdp:export-locale-file': async name => {
      await delay(400)
      return { ok: true, path: `C:\\Users\\me\\Downloads\\${name}.json` }
    },
    'gdp:open-locales-dir': async () => undefined,
    'gdp:tail-log': async n => {
      await delay(200)
      if (scenario === 'empty') return []
      return Array.from({ length: Math.min(n, sampleLogs.length) }, (_, i) => makeEntry(i))
    },
    'gdp:open-log-file': async () => undefined,
    'gdp:ai-test': async payload => {
      await delay(1200)
      if (payload.api_key.includes('bad')) {
        return { ok: false, reason: '401 Unauthorized: Incorrect API key provided' }
      }
      return { ok: true, latency_ms: 812, reply: 'OK' }
    },
    'gdp:log': async () => true,
  }

  return {
    mode: 'dev-iframe',

    invoke<C extends GdpInvokeChannel>(
      channel: C,
      ...args: GdpInvokeArgs<C>
    ): Promise<GdpInvokeResult<C>> {
      const handler = handlers[channel] as (...a: GdpInvokeArgs<C>) => Promise<GdpInvokeResult<C>>
      return handler(...args)
    },

    on<C extends GdpEventChannel>(channel: C, handler: (...args: GdpEventMap[C]) => void) {
      if (channel !== 'gdp:log-line') return () => {}
      const fn = handler as (entry: LogEntry) => void
      logHandlers.add(fn)
      return () => {
        logHandlers.delete(fn)
      }
    },

    close() {
      console.info('[mock] close()')
    },

    openExternal(url: string) {
      window.open(url, '_blank', 'noopener')
    },

    getTheme: () => theme,

    onThemeChange(handler) {
      themeHandlers.add(handler)
      return () => {
        themeHandlers.delete(handler)
      }
    },

    // Not part of GDPBridge — exposed for the dev page's theme toggle.
    ...({
      __setTheme(next: Theme) {
        theme = next
        for (const handler of themeHandlers) handler(next)
      },
    } as object),
  }
}
