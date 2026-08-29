import type { OpenWithGroup, StoredConfig, StoredOpenWithItem } from '@shared/gdp-ipc'

/**
 * The dialog's working copy of the configuration.
 *
 * `config.json` is written in the nested snake_case shape the Rust launcher and
 * the main-process hook read; this is the same data in the shape the UI wants.
 * Reading and writing both go through this file so the defaulting rules live in
 * exactly one place instead of being re-derived per tab.
 */
export interface SettingsDraft {
  i18nEnabled: boolean
  locale: string
  recentReposLimit: number
  unlockCopilot: boolean
  blockUpdates: boolean
  blockTelemetry: boolean
  logLevel: string
  openWith: {
    submenu: boolean
    items: OpenWithEntry[]
  }
  ai: {
    enabled: boolean
    baseUrl: string
    apiKey: string
    model: string
    systemPrompt: string
    timeoutSecs: number
    fallbackToCopilot: boolean
  }
}

/** A configured launcher plus a stable React key (never persisted). */
export interface OpenWithEntry {
  key: string
  id: string
  label: string
  path: string
  args: string
  group: OpenWithGroup
  console: boolean
  enabled: boolean
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_MODEL = 'gpt-4o-mini'
export const DEFAULT_TIMEOUT_SECS = 30
export const DEFAULT_RECENT_REPOS_LIMIT = 3

let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `ow-${keyCounter}`
}

function normalizeItem(raw: StoredOpenWithItem | undefined, index: number): OpenWithEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const filePath = typeof raw.path === 'string' ? raw.path : ''
  if (filePath === '') return null
  return {
    key: nextKey(),
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `item-${index}`,
    label: typeof raw.label === 'string' ? raw.label : '',
    path: filePath,
    args: typeof raw.args === 'string' ? raw.args : '',
    group: raw.group === 'shell' ? 'shell' : 'editor',
    console: raw.console === true,
    enabled: raw.enabled !== false,
  }
}

export function createEntry(partial: Partial<OpenWithEntry> & { id: string; path: string }): OpenWithEntry {
  return {
    key: nextKey(),
    label: '',
    args: '',
    group: 'editor',
    console: false,
    enabled: true,
    ...partial,
  }
}

/** Give a new entry an id that does not collide with the existing ones. */
export function uniqueId(items: readonly OpenWithEntry[], preferred: string): string {
  if (!items.some(item => item.id === preferred)) return preferred
  for (let n = 2; ; n++) {
    const candidate = `${preferred}-${n}`
    if (!items.some(item => item.id === candidate)) return candidate
  }
}

export function draftFromConfig(cfg: StoredConfig): SettingsDraft {
  const ai = cfg.ai ?? {}
  const timeout = Number(ai.timeout_secs)
  const rawItems = Array.isArray(cfg.open_with?.items) ? cfg.open_with.items : []

  return {
    // Every toggle below is on unless persisted as an explicit `false`, which
    // is how a fresh config.json (or one written by an older build) ends up
    // with the protective defaults rather than everything switched off.
    i18nEnabled: cfg.i18n?.enabled !== false,
    locale: cfg.i18n?.locale ?? 'zh-CN',
    recentReposLimit: cfg.ui?.recent_repos_limit ?? DEFAULT_RECENT_REPOS_LIMIT,
    unlockCopilot: cfg.copilot?.unlock !== false,
    // One switch drives both update-blocking mechanisms (auto + manual check).
    blockUpdates: cfg.updates?.disabled !== false || cfg.updates?.block_manual_check !== false,
    blockTelemetry: cfg.telemetry?.disabled !== false,
    logLevel: cfg.logging?.level ?? '',
    openWith: {
      submenu: cfg.open_with?.submenu === true,
      items: rawItems
        .map((raw, index) => normalizeItem(raw, index))
        .filter((item): item is OpenWithEntry => item !== null),
    },
    ai: {
      enabled: ai.enabled === true,
      baseUrl: ai.base_url ?? DEFAULT_BASE_URL,
      apiKey: ai.api_key ?? '',
      model: ai.model ?? DEFAULT_MODEL,
      systemPrompt: ai.system_prompt ?? '',
      timeoutSecs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECS,
      fallbackToCopilot: ai.fallback_to_copilot !== false,
    },
  }
}

/** Flat keys written by builds that predate the nested schema. */
const LEGACY_KEYS = [
  'block_updates',
  'block_manual_update_check',
  'block_telemetry',
  'log_level',
  'enable_i18n',
  'locale',
  'recent_repos_limit',
]

/**
 * Merge the draft into the configuration as it exists on disk right now.
 *
 * `current` is re-read at save time rather than reused from load, so keys the
 * dialog does not manage (and locales created while it was open) survive.
 */
export function applyDraft(current: StoredConfig, draft: SettingsDraft): StoredConfig {
  const openWith: Record<string, unknown> = {
    ...(current.open_with ?? {}),
    submenu: draft.openWith.submenu,
    // An entry without an executable could only ever fail at launch time.
    items: draft.openWith.items
      .filter(item => item.path.trim() !== '')
      .map(item => ({
        id: item.id,
        label: item.label.trim(),
        path: item.path.trim(),
        args: item.args,
        group: item.group,
        console: item.console,
        enabled: item.enabled,
      })),
  }
  // Written by older builds; the native entry is now always left in place.
  delete openWith.replace_native

  const merged: StoredConfig = {
    ...current,
    updates: {
      ...(current.updates ?? {}),
      disabled: draft.blockUpdates,
      block_manual_check: draft.blockUpdates,
    },
    telemetry: { ...(current.telemetry ?? {}), disabled: draft.blockTelemetry },
    logging: { ...(current.logging ?? {}), level: draft.logLevel },
    i18n: { ...(current.i18n ?? {}), enabled: draft.i18nEnabled, locale: draft.locale || 'zh-CN' },
    ui: { ...(current.ui ?? {}), recent_repos_limit: draft.recentReposLimit },
    copilot: { ...(current.copilot ?? {}), unlock: draft.unlockCopilot },
    open_with: openWith,
    ai: {
      ...(current.ai ?? {}),
      enabled: draft.ai.enabled,
      base_url: draft.ai.baseUrl.trim(),
      api_key: draft.ai.apiKey.trim(),
      model: draft.ai.model.trim(),
      system_prompt: draft.ai.systemPrompt,
      fallback_to_copilot: draft.ai.fallbackToCopilot,
      timeout_secs:
        Number.isFinite(draft.ai.timeoutSecs) && draft.ai.timeoutSecs > 0
          ? draft.ai.timeoutSecs
          : current.ai?.timeout_secs,
    },
  }

  // Keep config.json clean rather than accumulating dead keys forever.
  for (const key of LEGACY_KEYS) delete merged[key]
  if (merged.ai && merged.ai.timeout_secs === undefined) delete merged.ai.timeout_secs

  return merged
}
