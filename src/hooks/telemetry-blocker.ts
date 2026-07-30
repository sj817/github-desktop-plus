import { gdpLog } from './logger'

type BeforeRequestDetails = { url: string }
type BeforeRequestCallback = (resp: { cancel: boolean }) => void
type BeforeRequestListener = (details: BeforeRequestDetails, callback: BeforeRequestCallback) => void

const TELEMETRY_URL_RE = /^[a-z]+:\/\/(central|usage|stats)\.github\.com\//i

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Electron match pattern ('*://central.github.com/*') → RegExp
function globToRegExp(glob: string): RegExp {
  return new RegExp('^' + glob.split('*').map(escapeRegex).join('.*') + '$', 'i')
}

/**
 * Telemetry blocking that SURVIVES GitHub Desktop's own webRequest usage.
 *
 * Electron's webRequest.onBeforeRequest holds a single listener per session —
 * GHD installs its own (OrderedWebRequest) during startup, which would simply
 * replace ours. So instead we patch the registration method itself: our
 * combined listener stays installed permanently, GHD's listener is captured as
 * a downstream and still runs for everything we don't cancel.
 *
 * The block decision consults `isBlocked()` per request, so the settings
 * toggle applies at runtime.
 */
export function setupTelemetryBlocker(
  app: {
    on(event: string, cb: () => void): void
    isReady(): boolean
    whenReady(): Promise<void>
  },
  session: {
    defaultSession: {
      webRequest: {
        onBeforeRequest(
          filter: { urls: string[] } | BeforeRequestListener | null,
          cb?: BeforeRequestListener,
        ): void
      }
    }
  },
  isBlocked: () => boolean,
): void {
  const handler = () => {
    try {
      const webRequest = session.defaultSession.webRequest
      const originalRegister = webRequest.onBeforeRequest.bind(webRequest)

      let downstreamListener: BeforeRequestListener | null = null
      let downstreamMatchers: RegExp[] | null = null // null → match all URLs

      const downstreamMatches = (url: string): boolean => {
        if (downstreamMatchers === null) return true
        return downstreamMatchers.some(re => re.test(url))
      }

      const combined: BeforeRequestListener = (details, callback) => {
        try {
          if (TELEMETRY_URL_RE.test(details.url) && isBlocked()) {
            gdpLog(`Telemetry blocked: ${details.url}`, 'block', 'telemetry')
            callback({ cancel: true })
            return
          }
          if (downstreamListener && downstreamMatches(details.url)) {
            downstreamListener(details, callback)
            return
          }
        } catch (error) {
          gdpLog(`Telemetry interceptor error: ${error}`, 'error', 'telemetry')
        }
        callback({ cancel: false })
      }

      // Install ours for ALL urls; the telemetry check is a cheap regex.
      originalRegister(combined)

      // Future registrations (i.e. GHD's) become the downstream instead of
      // replacing us.
      webRequest.onBeforeRequest = (
        filterOrListener: { urls: string[] } | BeforeRequestListener | null,
        maybeListener?: BeforeRequestListener,
      ): void => {
        if (typeof filterOrListener === 'function') {
          downstreamListener = filterOrListener
          downstreamMatchers = null
        } else if (filterOrListener === null && maybeListener === undefined) {
          downstreamListener = null
          downstreamMatchers = null
        } else {
          downstreamListener = maybeListener ?? null
          const urls = filterOrListener?.urls
          downstreamMatchers = Array.isArray(urls) ? urls.map(globToRegExp) : null
        }
        gdpLog('Downstream webRequest listener captured (GHD)', 'info', 'telemetry')
        // Re-assert ours as the actual installed listener.
        originalRegister(combined)
      }

      gdpLog('Telemetry interceptor active — wraps downstream webRequest, follows live config', 'info', 'telemetry')
    } catch (error) {
      gdpLog(`Telemetry blocker failed: ${error}`, 'error', 'telemetry')
    }
  }

  if (app.isReady()) {
    handler()
  } else {
    app.on('ready', handler)
  }
}
