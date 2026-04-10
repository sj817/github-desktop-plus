import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface HookLogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "block";
  category: "update" | "telemetry" | "i18n" | "menu" | "system" | "navbar";
  message: string;
}

interface InspectorResponse {
  id?: number;
  result?: {
    result?: {
      type?: string;
      value?: unknown;
      description?: string;
      unserializableValue?: string;
    };
    exceptionDetails?: {
      text?: string;
      exception?: {
        description?: string;
        value?: unknown;
      };
    };
  };
}

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const hookLogPath = join(tmpdir(), "gdp-hooks-stream.jsonl");
const rendererProbeFile = join(tmpdir(), "gdp-self-check-renderer.json");
const configDir = join(
  process.env.APPDATA ??
    process.env.XDG_CONFIG_HOME ??
    join(process.env.HOME ?? ".", ".config"),
  "github-desktop-plus"
);
const userLocaleDir = join(configDir, "locales", "zh-CN");
const userUiFile = join(userLocaleDir, "ui.json");
const probeId = "__gdp_i18n_probe__";
const probeSourceText = "Settings";
const builtInProbeTranslation = "设置";
const sentinelText = `GDP HOT RELOAD ${Date.now()}`;
const wsUrlPattern = /(ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/;
const ansiPattern = /\x1b\[[0-9;]*m/g;
let rendererProbeSequence = 0;

function log(message: string) {
  console.log(`[self-check] ${message}`);
}

function stripAnsi(input: string) {
  return input.replace(ansiPattern, "");
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function commandName(name: string) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function attachLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", chunk => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      onLine(line);
    }
  });
}

async function waitFor<T>(
  action: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  label: string,
  intervalMs = 250
): Promise<T> {
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await action();
      if (result !== null && result !== undefined && result !== false) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

function readHookEntries(): HookLogEntry[] {
  if (!existsSync(hookLogPath)) {
    return [];
  }

  return readFileSync(hookLogPath, "utf8")
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as HookLogEntry);
}

async function waitForHookMessage(
  pattern: RegExp,
  timeoutMs: number,
  label: string
) {
  return waitFor(async () => {
    const entries = readHookEntries();
    return entries.find(entry => pattern.test(entry.message)) ?? null;
  }, timeoutMs, label, 200);
}

function spawnCommand(
  command: string,
  args: string[],
  cwd = rootDir
): ChildProcessWithoutNullStreams {
  return spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runCommand(command: string, args: string[], cwd = rootDir) {
  const child = spawnCommand(command, args, cwd);
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", chunk => {
    stdout += chunk;
  });
  child.stderr.on("data", chunk => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 0));
  });

  return { exitCode, stdout, stderr };
}

class InspectorClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: InspectorResponse["result"]) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private socket: WebSocket | null = null;

  public async connect(url: string) {
    const socket = new WebSocket(url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        event => reject(new Error(`Inspector socket error: ${String(event)}`)),
        { once: true }
      );
    });

    socket.addEventListener("message", event => {
      const payload = JSON.parse(String(event.data)) as InspectorResponse;
      if (payload.id === undefined) {
        return;
      }

      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }

      this.pending.delete(payload.id);
      pending.resolve(payload.result);
    });

    socket.addEventListener("close", () => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error("Inspector socket closed"));
      }
      this.pending.clear();
    });
  }

  public async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send("Runtime.evaluate", {
      expression,
      includeCommandLineAPI: true,
      awaitPromise: true,
      returnByValue: true,
      replMode: true,
    });

    const exception = response?.exceptionDetails;
    if (exception) {
      const description =
        exception.exception?.description ??
        exception.text ??
        "Unknown inspector evaluation error";
      throw new Error(description);
    }

    const result = response?.result;
    if (!result) {
      return undefined as T;
    }

    if ("value" in result) {
      return result.value as T;
    }

    if (result.unserializableValue !== undefined) {
      return result.unserializableValue as T;
    }

    return result.description as T;
  }

  public close() {
    this.socket?.close();
    this.socket = null;
  }

  private send(method: string, params: Record<string, unknown>) {
    const socket = this.socket;
    if (!socket) {
      throw new Error("Inspector socket not connected");
    }

    const id = this.nextId++;
    socket.send(JSON.stringify({ id, method, params }));

    return new Promise<InspectorResponse["result"]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

async function dispatchRendererScript(
  client: InspectorClient,
  windowId: number,
  token: string,
  jsCode: string
) {
  await client.evaluate(`(() => {
    const fs = require("fs");
    const outputPath = ${JSON.stringify(rendererProbeFile)};
    const win = require("electron").BrowserWindow.fromId(${windowId});
    if (!win) {
      fs.writeFileSync(outputPath, JSON.stringify({
        token: ${JSON.stringify(token)},
        ok: false,
        error: "No BrowserWindow available for id ${windowId}",
      }), "utf8");
      return false;
    }

    win.webContents.executeJavaScript(${JSON.stringify(jsCode)}).catch(error => {
      fs.writeFileSync(outputPath, JSON.stringify({
        token: ${JSON.stringify(token)},
        ok: false,
        error: String(error),
        stack: error && error.stack ? String(error.stack) : "",
      }), "utf8");
    });

    return true;
  })()`);
}

async function runRendererProbe<T>(
  client: InspectorClient,
  windowId: number,
  label: string,
  body: string,
  timeoutMs = 10000
): Promise<T> {
  const token = `${Date.now()}-${++rendererProbeSequence}-${label}`;
  const script = `(() => {
    const fs = require("fs");
    const outputPath = ${JSON.stringify(rendererProbeFile)};
    const token = ${JSON.stringify(token)};

    try {
      const result = (() => { ${body} })();
      fs.writeFileSync(outputPath, JSON.stringify({ token, ok: true, result }), "utf8");
    } catch (error) {
      fs.writeFileSync(outputPath, JSON.stringify({
        token,
        ok: false,
        error: String(error),
        stack: error && error.stack ? String(error.stack) : "",
      }), "utf8");
    }
  })()`;

  await dispatchRendererScript(client, windowId, token, script);

  const payload = await waitFor(async () => {
    if (!existsSync(rendererProbeFile)) {
      return null;
    }

    const raw = JSON.parse(readFileSync(rendererProbeFile, "utf8")) as {
      token?: string;
      ok?: boolean;
      result?: T;
      error?: string;
      stack?: string;
    };

    return raw.token === token ? raw : null;
  }, timeoutMs, `renderer probe: ${label}`, 200);

  if (!payload.ok) {
    throw new Error(`Renderer probe '${label}' failed: ${payload.error ?? "unknown error"}`);
  }

  return payload.result as T;
}

async function waitForMainWindow(client: InspectorClient) {
  return waitFor(async () => {
    const state = await client.evaluate<{ count: number; title: string | null; id: number | null }>(`(() => {
      const { BrowserWindow } = require("electron");
      const windows = BrowserWindow.getAllWindows();
      return {
        count: windows.length,
        id: windows[0]?.id ?? null,
        title: windows[0]?.getTitle?.() ?? null,
      };
    })()`);
    return state.count > 0 ? state : null;
  }, 30000, "main BrowserWindow");
}

async function findInjectedWindowId(client: InspectorClient) {
  const startedAt = Date.now();
  let lastSnapshot = "<no BrowserWindow found>";

  while (Date.now() - startedAt < 15000) {
    const windows = await client.evaluate<Array<{ id: number; title: string | null; url: string }>>(`(() => {
      const { BrowserWindow } = require("electron");
      return BrowserWindow.getAllWindows().map(win => ({
        id: win.id,
        title: win.getTitle?.() ?? null,
        url: win.webContents.getURL(),
      }));
    })()`);

    const snapshotParts: string[] = [];

    for (const window of windows) {
      try {
        const state = await runRendererProbe<{
          hasConfig: boolean;
          hasTranslateTree: boolean;
          readyState: string;
          href: string;
        }>(
          client,
          window.id,
          "window-globals",
          `return {
            hasConfig: window.__GDP_CONFIG__ != null,
            hasTranslateTree: typeof window.__gdpTranslateTree === "function",
            readyState: document.readyState,
            href: window.location.href,
          };`,
          4000
        );

        snapshotParts.push(
          `id=${window.id} title=${JSON.stringify(window.title)} url=${JSON.stringify(window.url)} href=${JSON.stringify(state.href)} ready=${state.readyState} config=${state.hasConfig} translateTree=${state.hasTranslateTree}`
        );

        if (state.hasConfig && state.hasTranslateTree) {
          log(`Detected injected renderer on window ${window.id}: ${window.url}`);
          return window.id;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        snapshotParts.push(
          `id=${window.id} title=${JSON.stringify(window.title)} url=${JSON.stringify(window.url)} error=${JSON.stringify(message)}`
        );
      }
    }

    if (snapshotParts.length > 0) {
      lastSnapshot = snapshotParts.join(" | ");
    }

    await delay(400);
  }

  throw new Error(`Timed out waiting for renderer hook globals. Last window snapshot: ${lastSnapshot}`);
}

async function stopGDPDev(child: ChildProcessWithoutNullStreams) {
  log("Stopping GDP dev session...");
  const cargoResult = await runCommand("cargo", [
    "run",
    "--manifest-path",
    "rust/Cargo.toml",
    "-p",
    "gdp",
    "--",
    "stop",
  ]);

  if (cargoResult.exitCode !== 0) {
    log(`gdp stop exited with ${cargoResult.exitCode}; stderr: ${stripAnsi(cargoResult.stderr).trim()}`);
  }

  if (child.exitCode !== null) {
    return;
  }

  const exited = await Promise.race([
    waitFor(async () => (child.exitCode !== null ? true : null), 10000, "dev process exit", 250),
    delay(10000).then(() => false),
  ]);

  if (!exited) {
    log("Dev process did not exit in time; forcing termination");
    if (process.platform === "win32") {
      await runCommand("taskkill", ["/F", "/T", "/PID", String(child.pid)]);
    } else {
      child.kill("SIGTERM");
    }
  }
}

async function main() {
  mkdirSync(userLocaleDir, { recursive: true });
  const hadOriginalUserFile = existsSync(userUiFile);
  const originalUserFile = hadOriginalUserFile
    ? readFileSync(userUiFile, "utf8")
    : null;
  const baselineUserFile = JSON.stringify(
    { _meta: { description: "GDP self-check baseline" } },
    null,
    2
  );

  writeFileSync(userUiFile, baselineUserFile, "utf8");

  let devChild: ChildProcessWithoutNullStreams | null = null;
  const inspector = new InspectorClient();
  const importantOutput: string[] = [];
  let wsUrl: string | null = null;
  let childExitCode: number | null = null;

  try {
    log("Starting gdp:dev for live validation...");
    devChild = spawnCommand(commandName("pnpm"), ["run", "gdp:dev"]);

    const recordLine = (source: "stdout" | "stderr", rawLine: string) => {
      const line = stripAnsi(rawLine);
      if (!line.trim()) {
        return;
      }

      const wsMatch = line.match(wsUrlPattern);
      if (wsMatch) {
        wsUrl = wsMatch[1];
      }

      if (
        /Hooks injected successfully|Hook setup complete|Menu\.buildFromTemplate patched|Locale file changed|Watching locale directory|Debugger listening|RangeError|error|warn|Done\./i.test(
          line
        )
      ) {
        const tagged = `[${source}] ${line}`;
        importantOutput.push(tagged);
        console.log(tagged);
      }
    };

    attachLineReader(devChild.stdout, line => recordLine("stdout", line));
    attachLineReader(devChild.stderr, line => recordLine("stderr", line));

    devChild.on("exit", code => {
      childExitCode = code ?? 0;
    });

    await waitFor(
      async () => {
        if (childExitCode !== null) {
          throw new Error(`gdp:dev exited early with code ${childExitCode}`);
        }
        return wsUrl;
      },
      40000,
      "inspector websocket URL"
    );

    await waitForHookMessage(/Hook setup complete/, 40000, "hook setup completion");
    await waitForHookMessage(/Watching locale directory for changes:/, 10000, "locale watcher registration");

    assert.ok(wsUrl, "Inspector WebSocket URL was not captured");
    log(`Connecting to inspector: ${wsUrl}`);
    await inspector.connect(wsUrl);

    await waitForMainWindow(inspector);
    const targetWindowId = await findInjectedWindowId(inspector);

    const rendererHookState = await runRendererProbe<{
      config: Record<string, unknown> | null;
      hasTranslateTree: boolean;
    }>(
      inspector,
      targetWindowId,
      "renderer-config",
      `return {
        config: (window.__GDP_CONFIG__ ?? null),
        hasTranslateTree: typeof window.__gdpTranslateTree === "function",
      };`
    );

    const hookConfig = rendererHookState.config;
    assert.equal(
      hookConfig.blockManualUpdateCheck,
      true,
      "blockManualUpdateCheck should be true in renderer config"
    );
    assert.ok(
      typeof hookConfig.dataDir === "string" && hookConfig.dataDir.length > 0,
      "dataDir should be passed into renderer config"
    );

    const updateInterceptorState = await runRendererProbe<{
      active?: boolean;
      scans?: number;
      interceptions?: string[];
    } | null>(
      inspector,
      targetWindowId,
      "update-interceptor-state",
      `return window.__GDP_UPDATE_INTERCEPTOR_STATE__ ?? null;`
    );
    assert.equal(
      updateInterceptorState?.active,
      true,
      "Update interceptor script should be active in the renderer"
    );

    log("Validating GDP menu injection...");
    const menuState = await waitFor(async () => {
      const state = await inspector.evaluate<{
        ok: boolean;
        topItems: Array<{ id: string; label: string }>;
        gdp: null | {
          id: string;
          label: string;
          items: Array<{ id: string; label: string; enabled: boolean; type: string }>;
        };
      }>(`(() => {
        const { Menu } = require("electron");
        const appMenu = Menu.getApplicationMenu();
        if (!appMenu) {
          return { ok: false, topItems: [], gdp: null };
        }
        const gdp = appMenu.items.find(item => item.id === "gdp");
        return {
          ok: gdp !== undefined,
          topItems: appMenu.items.map(item => ({ id: item.id, label: item.label })),
          gdp: gdp ? {
            id: gdp.id,
            label: gdp.label,
            items: gdp.submenu?.items.map(item => ({
              id: item.id,
              label: item.label,
              enabled: item.enabled,
              type: item.type,
            })) ?? [],
          } : null,
        };
      })()`);
      return state.ok ? state : null;
    }, 15000, "GDP menu presence");

    assert.equal(menuState.gdp?.label, "GDP", "GDP menu label should be GDP");
    assert.ok(
      menuState.gdp?.items.some(item => item.id === "gdp.open-webui"),
      "GDP menu should include open-webui action"
    );
    assert.ok(
      menuState.gdp?.items.some(item => item.id === "gdp.status.manual-updates"),
      "GDP menu should include manual update status item"
    );

    log("Validating update interception dialog...");
    await inspector.evaluate(`(async () => {
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.fromId(${targetWindowId});
      if (!win) {
        throw new Error("No BrowserWindow available for show-about");
      }
      win.webContents.send("menu-event", "show-about");
      return true;
    })()`);

    let lastAboutButtons: Array<{
      text: string;
      intercepted: string;
      disabled: boolean;
      className: string;
      id: string;
      inAbout: boolean;
      inFooter: boolean;
    }> = [];

    const interceptedButton = await waitFor(async () => {
      const buttons = await runRendererProbe<Array<{
        text: string;
        intercepted: string;
        disabled: boolean;
        className: string;
        id: string;
        inAbout: boolean;
        inFooter: boolean;
      }>>(
        inspector,
        targetWindowId,
        "about-buttons",
        `return Array.from(document.querySelectorAll("button")).map(button => ({
          text: (button.textContent || "").trim(),
          intercepted: button.dataset.gdpIntercepted || "",
          disabled: button.disabled,
          className: button.className,
          id: button.id || "",
          inAbout: button.closest("#about") !== null,
          inFooter: button.closest(".dialog-footer") !== null,
        }));`
      );

      lastAboutButtons = buttons;

      return (
        buttons.find(button =>
          button.inAbout &&
          !button.inFooter &&
          button.intercepted === "1"
        ) ?? null
      );
    }, 10000, "About dialog update button interception", 250).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}. Last About buttons: ${JSON.stringify(lastAboutButtons)}`);
    });

    assert.ok(interceptedButton, "Update button was not found in About dialog");

    const clickResult = await runRendererProbe<{ clicked: boolean }>(
      inspector,
      targetWindowId,
      "click-update-button",
      `const button = Array.from(document.querySelectorAll("button")).find(button =>
        button.closest("#about") !== null && button.closest(".dialog-footer") === null
      );
      if (!button) {
        return { clicked: false };
      }
      button.click();
      return { clicked: true };`
    );
    assert.equal(clickResult.clicked, true, "Update button should be clickable in About dialog");

    const updateModal = await waitFor(async () => {
      const state = await runRendererProbe<{ visible: boolean; text: string }>(
        inspector,
        targetWindowId,
        "update-modal",
        `const overlay = document.getElementById("gdp-update-modal-overlay");
        return {
          visible: overlay !== null,
          text: overlay?.textContent || "",
        };`
      );

      return state.visible ? state : null;
    }, 5000, "GDP update interception modal");

    assert.match(updateModal.text, /更新功能已被拦截/, "GDP interception modal should be shown");
    assert.match(updateModal.text, /打开控制面板/, "GDP interception modal should link to WebUI");

    log("Validating user locale override hot reload...");
    const initialProbe = await runRendererProbe<{ text: string; hasTranslateTree: boolean }>(
      inspector,
      targetWindowId,
      "initial-translation-probe",
      `let probe = document.getElementById(${JSON.stringify(probeId)});
      if (!probe) {
        probe = document.createElement("div");
        probe.id = ${JSON.stringify(probeId)};
        document.body.appendChild(probe);
      }
      probe.textContent = ${JSON.stringify(probeSourceText)};
      const translateTree = (window).__gdpTranslateTree;
      if (typeof translateTree === "function") {
        translateTree(probe);
      }
      return {
        text: probe.textContent || "",
        hasTranslateTree: typeof translateTree === "function",
      };`
    );

    assert.equal(initialProbe.hasTranslateTree, true, "translateTree should be exposed globally");
    assert.equal(
      initialProbe.text,
      builtInProbeTranslation,
      "Probe text should use built-in translation before override"
    );

    writeFileSync(
      userUiFile,
      JSON.stringify(
        {
          _meta: { description: "GDP self-check override" },
          [probeSourceText]: sentinelText,
        },
        null,
        2
      ),
      "utf8"
    );

    await waitForHookMessage(/Locale file changed: ui\.json/, 10000, "locale hot reload log");

    const hotReloadText = await waitFor(async () => {
      const state = await runRendererProbe<{ text: string | null }>(
        inspector,
        targetWindowId,
        "hot-reload-probe",
        `return {
          text: document.getElementById(${JSON.stringify(probeId)})?.textContent ?? null,
        };`
      );
      return state.text === sentinelText ? state.text : null;
    }, 15000, "probe text hot reload update", 500);

    assert.equal(hotReloadText, sentinelText, "Probe text should update after locale hot reload");

    writeFileSync(userUiFile, baselineUserFile, "utf8");

    const revertedText = await waitFor(async () => {
      const state = await runRendererProbe<{ text: string | null }>(
        inspector,
        targetWindowId,
        "revert-probe",
        `return {
          text: document.getElementById(${JSON.stringify(probeId)})?.textContent ?? null,
        };`
      );
      return state.text === builtInProbeTranslation ? state.text : null;
    }, 15000, "probe text revert after restoring baseline locale", 500);

    assert.equal(
      revertedText,
      builtInProbeTranslation,
      "Probe text should revert after baseline locale restore"
    );

    log("All desktop self-checks passed ✅");
  } finally {
    inspector.close();

    if (devChild) {
      await stopGDPDev(devChild);
    }

    if (originalUserFile !== null) {
      writeFileSync(userUiFile, originalUserFile, "utf8");
    } else if (existsSync(userUiFile)) {
      unlinkSync(userUiFile);
    }

    if (existsSync(rendererProbeFile)) {
      unlinkSync(rendererProbeFile);
    }
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[self-check] FAILED\n${message}`);
  process.exitCode = 1;
});
