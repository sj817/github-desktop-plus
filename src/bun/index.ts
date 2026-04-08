import { BrowserWindow, BrowserView } from "electrobun/bun";
import { type MainViewRPC, type GDPConfig, type StatusInfo, type LogEntry, type LocaleEntry, defaultConfig } from "../shared/types";
import { detectDesktopPath } from "../shared/platform";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { spawn, type Subprocess } from "bun";

// --- Config persistence ---

const CONFIG_DIR = join(
  process.env.APPDATA ??
    process.env.XDG_CONFIG_HOME ??
    join(process.env.HOME ?? ".", ".config"),
  "github-desktop-plus"
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function loadConfig(): GDPConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      return { ...defaultConfig, ...JSON.parse(raw) };
    }
  } catch {
    // ignore corrupt config
  }
  return { ...defaultConfig };
}

function saveConfigToDisk(config: GDPConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

let config = loadConfig();

// --- Desktop process management ---

let desktopProcess: Subprocess | null = null;
let currentStatus: StatusInfo = {
  status: "stopped",
  pid: null,
  message: "GitHub Desktop is not running",
};

function setStatus(s: StatusInfo) {
  currentStatus = s;
  // Push to webview if window exists
  try {
    win?.webview.rpc?.send.statusUpdate(s);
  } catch {
    // window may not be ready
  }
}

const BAK_SUFFIX = ".gdp.bak";

/**
 * Compute the path to GitHub Desktop's main.js given the exe path.
 * Layout: <exeDir>/resources/app/main.js
 */
function getGDMainJsPath(exePath: string): string {
  return join(exePath, "../resources/app/main.js");
}

/**
 * Patch GitHub Desktop's main.js to require our hook first.
 * Backs up original as main.js.gdp.bak and writes a tiny wrapper.
 * Returns true if the patch was applied (or was already applied).
 */
function patchMainJs(mainJsPath: string, hookPath: string): boolean {
  const bakPath = mainJsPath + BAK_SUFFIX;
  try {
    // If a previous run didn't clean up, bak already exists — reuse it.
    if (!existsSync(bakPath)) {
      copyFileSync(mainJsPath, bakPath);
    }
    // Write a minimal CommonJS wrapper:
    // 1. run our hook  2. load original main bundle
    const wrapper = [
      "// Injected by GitHub Desktop Plus — restored on exit",
      `require(${JSON.stringify(hookPath)});`,
      `require(${JSON.stringify(bakPath.replace(/\\/g, "/"))});`,
    ].join("\n");
    writeFileSync(mainJsPath, wrapper, "utf-8");
    console.log(`[GDP] main.js patched (backup: ${bakPath})`);
    return true;
  } catch (e) {
    console.error("[GDP] Failed to patch main.js:", e);
    return false;
  }
}

/**
 * Restore GitHub Desktop's original main.js.
 */
function restoreMainJs(mainJsPath: string): void {
  const bakPath = mainJsPath + BAK_SUFFIX;
  try {
    if (existsSync(bakPath)) {
      copyFileSync(bakPath, mainJsPath);
      unlinkSync(bakPath);
      console.log("[GDP] main.js restored");
    }
  } catch (e) {
    console.error("[GDP] Failed to restore main.js:", e);
  }
}

function getHookPath(): string {
  // Electrobun copies build/hooks → Resources/app/resources/hooks.
  // import.meta.dir resolves to Resources/app/bun/ at runtime.
  // So the hooks are one level up at ../resources/hooks/.
  const candidates = [
    join(import.meta.dir, "../resources/hooks/index.js"),
    // Possible alternate capitalisation on macOS
    join(import.meta.dir, "../Resources/hooks/index.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[GDP] Hook found at: ${p}`);
      return p;
    }
  }
  console.error("[GDP] Hook not found. Tried:", candidates);
  return "";
}

function launchDesktop(): { ok: boolean; error?: string } {
  if (desktopProcess) {
    return { ok: false, error: "GitHub Desktop is already running" };
  }

  const exePath = config.desktopPath || detectDesktopPath();
  if (!exePath || !existsSync(exePath)) {
    return { ok: false, error: `GitHub Desktop not found at: ${exePath || "(not set)"}` };
  }

  const hookPath = getHookPath();
  if (!hookPath) {
    return { ok: false, error: "Hook script not found. Run build:hooks first." };
  }

  // Electron 34+ disables NODE_OPTIONS fuse by default — use main.js patching instead.
  const mainJsPath = getGDMainJsPath(exePath);
  if (!existsSync(mainJsPath)) {
    return { ok: false, error: `main.js not found at: ${mainJsPath}` };
  }

  const patched = patchMainJs(mainJsPath, hookPath);
  if (!patched) {
    return { ok: false, error: "Failed to patch GitHub Desktop main.js" };
  }

  // Pass config to hooks via environment variable
  const hookConfig = JSON.stringify({
    blockUpdates: config.blockUpdates,
    blockTelemetry: config.blockTelemetry,
    logLevel: config.logLevel,
    enableI18n: config.enableI18n,
    locale: config.locale,
  });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GDP_CONFIG: hookConfig,
    // Bun hardcodes __dirname at build time; pass the actual deployed dir explicitly.
    GDP_HOOK_DIR: join(hookPath, ".."),
  };

  try {
    desktopProcess = spawn([exePath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    setStatus({
      status: "running",
      pid: desktopProcess.pid,
      message: `GitHub Desktop running (PID: ${desktopProcess.pid})`,
    });

    // Restore main.js when the process exits
    desktopProcess.exited.then((code) => {
      restoreMainJs(mainJsPath);
      desktopProcess = null;
      setStatus({
        status: "stopped",
        pid: null,
        message: `GitHub Desktop exited (code: ${code})`,
      });
    });

    // Forward GitHub Desktop's stdout/stderr to our console (shows hook logs)
    if (desktopProcess.stdout) {
      (async () => {
        for await (const chunk of desktopProcess!.stdout!) {
          process.stdout.write(chunk);
        }
      })().catch(() => {});
    }
    if (desktopProcess.stderr) {
      (async () => {
        for await (const chunk of desktopProcess!.stderr!) {
          process.stderr.write(chunk);
        }
      })().catch(() => {});
    }

    return { ok: true };
  } catch (e) {
    // Restore on spawn failure too
    restoreMainJs(mainJsPath);
    const msg = e instanceof Error ? e.message : String(e);
    setStatus({ status: "error", pid: null, message: msg });
    return { ok: false, error: msg };
  }
}

function stopDesktop(): { ok: boolean } {
  if (desktopProcess) {
    const exePath = config.desktopPath || detectDesktopPath();
    desktopProcess.kill();
    desktopProcess = null;
    // Restore immediately when stopped by user
    if (exePath) restoreMainJs(getGDMainJsPath(exePath));
    setStatus({ status: "stopped", pid: null, message: "GitHub Desktop stopped by user" });
  }
  return { ok: true };
}

// --- Log streaming ---

const LOG_JSON_FILE = join(
  process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
  "gdp-hooks-stream.jsonl"
);

function readNewLogs(since?: string): LogEntry[] {
  try {
    if (!existsSync(LOG_JSON_FILE)) return [];
    const content = readFileSync(LOG_JSON_FILE, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (!since || entry.ts > since) {
          entries.push(entry);
        }
      } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return [];
  }
}

// Poll logs and push to webview
let logPollTimer: ReturnType<typeof setInterval> | null = null;
let lastPushedTs = "";

function startLogPolling() {
  if (logPollTimer) return;
  logPollTimer = setInterval(() => {
    const logs = readNewLogs(lastPushedTs);
    if (logs.length > 0) {
      lastPushedTs = logs[logs.length - 1].ts;
      try {
        win?.webview.rpc?.send.logPush(logs);
      } catch { /* window may not be ready */ }
    }
  }, 1000);
}

function stopLogPolling() {
  if (logPollTimer) {
    clearInterval(logPollTimer);
    logPollTimer = null;
  }
}

// --- Locale file management ---

function getLocaleDir(): string {
  const candidates = [
    join(import.meta.dir, "../resources/locales"),
    join(import.meta.dir, "../../locales"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

function listAvailableLocales(): string[] {
  const dir = getLocaleDir();
  try {
    const items = readdirSync(dir);
    const locales: string[] = [];
    for (const item of items) {
      const full = join(dir, item);
      if (existsSync(join(full, "menu.json")) || existsSync(join(full, "ui.json"))) {
        locales.push(item);
      }
    }
    return locales;
  } catch {
    return [];
  }
}

function getLocaleEntries(locale: string, category: string): LocaleEntry[] {
  const dir = getLocaleDir();
  const file = join(dir, locale, `${category}.json`);
  try {
    if (!existsSync(file)) return [];
    const data = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    const entries: LocaleEntry[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (key === "_meta") continue;
      entries.push({ key, value: String(value), category });
    }
    return entries;
  } catch {
    return [];
  }
}

function saveLocaleEntriesToDisk(locale: string, category: string, entries: LocaleEntry[]): { ok: boolean; error?: string } {
  const dir = getLocaleDir();
  const localeDir = join(dir, locale);
  const file = join(localeDir, `${category}.json`);
  try {
    mkdirSync(localeDir, { recursive: true });
    let meta: Record<string, unknown> | undefined;
    try {
      const existing = JSON.parse(readFileSync(file, "utf-8"));
      if (existing._meta) meta = existing._meta;
    } catch { /* file may not exist */ }

    const data: Record<string, unknown> = {};
    if (meta) data._meta = meta;
    for (const entry of entries) {
      data[entry.key] = entry.value;
    }
    writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// --- RPC setup ---

const mainViewRPC = BrowserView.defineRPC<MainViewRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {
      getConfig: () => ({ ...config }),
      saveConfig: (newConfig) => {
        try {
          config = { ...newConfig };
          saveConfigToDisk(config);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      },
      detectDesktopPath: () => {
        const path = detectDesktopPath();
        return { path, found: path.length > 0 };
      },
      launchDesktop: () => {
        const result = launchDesktop();
        if (result.ok) startLogPolling();
        return result;
      },
      stopDesktop: () => {
        stopLogPolling();
        return stopDesktop();
      },
      getStatus: () => ({ ...currentStatus }),
      getLogs: (params) => readNewLogs(params.since),
      getLocaleEntries: (params) => getLocaleEntries(params.locale, params.category),
      saveLocaleEntries: (params) => saveLocaleEntriesToDisk(params.locale, params.category, params.entries),
      listLocales: () => listAvailableLocales(),
    },
    messages: {},
  },
});

// --- Window creation ---

// Check for HMR dev server
const hmrUrl = "http://localhost:5173";
let url = "views://mainview/index.html";

try {
  const res = await fetch(hmrUrl, { signal: AbortSignal.timeout(500) });
  if (res.ok) {
    url = hmrUrl;
  }
} catch {
  // No HMR server, use bundled views
}

const win = new BrowserWindow({
  title: "GitHub Desktop Plus",
  url,
  frame: {
    width: 860,
    height: 640,
    x: 200,
    y: 200,
  },
  rpc: mainViewRPC,
});

// Exit app when window closes
win.on("close", () => {
  stopDesktop();
  process.exit(0);
});
