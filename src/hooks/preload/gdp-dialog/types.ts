// Nested shape — matches the Rust `Config` (config.rs) and the hook's
// applyStoredConfig, so the dialog round-trips through the same keys the
// launcher and hot-reload actually read. (Older builds wrote flat keys like
// `block_updates`; those are ignored and cleaned up on the next save.)
export interface StoredConfig {
  updates?: { disabled?: boolean; block_manual_check?: boolean }
  telemetry?: { disabled?: boolean }
  logging?: { level?: string }
  i18n?: { enabled?: boolean; locale?: string }
  ui?: { recent_repos_limit?: number }
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

export interface IpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}
