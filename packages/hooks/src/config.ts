export interface AiHookConfig {
  enabled: boolean
  baseUrl: string
  model: string
  systemPrompt: string
  timeoutSecs: number
  fallbackToCopilot: boolean
}

export interface HookConfig {
  blockUpdates: boolean
  blockManualUpdateCheck: boolean
  blockTelemetry: boolean
  logLevel: string
  enableI18n: boolean
  locale: string
  dataDir: string
  configDir: string
  recentReposLimit: number
  unlockCopilot: boolean
  ai: AiHookConfig
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
    configDir: '',
    recentReposLimit: 3,
    unlockCopilot: true,
    ai: {
      enabled: false,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      systemPrompt: '',
      timeoutSecs: 30,
      fallbackToCopilot: true,
    },
  }

  const raw = process.env.GDP_CONFIG
  // The renderer-facing config is embedded explicitly after parsing. Keeping
  // the transport copy in process.env would expose it to every terminal or
  // editor GitHub Desktop launches.
  delete process.env.GDP_CONFIG

  try {
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HookConfig> | null
      if (parsed && typeof parsed === 'object') {
        return {
          ...defaults,
          ...parsed,
          ai: { ...defaults.ai, ...(parsed.ai ?? {}) },
        }
      }
    }
  } catch {
    // Keep hook startup resilient; malformed env config falls back to defaults.
  }

  return defaults
}
