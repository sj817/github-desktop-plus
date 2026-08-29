import { gdpLog } from './logger'

/**
 * Patch autoUpdater so updates can be toggled at RUNTIME: the original
 * methods are kept and consulted through `isBlocked()` on every call, so a
 * settings change applies instantly — no relaunch needed.
 */
export function blockUpdates(
  autoUpdater: Record<string, unknown>,
  isBlocked: () => boolean,
): void {
  try {
    const original = {
      checkForUpdates: autoUpdater.checkForUpdates as ((...a: unknown[]) => unknown) | undefined,
      quitAndInstall: autoUpdater.quitAndInstall as ((...a: unknown[]) => unknown) | undefined,
      setFeedURL: autoUpdater.setFeedURL as ((...a: unknown[]) => unknown) | undefined,
    }

    autoUpdater.checkForUpdates = function (...args: unknown[]) {
      if (isBlocked()) {
        gdpLog('autoUpdater.checkForUpdates() blocked', 'block', 'update')
        return undefined
      }
      return original.checkForUpdates?.apply(autoUpdater, args)
    }
    autoUpdater.quitAndInstall = function (...args: unknown[]) {
      if (isBlocked()) {
        gdpLog('autoUpdater.quitAndInstall() blocked', 'block', 'update')
        return undefined
      }
      return original.quitAndInstall?.apply(autoUpdater, args)
    }
    autoUpdater.setFeedURL = function (...args: unknown[]) {
      if (isBlocked()) {
        gdpLog('autoUpdater.setFeedURL() blocked', 'block', 'update')
        return undefined
      }
      return original.setFeedURL?.apply(autoUpdater, args)
    }
    gdpLog('autoUpdater methods wrapped — update blocking follows live config', 'info', 'update')
  } catch (error) {
    gdpLog(`autoUpdater patch failed: ${error}`, 'error', 'update')
  }
}
