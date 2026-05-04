import { gdpLog } from './logger'

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
          filter: { urls: string[] },
          cb: (details: { url: string }, callback: (resp: { cancel: boolean }) => void) => void,
        ): void
      }
    }
  },
): void {
  const blockedPatterns = [
    '*://central.github.com/*',
    '*://usage.github.com/*',
    '*://stats.github.com/*',
  ]

  const handler = () => {
    try {
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: blockedPatterns },
        (details: { url: string }, callback: (resp: { cancel: boolean }) => void) => {
          gdpLog(`Telemetry blocked: ${details.url}`, 'block', 'telemetry')
          callback({ cancel: true })
        },
      )
      gdpLog('Telemetry blocker active via session.webRequest', 'info', 'telemetry')
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
