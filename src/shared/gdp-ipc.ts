/**
 * The contract between the GDP main process (`src/hooks/ipc.ts`), the dialog
 * shell that lives in GitHub Desktop's renderer (`src/hooks/preload/gdp-dialog`)
 * and the settings UI (`src/settings-ui`).
 *
 * Everything here is types plus two runtime allowlists. It is imported by both
 * sides, so a channel can never drift between caller and handler, and the dev
 * postMessage bridge can reject anything not listed.
 */

// ── Stored configuration ─────────────────────────────────────────────────────

/**
 * Nested shape — matches the Rust `Config` (src/core/src/config.rs) and the
 * hook's `applyStoredConfig`, so the dialog round-trips through the same keys
 * the launcher and hot-reload actually read. (Older builds wrote flat keys like
 * `block_updates`; those are ignored and cleaned up on the next save.)
 */
export interface StoredConfig {
  updates?: { disabled?: boolean; block_manual_check?: boolean }
  telemetry?: { disabled?: boolean }
  logging?: { level?: string }
  i18n?: { enabled?: boolean; locale?: string }
  ui?: { recent_repos_limit?: number }
  copilot?: { unlock?: boolean }
  open_with?: {
    submenu?: boolean
    items?: StoredOpenWithItem[]
  }
  ai?: {
    enabled?: boolean
    base_url?: string
    api_key?: string
    model?: string
    system_prompt?: string
    timeout_secs?: number
    fallback_to_copilot?: boolean
  }
  [key: string]: unknown
}

export interface StoredOpenWithItem {
  id?: string
  label?: string
  path?: string
  args?: string
  group?: string
  console?: boolean
  enabled?: boolean
}

/** `%TARGET_PATH%` in an item's args is replaced with the repository path. */
export const TARGET_PATH_TOKEN = '%TARGET_PATH%'

export type OpenWithGroup = 'editor' | 'shell'

/** A launcher candidate found on disk by `gdp:open-with-detect`. */
export interface DetectedOpenWithItem {
  id: string
  label: string
  path: string
  args: string
  group: OpenWithGroup
  console: boolean
}

// ── Log entries ──────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'block'

export interface LogEntry {
  ts: string
  level: LogLevel
  category: string
  message: string
}

// ── Result envelopes ─────────────────────────────────────────────────────────

export interface OkResult {
  ok: boolean
  reason?: string
}

export interface ExportLocaleResult {
  ok: boolean
  path?: string
  reason?: string
}

export interface BrowseResult {
  ok: boolean
  path?: string
  label?: string
  reason?: string
}

export interface AiTestResult {
  ok: boolean
  latency_ms?: number
  reply?: string
  reason?: string
}

// ── Invoke channels ──────────────────────────────────────────────────────────

/**
 * Every `ipcMain.handle` channel the settings UI is allowed to call, with its
 * argument tuple and result type. Handlers live in `src/hooks/ipc.ts`.
 */
export interface GdpInvokeMap {
  'gdp:get-config': { args: []; result: StoredConfig }
  'gdp:set-config': { args: [StoredConfig]; result: OkResult }

  'gdp:open-with-detect': { args: []; result: DetectedOpenWithItem[] }
  'gdp:open-with-browse': { args: []; result: BrowseResult }

  'gdp:list-locales': { args: []; result: string[] }
  'gdp:create-locale': { args: [string]; result: OkResult }
  'gdp:delete-locale': { args: [string]; result: OkResult }
  'gdp:import-locale': { args: [string, unknown]; result: OkResult }
  'gdp:export-locale-file': { args: [string]; result: ExportLocaleResult }
  'gdp:open-locales-dir': { args: []; result: unknown }

  'gdp:tail-log': { args: [number]; result: LogEntry[] }
  'gdp:open-log-file': { args: []; result: unknown }

  'gdp:ai-test': {
    args: [{ base_url: string; api_key: string; model: string; timeout_secs: number }]
    result: AiTestResult
  }

  'gdp:log': { args: [string]; result: boolean }
}

export type GdpInvokeChannel = keyof GdpInvokeMap
export type GdpInvokeArgs<C extends GdpInvokeChannel> = GdpInvokeMap[C]['args']
export type GdpInvokeResult<C extends GdpInvokeChannel> = GdpInvokeMap[C]['result']

/** Runtime allowlist — the dev RPC host refuses anything not in here. */
export const GDP_INVOKE_CHANNELS: readonly GdpInvokeChannel[] = [
  'gdp:get-config',
  'gdp:set-config',
  'gdp:open-with-detect',
  'gdp:open-with-browse',
  'gdp:list-locales',
  'gdp:create-locale',
  'gdp:delete-locale',
  'gdp:import-locale',
  'gdp:export-locale-file',
  'gdp:open-locales-dir',
  'gdp:tail-log',
  'gdp:open-log-file',
  'gdp:ai-test',
  'gdp:log',
]

export function isGdpInvokeChannel(value: unknown): value is GdpInvokeChannel {
  return typeof value === 'string' && (GDP_INVOKE_CHANNELS as readonly string[]).includes(value)
}

// ── Event channels (main → renderer pushes) ──────────────────────────────────

export interface GdpEventMap {
  'gdp:log-line': [LogEntry]
}

export type GdpEventChannel = keyof GdpEventMap

export const GDP_EVENT_CHANNELS: readonly GdpEventChannel[] = ['gdp:log-line']

export function isGdpEventChannel(value: unknown): value is GdpEventChannel {
  return typeof value === 'string' && (GDP_EVENT_CHANNELS as readonly string[]).includes(value)
}

// ── Bridge ───────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark'

/**
 * The only way the settings UI reaches the outside world. Two implementations
 * exist and the UI cannot tell them apart:
 *
 *   production   React → GDPBridge → ipcRenderer → main process
 *   development  React (in an iframe) → GDPBridge → postMessage → dialog shell
 *                → ipcRenderer → main process
 */
export interface GDPBridge {
  invoke<C extends GdpInvokeChannel>(
    channel: C,
    ...args: GdpInvokeArgs<C>
  ): Promise<GdpInvokeResult<C>>

  /** Subscribe to a main-process push. Returns an unsubscribe function. */
  on<C extends GdpEventChannel>(
    channel: C,
    handler: (...args: GdpEventMap[C]) => void
  ): () => void

  /** Ask the shell to close the dialog. */
  close(): void

  /**
   * Open a URL in the system browser. Handled by the shell rather than by a
   * main-process channel — the renderer already has `shell.openExternal`, and
   * the dev iframe reaches it through the same RPC as everything else.
   */
  openExternal(url: string): void

  /** GitHub Desktop's current theme, and a subscription to changes. */
  getTheme(): Theme
  onThemeChange(handler: (theme: Theme) => void): () => void

  /** Which half of the architecture is running. Diagnostics only. */
  readonly mode: 'production' | 'dev-iframe'
}

export interface MountOptions {
  /** Which tab to show first; falls back to the general tab. */
  initialTab?: string
}

/** The global the production bundle publishes for the dialog shell to call. */
export interface GdpSettingsUiGlobal {
  /** Renders the settings UI into `container`; the return value unmounts it. */
  mount(container: HTMLElement, bridge: GDPBridge, options?: MountOptions): () => void
}

export const GDP_SETTINGS_UI_GLOBAL = '__GDP_SETTINGS_UI__'

// ── Dev-only postMessage RPC protocol ────────────────────────────────────────

/**
 * Version tag carried by every message. The host checks it (along with the
 * frame's origin and `event.source`) before touching Electron IPC, so a stray
 * `postMessage` from anywhere else is ignored rather than forwarded.
 */
export const GDP_RPC_PROTOCOL = 'gdp-settings-rpc@1'

/** iframe → shell. */
export type RpcClientMessage =
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'ready' }
  | {
      protocol: typeof GDP_RPC_PROTOCOL
      kind: 'invoke'
      id: number
      channel: string
      args: unknown[]
    }
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'subscribe'; id: number; channel: string }
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'unsubscribe'; id: number }
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'close' }
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'open-external'; url: string }

/** shell → iframe. */
export type RpcHostMessage =
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'result'; id: number; ok: true; value: unknown }
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'result'; id: number; ok: false; error: string }
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'event'; id: number; args: unknown[] }
  | { protocol: typeof GDP_RPC_PROTOCOL; kind: 'theme'; theme: Theme }

export function isRpcMessage(data: unknown): data is { protocol: string; kind: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { protocol?: unknown }).protocol === GDP_RPC_PROTOCOL &&
    typeof (data as { kind?: unknown }).kind === 'string'
  )
}
