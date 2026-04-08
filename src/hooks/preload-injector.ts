/**
 * Preload Injector — hooks BrowserWindow to inject i18n preload script.
 * Runs in the Electron main process (loaded via main.js wrapper).
 * Reads locale data here (main process, known paths) and embeds it
 * directly into executeJavaScript so the renderer never needs to find files.
 */

const Module = require("module");
const path = require("path");
const fs = require("fs");
const originalLoad = Module._load;

const locale: string = process.env.GDP_LOCALE || "zh-CN";

/** Absolute path to the preload script (next to this file). */
function getPreloadPath(): string {
  const bundledPath = path.join(__dirname, "preload", "index.js");
  if (fs.existsSync(bundledPath)) return bundledPath;
  return "";
}

/** Read locale JSON from our resources, return {} on failure. */
function loadTranslations(): Record<string, string> {
  const localeFile = path.join(__dirname, "..", "locales", `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(localeFile, "utf-8"));
  } catch {
    console.warn(`[GDP] Could not load locale file: ${localeFile}`);
    return {};
  }
}

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  const result = originalLoad.call(this, request, parent, isMain);

  if (
    (request === "electron" || request === "electron/main") &&
    result &&
    result.BrowserWindow &&
    !result.__gdpBwPatched
  ) {
    result.__gdpBwPatched = true;
    const OrigBrowserWindow = result.BrowserWindow;
    const preloadPath = getPreloadPath();
    const translations = loadTranslations();

    if (!preloadPath) {
      console.warn("[GDP] preload/index.js not found — i18n skipped");
      return result;
    }

    const PatchedBrowserWindow = function (
      this: unknown,
      options: Record<string, unknown>
    ) {
      // Construct the original window (use 'new' because it's a class)
      const win = new OrigBrowserWindow(options);

      win.webContents.on("did-finish-load", () => {
        try {
          const preloadCode = fs.readFileSync(preloadPath, "utf-8");
          // Embed translations as a global so preload/index.js can use them
          // without needing to read files from an unknown __dirname.
          const injectCode = `(function(){window.__GDP_TRANSLATIONS__=${JSON.stringify(
            translations
          )};${preloadCode}})();`;
          win.webContents.executeJavaScript(injectCode).catch(() => {});
        } catch (e) {
          console.warn("[GDP] executeJavaScript failed:", e);
        }
      });

      return win;
    };

    // Preserve static properties and prototype chain
    Object.setPrototypeOf(PatchedBrowserWindow, OrigBrowserWindow);
    PatchedBrowserWindow.prototype = OrigBrowserWindow.prototype;
    // Copy static enumerable properties (e.g. fromId, getAllWindows …)
    for (const key of Object.keys(OrigBrowserWindow)) {
      (PatchedBrowserWindow as Record<string, unknown>)[key] = (
        OrigBrowserWindow as Record<string, unknown>
      )[key];
    }

    // Mutate the cached exports object so all future require('electron') calls
    // get our patched BrowserWindow without needing a Proxy.
    Object.defineProperty(result, "BrowserWindow", {
      get: () => PatchedBrowserWindow,
      configurable: true,
      enumerable: true,
    });
  }

  return result;
};
