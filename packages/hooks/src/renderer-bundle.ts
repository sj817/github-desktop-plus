import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { patchRendererSource } from './copilot-unlock'
import { gdpLog } from './logger'
import { patchRendererPerformance } from './renderer-performance'
import { patchRendererMemory } from './renderer-memory'

interface ProtocolLike {
  handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void
}

interface SessionLike {
  defaultSession?: { protocol?: ProtocolLike }
}

interface NetLike {
  fetch(input: Request, options?: { bypassCustomProtocolHandlers?: boolean }): Promise<Response>
}

// Keep at most the two Copilot variants of a renderer bundle. Old app versions
// must not leave arbitrarily many multi-megabyte source strings in memory.
const MAX_CACHED_BUNDLES = 2

function rendererPathFor(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:' || !parsed.pathname.endsWith('/renderer.js')) return null
    return fileURLToPath(parsed)
  } catch {
    return null
  }
}

/** Serve compatible renderer transforms without changing the installed app. */
export function setupRendererBundle(
  session: SessionLike,
  net: NetLike,
  isCopilotEnabled: () => boolean
): void {
  const protocol = session.defaultSession?.protocol
  if (!protocol || typeof protocol.handle !== 'function') {
    gdpLog('Renderer bundle: session.protocol.handle unavailable', 'warn', 'system')
    return
  }

  const cache = new Map<string, string | null>()
  const inFlight = new Map<string, Promise<string | null>>()

  const loadBundle = async (filePath: string, copilotEnabled: boolean): Promise<string | null> => {
    // Include stat in the shared operation so simultaneous window loads also
    // share the filesystem work. Each request captures its own config value.
    const pendingKey = JSON.stringify([filePath, copilotEnabled])
    const pending = inFlight.get(pendingKey)
    if (pending) return pending

    const load = async (): Promise<string | null> => {
      const { mtimeMs, size } = await fs.stat(filePath)
      const cacheKey = JSON.stringify([filePath, mtimeMs, size, copilotEnabled])
      if (cache.has(cacheKey)) {
        const code = cache.get(cacheKey) ?? null
        cache.delete(cacheKey)
        cache.set(cacheKey, code)
        return code
      }

      const source = await fs.readFile(filePath, 'utf8')
      const performance = patchRendererPerformance(source)
      const memory = patchRendererMemory(performance.code)
      const copilot = copilotEnabled
        ? patchRendererSource(memory.code)
        : { code: memory.code, applied: 0, skipped: [] }
      const code = performance.applied + memory.applied + copilot.applied > 0 ? copilot.code : null

      // Cache unsupported sources as well, avoiding repeated scans of the
      // same bundle while letting Chromium load its original bytes.
      cache.set(cacheKey, code)
      while (cache.size > MAX_CACHED_BUNDLES) {
        cache.delete(cache.keys().next().value!)
      }
      gdpLog(
        `Renderer bundle: performance=${performance.applied}, memory=${memory.applied}, copilot=${copilot.applied}` +
          (performance.skipped.length ? `; unsupported performance patches: ${performance.skipped.join(', ')}` : '') +
          (memory.skipped.length ? `; unsupported memory patches: ${memory.skipped.join(', ')}` : '') +
          (copilot.skipped.length ? `; unsupported Copilot patches: ${copilot.skipped.join(', ')}` : ''),
        code === null || performance.skipped.length || memory.skipped.length || copilot.skipped.length ? 'warn' : 'info',
        'system'
      )
      return code
    }

    const operation = load().catch(error => {
      gdpLog(`Renderer bundle: reading or patching ${filePath} failed: ${error}`, 'error', 'system')
      return null
    }).finally(() => {
      inFlight.delete(pendingKey)
    })
    inFlight.set(pendingKey, operation)
    return operation
  }

  try {
    protocol.handle('file', async request => {
      const passthrough = () => net.fetch(request, { bypassCustomProtocolHandlers: true })
      // Preserve native handling for partial requests and non-script resources.
      if (request.method !== 'GET' || request.headers.has('range')) return passthrough()
      const filePath = rendererPathFor(request.url)
      if (filePath === null) return passthrough()

      const code = await loadBundle(filePath, isCopilotEnabled())
      if (code === null) return passthrough()
      return new Response(code, {
        status: 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      })
    })
    gdpLog('Renderer bundle interceptor registered', 'info', 'system')
  } catch (error) {
    gdpLog(`Renderer bundle: could not register file handler: ${error}`, 'error', 'system')
  }
}
