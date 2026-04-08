/**
 * Update Blocker — prevents GitHub Desktop from auto-updating.
 * Hooks Module._load to intercept electron's autoUpdater.
 * Uses Object.defineProperty on the cached exports object so the patch
 * persists across all require('electron') calls (no Proxy needed).
 */

const Module = require("module");
const originalLoad = Module._load;

const noopUpdater = {
  on: () => noopUpdater,
  once: () => noopUpdater,
  removeListener: () => noopUpdater,
  removeAllListeners: () => noopUpdater,
  setFeedURL: () => {},
  getFeedURL: () => "",
  checkForUpdates: () => {
    console.log("[GDP] autoUpdater.checkForUpdates() blocked");
  },
  quitAndInstall: () => {
    console.log("[GDP] autoUpdater.quitAndInstall() blocked");
  },
};

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  const result = originalLoad.call(this, request, parent, isMain);

  if (
    (request === "electron" || request === "electron/main") &&
    result &&
    result.autoUpdater &&
    !(result as Record<string, unknown>).__gdpUpdaterPatched
  ) {
    // Mark as patched so we only do this once (Node caches the module exports)
    Object.defineProperty(result, "__gdpUpdaterPatched", {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    // Replace autoUpdater on the cached exports in-place
    Object.defineProperty(result, "autoUpdater", {
      get: () => noopUpdater,
      configurable: true,
      enumerable: true,
    });
    console.log("[GDP] autoUpdater patched — updates blocked");
  }

  return result;
};
