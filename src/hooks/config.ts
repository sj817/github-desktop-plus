export interface HookConfig {
  blockUpdates: boolean
  blockManualUpdateCheck: boolean
  blockTelemetry: boolean
  logLevel: string
  enableI18n: boolean
  locale: string
  dataDir: string
  authToken: string
  controlOrigin: string
  recentReposLimit: number
}

export function parseConfig(): HookConfig {
  const defaults: HookConfig = {
    blockUpdates: true,
    blockManualUpdateCheck: true,
    blockTelemetry: true,
    logLevel: '',
    enableI18n: true,
    locale: 'zh-CN',
    dataDir: '',
    authToken: '',
    controlOrigin: 'http://127.0.0.1:7788',
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
  } catch {
    // Keep hook startup resilient; malformed env config falls back to defaults.
  }

  return defaults
}
