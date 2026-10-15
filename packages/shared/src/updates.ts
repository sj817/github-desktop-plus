/** Public download routes listed by https://github.akams.cn/ (hubporg/ghproxy-next).
 * The directory is a website, not a proxy prefix. Only public GDP release files
 * and release metadata use these routes; Git credentials never pass through them.
 */
export const DOWNLOAD_MIRRORS = [
  { id: 'gh.dpik.top', label: 'gh.dpik.top · akams 收录', prefix: 'https://gh.dpik.top/', api: true },
  { id: 'gh-proxy.com', label: 'GH-Proxy', prefix: 'https://gh-proxy.com/', api: true },
  { id: 'ghfast.top', label: 'GHFast', prefix: 'https://ghfast.top/', api: false },
  { id: 'ghproxy.net', label: 'GHProxy.net', prefix: 'https://ghproxy.net/', api: false },
] as const

export type DownloadMirror = 'auto' | 'direct' | typeof DOWNLOAD_MIRRORS[number]['id']

export function normalizeDownloadMirror(value: unknown): DownloadMirror {
  return value === 'direct' || DOWNLOAD_MIRRORS.some(mirror => mirror.id === value)
    ? value as DownloadMirror : 'auto'
}

export const WINDOWS_SETUP_NAME = 'GitHubDesktopPlus-win-x64-Setup.exe'
export const WINDOWS_PORTABLE_NAME = 'GitHubDesktopPlus-win-x64-Portable.zip'
export const RELEASES_URL = 'https://github.com/sj817/github-desktop-plus/releases'

export interface GdpRelease {
  version: string
  url: string
  publishedAt: string
  notes: string
  size: number
}

export interface UpdateState {
  revision: number
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  release?: GdpRelease
  source?: string
  received?: number
  total?: number
  checkedAt?: string
  error?: string
}
