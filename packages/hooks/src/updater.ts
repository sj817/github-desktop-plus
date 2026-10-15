/** On-demand GDP updates. Streams one verified installer to disk; no polling,
 * GitHub credentials, renderer-supplied URLs, or buffered installer payloads. */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import * as https from 'node:https'
import type { IncomingMessage } from 'node:http'
import * as path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  DOWNLOAD_MIRRORS, normalizeDownloadMirror, RELEASES_URL, WINDOWS_SETUP_NAME,
  type DownloadMirror, type GdpRelease, type OkResult, type UpdateState,
} from '@github-desktop-plus/shared'

const API_URL = 'https://api.github.com/repos/sj817/github-desktop-plus/releases/latest'
const MAX_INSTALLER = 256 * 1024 * 1024
const MAX_METADATA = 2 * 1024 * 1024
const STABLE_VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DIGEST = /^sha256:([a-f\d]{64})$/i

export interface UpdateTransport {
  open(url: string, signal: AbortSignal, timeoutMs: number): Promise<Readable>
}

function permittedUrl(value: string): URL {
  const url = new URL(value)
  const host = url.hostname
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    !(host === 'github.com' || host === 'api.github.com' || host.endsWith('.githubusercontent.com') ||
      DOWNLOAD_MIRRORS.some(mirror => new URL(mirror.prefix).hostname === host))) {
    throw new Error('更新服务返回了不支持的下载地址')
  }
  return url
}

export const httpsUpdateTransport: UpdateTransport = {
  open(url, signal, timeoutMs) {
    const visit = (target: string, redirects: number): Promise<IncomingMessage> => new Promise((resolve, reject) => {
      let parsed: URL
      try { parsed = permittedUrl(target) } catch (error) { reject(error); return }
      if (redirects > 5) { reject(new Error('下载重定向次数过多')); return }
      const request = https.get(parsed, {
        signal,
        headers: { 'User-Agent': 'GitHubDesktopPlus-Updater', Accept: 'application/octet-stream, application/json' },
      }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
          clearTimeout(deadline)
          response.resume()
          visit(new URL(response.headers.location, parsed).href, redirects + 1).then(resolve, reject)
        } else if (response.statusCode !== 200) {
          clearTimeout(deadline)
          response.resume()
          reject(new Error(`HTTP ${response.statusCode ?? 0}`))
        } else {
          response.once('close', () => clearTimeout(deadline))
          resolve(response)
        }
      })
      const deadline = setTimeout(() => request.destroy(new Error('连接超时，请更换下载线路')), timeoutMs)
      request.setTimeout(Math.min(timeoutMs, 15_000), () => request.destroy(new Error('连接长时间无响应')))
      request.once('error', error => { clearTimeout(deadline); reject(error) })
    })
    return visit(url, 0)
  },
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = STABLE_VERSION.exec(candidate)
  const previous = STABLE_VERSION.exec(current)
  if (!next || !previous) throw new Error('无法识别版本号')
  for (let index = 1; index <= 3; index++) {
    // Version components may exceed JS's safe integer range.
    const delta = BigInt(next[index]!) - BigInt(previous[index]!)
    if (delta !== 0n) return delta > 0n
  }
  return false
}

interface VerifiedRelease {
  info: GdpRelease
  downloadUrl: string
  sha256: string
}

export function parseRelease(value: unknown): VerifiedRelease {
  if (!value || typeof value !== 'object') throw new Error('发布信息格式错误')
  const data = value as Record<string, unknown>
  if (typeof data.tag_name !== 'string' || !STABLE_VERSION.test(data.tag_name) || data.draft === true || data.prerelease === true) {
    throw new Error('未找到可用的稳定版本')
  }
  const tag = data.tag_name
  const downloadUrl = `${RELEASES_URL}/download/${tag}/${WINDOWS_SETUP_NAME}`
  const asset = (Array.isArray(data.assets) ? data.assets : []).find((item: unknown) =>
    item && typeof item === 'object' && (item as Record<string, unknown>).name === WINDOWS_SETUP_NAME,
  ) as Record<string, unknown> | undefined
  const digest = typeof asset?.digest === 'string' ? DIGEST.exec(asset.digest) : null
  if (!asset || asset.browser_download_url !== downloadUrl || !digest ||
    typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_INSTALLER) {
    throw new Error('此版本缺少安装包或 GitHub SHA-256 校验信息，请在发布页下载')
  }
  return {
    info: {
      version: tag.replace(/^v/, ''), url: `${RELEASES_URL}/tag/${tag}`,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : '',
      notes: typeof data.body === 'string' ? data.body.slice(0, 6000) : '', size: asset.size,
    },
    downloadUrl, sha256: digest[1]!.toLowerCase(),
  }
}

/** Auto tries the akams-listed routes, then the original source. A selected
 * route is tried first and can fall back, while Direct never contacts a mirror. */
export function updateRoutes(mirror: DownloadMirror, metadata = false): Array<{ label: string; prefix: string }> {
  const normalized = normalizeDownloadMirror(mirror)
  const direct = { label: 'GitHub 直连', prefix: '' }
  if (normalized === 'direct') return [direct]
  const nodes = DOWNLOAD_MIRRORS.filter(node => !metadata || node.api)
  const preferred = nodes.find(node => node.id === normalized)
  const routes = (preferred ? [preferred, ...nodes.filter(node => node !== preferred)] : nodes)
    .map(node => ({ label: node.id, prefix: node.prefix }))
  // Release metadata prefers GitHub directly, to avoid a proxy's cached version.
  return metadata ? [direct, ...routes] : [...routes, direct]
}

async function readMetadata(stream: Readable): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk as Uint8Array)
      size += buffer.length
      if (size > MAX_METADATA) throw new Error('发布信息超过大小限制')
      chunks.push(buffer)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    stream.destroy()
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface UpdaterOptions {
  version: string
  directory: string
  publish(state: UpdateState): void
  openInstaller(file: string): Promise<void>
  transport?: UpdateTransport
  supported?: boolean
}

export class GdpUpdater {
  private state: UpdateState
  private release: VerifiedRelease | undefined
  private active: AbortController | undefined
  private readyFile: string | undefined
  private installing = false
  private readonly transport: UpdateTransport

  constructor(private readonly options: UpdaterOptions) {
    this.state = { phase: 'idle', currentVersion: options.version, revision: 0 }
    this.transport = options.transport ?? httpsUpdateTransport
  }

  snapshot(): UpdateState { return structuredClone(this.state) }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.options.publish(this.snapshot())
    return this.snapshot()
  }

  async check(mirror: DownloadMirror): Promise<UpdateState> {
    if (this.active || this.installing) return this.snapshot()
    const controller = new AbortController()
    this.active = controller
    const previous = this.snapshot()
    this.set({ phase: 'checking', error: undefined })
    const failures: string[] = []
    try {
      for (const route of updateRoutes(mirror, true)) {
        if (controller.signal.aborted) break
        try {
          const response = await this.transport.open(route.prefix + API_URL, controller.signal, 8000)
          const release = parseRelease(await readMetadata(response))
          if (controller.signal.aborted) break
          const same = this.release?.sha256 === release.sha256
          this.release = release
          if (!same) this.readyFile = undefined
          return this.set({
            phase: isNewerVersion(release.info.version, this.options.version) ? (same && this.readyFile ? 'ready' : 'available') : 'current',
            release: release.info, source: route.label, checkedAt: new Date().toISOString(),
            received: undefined, total: undefined,
          })
        } catch (error) { failures.push(`${route.label}：${reason(error)}`) }
      }
      return controller.signal.aborted
        ? this.set({ ...previous, revision: this.state.revision })
        : this.set({ phase: 'error', error: `检查更新失败。${failures.join('；')}` })
    } finally { this.active = undefined }
  }

  async download(mirror: DownloadMirror): Promise<UpdateState> {
    if (this.active || this.installing || this.state.phase === 'ready') return this.snapshot()
    const release = this.release
    if (!release || !isNewerVersion(release.info.version, this.options.version)) return this.snapshot()
    if (this.options.supported === false) return this.set({ phase: 'error', error: '内置安装更新目前支持 Windows x64，请在发布页选择安装包。' })
    const controller = new AbortController()
    this.active = controller
    this.readyFile = undefined
    const finalFile = path.join(this.options.directory, `${release.info.version}-Setup.exe`)
    const partialFile = finalFile + '.part'
    const failures: string[] = []
    this.set({ phase: 'downloading', error: undefined, received: 0, total: release.info.size })
    try {
      await mkdir(this.options.directory, { recursive: true })
      // A single installer cache, including across application restarts.
      for (const entry of await readdir(this.options.directory)) {
        if (/^\d+\.\d+\.\d+-Setup\.exe(?:\.part)?$/.test(entry)) {
          await rm(path.join(this.options.directory, entry), { force: true })
        }
      }
      for (const route of updateRoutes(mirror)) {
        if (controller.signal.aborted) break
        this.set({ source: route.label, received: 0 })
        try {
          const source = await this.transport.open(route.prefix + release.downloadUrl, controller.signal, 180_000)
          const hash = createHash('sha256')
          let received = 0
          let lastProgress = 0
          const meter = new Transform({
            transform: (chunk: Buffer, _encoding, callback) => {
              received += chunk.length
              if (received > release.info.size) { callback(new Error('下载文件大小与发布信息不一致')); return }
              hash.update(chunk)
              if (Date.now() - lastProgress >= 250) {
                lastProgress = Date.now()
                this.set({ received })
              }
              callback(null, chunk)
            },
          })
          await pipeline(source, meter, createWriteStream(partialFile, { flags: 'w' }), { signal: controller.signal })
          if (received !== release.info.size || hash.digest('hex') !== release.sha256) throw new Error('SHA-256 校验失败，已丢弃下载文件')
          if (controller.signal.aborted) break
          await rename(partialFile, finalFile)
          this.readyFile = finalFile
          return this.set({ phase: 'ready', received, error: undefined })
        } catch (error) {
          await rm(partialFile, { force: true })
          failures.push(`${route.label}：${reason(error)}`)
        }
      }
      return controller.signal.aborted
        ? this.set({ phase: 'available', received: undefined, total: undefined, error: undefined })
        : this.set({ phase: 'error', error: `下载失败。${failures.join('；')}` })
    } catch (error) {
      return this.set({ phase: 'error', error: `无法保存安装包：${reason(error)}` })
    } finally {
      await rm(partialFile, { force: true }).catch(() => {})
      this.active = undefined
    }
  }

  cancel(): UpdateState { this.active?.abort(); return this.snapshot() }

  async install(): Promise<OkResult> {
    if (this.installing) return { ok: false, reason: '安装向导已启动' }
    if (!this.readyFile || this.state.phase !== 'ready' || !this.release) return { ok: false, reason: '请先下载并校验安装包' }
    this.installing = true
    let verified = false
    try {
      // Check again immediately before execution; a stale or modified cache is
      // never launched. The renderer cannot choose the executable or arguments.
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(this.readyFile)) hash.update(chunk)
      if (hash.digest('hex') !== this.release.sha256) {
        await rm(this.readyFile, { force: true })
        this.readyFile = undefined
        this.set({ phase: 'available', error: '安装包已变化，请重新下载' })
        return { ok: false, reason: '安装包校验失败，请重新下载' }
      }
      verified = true
      await this.options.openInstaller(this.readyFile)
      return { ok: true }
    } catch (error) {
      if (!verified) {
        this.readyFile = undefined
        this.set({ phase: 'available', error: '安装包不可用，请重新下载' })
      }
      return { ok: false, reason: reason(error) }
    }
    finally { this.installing = false }
  }
}
