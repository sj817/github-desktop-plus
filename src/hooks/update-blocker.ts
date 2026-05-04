import { gdpLog } from './logger'

export function blockUpdates(autoUpdater: Record<string, unknown>): void {
  try {
    autoUpdater.checkForUpdates = () => {
      gdpLog('autoUpdater.checkForUpdates() blocked', 'block', 'update')
    }
    autoUpdater.quitAndInstall = () => {
      gdpLog('autoUpdater.quitAndInstall() blocked', 'block', 'update')
    }
    autoUpdater.setFeedURL = (..._args: unknown[]) => {
      gdpLog('autoUpdater.setFeedURL() blocked', 'block', 'update')
    }
    gdpLog('autoUpdater methods overridden - updates blocked', 'info', 'update')
  } catch (error) {
    gdpLog(`autoUpdater patch failed: ${error}`, 'error', 'update')
  }
}
