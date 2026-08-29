/**
 * Copilot gate unlock — main process.
 *
 * GitHub Desktop 3.6 can drive any OpenAI-compatible endpoint through its own
 * "bring your own key" providers, but the commit-message UI stays hidden
 * behind a Copilot entitlement check:
 *
 *   // app/src/lib/feature-flag.ts
 *   enableCommitMessageGeneration = account =>
 *     account.features.includes('desktop_copilot_generate_commit_message') &&
 *     account.isCopilotDesktopEnabled
 *
 * That check is pure client-side UI gating, so we rewrite it in the renderer
 * bundle as it loads. Nothing is written to disk: `session.protocol.handle`
 * serves a patched copy of `renderer.js` and passes every other `file://`
 * request straight through.
 *
 * Scope: this only unlocks GitHub Desktop's own UI so it will talk to the
 * provider the user configured under 选项 → Copilot → 提供方. It does NOT grant
 * access to GitHub's hosted Copilot models — those calls are authorised
 * server-side and come back 402 Payment Required regardless.
 */

import { gdpLog } from './logger'

const _fs: typeof import('fs') = require('fs')

interface Patch {
  readonly name: string
  readonly pattern: RegExp
  readonly replacement: string
}

/**
 * Anchored on the feature-flag string literals, which minification leaves
 * untouched; identifier names are matched loosely because they change with
 * every GitHub Desktop build.
 */
const PATCHES: ReadonlyArray<Patch> = [
  {
    // enableCommitMessageGeneration — gates the "generate commit message" button
    name: 'enableCommitMessageGeneration',
    pattern:
      /\(([A-Za-z_$][\w$]*)\.features\?\?\[\]\)\.includes\("desktop_copilot_generate_commit_message"\)&&\1\.isCopilotDesktopEnabled/g,
    replacement: '!0',
  },
  {
    // enableCopilotSdkCommitMessageGeneration — gates the Copilot SDK path,
    // which is what actually talks to a BYOK provider
    name: 'enableCopilotSdkCommitMessageGeneration',
    pattern:
      /[A-Za-z_$][\w$]*\(\)\|\|\([A-Za-z_$][\w$]*\.features\?\?\[\]\)\.includes\("desktop_enable_copilot_sdk_commit_message_generation"\)/g,
    replacement: '!0',
  },
  {
    // fetchUserCopilotInfo — the single point where the entitlement lands on
    // the Account, covering the call sites that read the field directly
    // instead of going through the feature-flag helpers.
    name: 'fetchUserCopilotInfo',
    pattern: /isCopilotDesktopEnabled:[A-Za-z_$][\w$]*\.isCopilotDesktopEnabled/g,
    replacement: 'isCopilotDesktopEnabled:!0',
  },
]

/** Apply every patch, reporting which ones actually matched. */
export function patchRendererSource(source: string): { code: string; applied: number } {
  let code = source
  let applied = 0

  for (const patch of PATCHES) {
    let hits = 0
    code = code.replace(patch.pattern, () => {
      hits++
      return patch.replacement
    })
    if (hits === 0) {
      // A miss means GitHub Desktop changed shape — say so rather than
      // silently shipping a half-applied patch.
      gdpLog(`Copilot unlock: pattern "${patch.name}" did not match`, 'warn', 'system')
    } else {
      applied += hits
      gdpLog(`Copilot unlock: patched ${patch.name} (${hits}×)`, 'info', 'system')
    }
  }

  return { code, applied }
}

interface ProtocolLike {
  handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void
  isProtocolHandled?(scheme: string): boolean
}

interface SessionLike {
  defaultSession?: { protocol?: ProtocolLike }
}

interface NetLike {
  fetch(input: Request, options?: { bypassCustomProtocolHandlers?: boolean }): Promise<Response>
}

/** `file:///C:/…/renderer.js` → the local path Node can read. */
function localPathFor(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return null
    return decodeURIComponent(
      process.platform === 'win32' ? parsed.pathname.replace(/^\//, '') : parsed.pathname
    )
  } catch {
    return null
  }
}

/**
 * Intercept the renderer bundle and serve a patched copy. Every other
 * `file://` request is handed back to Chromium untouched.
 */
export function setupCopilotUnlock(
  session: SessionLike,
  net: NetLike,
  isEnabled: () => boolean
): void {
  const protocol = session.defaultSession?.protocol
  if (!protocol || typeof protocol.handle !== 'function') {
    gdpLog('Copilot unlock: session.protocol.handle unavailable', 'warn', 'system')
    return
  }

  // Patching a ~10MB bundle is not free, but it happens once per window load.
  let cache: { path: string; mtimeMs: number; code: string } | null = null

  const patchedBundle = (filePath: string): string | null => {
    try {
      const { mtimeMs } = _fs.statSync(filePath)
      if (cache !== null && cache.path === filePath && cache.mtimeMs === mtimeMs) {
        return cache.code
      }
      const source = _fs.readFileSync(filePath, 'utf-8')
      const { code, applied } = patchRendererSource(source)
      if (applied === 0) {
        return null
      }
      cache = { path: filePath, mtimeMs, code }
      return code
    } catch (e) {
      gdpLog(`Copilot unlock: reading ${filePath} failed: ${e}`, 'error', 'system')
      return null
    }
  }

  try {
    protocol.handle('file', async (request: Request) => {
      const passthrough = () => net.fetch(request, { bypassCustomProtocolHandlers: true })

      if (!isEnabled() || !request.url.endsWith('/renderer.js')) {
        return passthrough()
      }

      const filePath = localPathFor(request.url)
      if (filePath === null) {
        return passthrough()
      }

      const code = patchedBundle(filePath)
      if (code === null) {
        return passthrough()
      }

      return new Response(code, {
        status: 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      })
    })
    gdpLog('Copilot unlock: renderer bundle interceptor registered', 'info', 'system')
  } catch (e) {
    gdpLog(`Copilot unlock: could not register file handler: ${e}`, 'error', 'system')
  }
}
