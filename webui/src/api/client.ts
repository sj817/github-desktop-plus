// Lightweight typed fetch wrapper with auto-401 handling and SSE helpers.

const BASE = '' // dev: vite proxies /api → 127.0.0.1:7788

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    let code = 'http_error'
    try {
      const j = await res.json()
      code = j.error || code
    } catch {}
    throw new ApiError(res.status, code)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : (res.text() as unknown as T)
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
  put: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PUT', body: body == null ? undefined : JSON.stringify(body) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
}

// ── Domain endpoints ──────────────────────────────────────────────────────

export interface AuthStatus { authed: boolean; expires_in_secs: number }
export interface LocaleSummary { locale: string; categories: string[]; total_keys: number }
export interface LocaleEntry { key: string; value: string }
export interface RuntimePlan {
  memory_target_mb: number
  runtime: string
  cli_boundary: string
  web_boundary: string
  ui_strategy: string
  startup_priority: string
  notes: string[]
}
export interface AppConfig {
  updates: { disabled: boolean; block_manual_check: boolean }
  telemetry: { disabled: boolean; block_exceptions: boolean }
  logging: { level: string; disable_file_log: boolean }
  i18n: { enabled: boolean; locale: string }
  desktop: { path: string | null }
  ui: { recent_repos_limit: number }
}
export interface DetectResponse { found: boolean; path: string | null }

export const Auth = {
  exchange: (token: string) => api.post<{ ok: true }>(`/api/auth/exchange?t=${encodeURIComponent(token)}`),
  status: () => api.get<AuthStatus>('/api/auth/status'),
}

export const Status = {
  plan: () => api.get<RuntimePlan>('/api/status'),
  detect: () => api.get<DetectResponse>('/api/detect'),
  config: () => api.get<AppConfig>('/api/config'),
  saveConfig: (cfg: AppConfig) => api.post<AppConfig>('/api/config', cfg),
}

export const Locales = {
  list: () => api.get<LocaleSummary[]>('/api/locales'),
  get: (locale: string, category: string) =>
    api.get<LocaleEntry[]>(`/api/locale/${encodeURIComponent(locale)}/${encodeURIComponent(category)}`),
  put: (locale: string, category: string, entries: LocaleEntry[]) =>
    api.put<{ ok: true; count: number }>(
      `/api/locale/${encodeURIComponent(locale)}/${encodeURIComponent(category)}`,
      entries,
    ),
  upsertKey: (locale: string, category: string, key: string, value: string) =>
    api.post<{ ok: true }>(
      `/api/locale/${encodeURIComponent(locale)}/${encodeURIComponent(category)}/key`,
      { key, value },
    ),
  deleteKey: (locale: string, category: string, key: string) =>
    api.del<{ ok: true }>(
      `/api/locale/${encodeURIComponent(locale)}/${encodeURIComponent(category)}/key/${encodeURIComponent(key)}`,
    ),
  createLocale: (locale: string) => api.post<{ ok: true }>(`/api/locale/${encodeURIComponent(locale)}`),
  deleteLocale: (locale: string) => api.del<{ ok: true }>(`/api/locale/${encodeURIComponent(locale)}`),
  importLocale: (locale: string, payload: Record<string, Record<string, string>>) =>
    api.post<{ ok: true }>(`/api/locale/${encodeURIComponent(locale)}/import`, payload),
  exportUrl: (locale: string) => `/api/locale/${encodeURIComponent(locale)}/export`,
}

// ── SSE log stream ────────────────────────────────────────────────────────

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'block' | 'debug'
  category: string
  message: string
}

export interface LogStreamOptions {
  levels?: string[]
  categories?: string[]
  onMessage: (e: LogEntry) => void
  onStatus?: (s: 'open' | 'closed' | 'error') => void
}

export function openLogStream(opts: LogStreamOptions): () => void {
  const params = new URLSearchParams()
  if (opts.levels?.length) params.set('level', opts.levels.join(','))
  if (opts.categories?.length) params.set('category', opts.categories.join(','))
  const url = `/api/logs/stream${params.toString() ? '?' + params : ''}`
  const es = new EventSource(url, { withCredentials: true })
  es.onopen = () => opts.onStatus?.('open')
  es.onerror = () => opts.onStatus?.('error')
  es.onmessage = (ev) => {
    try { opts.onMessage(JSON.parse(ev.data) as LogEntry) } catch {}
  }
  return () => { es.close(); opts.onStatus?.('closed') }
}
