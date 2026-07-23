/**
 * GDP IPC bridge — registers ipcMain handlers for config, locale, logs, and AI.
 * Replaces the former HTTP server (serve.rs / auth.rs / sse.rs).
 *
 * Runs in GitHub Desktop's Electron main process (injected by hooks/index.ts).
 * Renderer preloads access these via ipcRenderer.invoke('gdp:*').
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import * as cp from 'child_process'
import { gdpLog, LOG_JSON_FILE, setLogBroadcast, type LogEntry } from './logger'

// ── Electron types (used as any in main-process hooks) ─────────────────────

interface IpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

interface Shell {
  openPath(path: string): Promise<string>
}

interface TrackedWebContents {
  send(channel: string, ...args: unknown[]): void
  executeJavaScript(code: string): Promise<unknown>
  isDestroyed(): boolean
}

interface BrowserWindowLike {
  getFocusedWindow?(): { webContents: TrackedWebContents } | null
  getAllWindows?(): Array<{ webContents: TrackedWebContents }>
}

// ── Config schema (mirrors config.rs) ───────────────────────────────────────

interface AiConfig {
  enabled: boolean
  base_url: string
  api_key: string
  model: string
  system_prompt: string
  timeout_secs: number
  fallback_to_copilot: boolean
}

// Fixed request-shaping constants for commit-message generation. Deliberately
// not user-configurable: commit messages want consistency (low temperature) and
// are short (small token budget), so exposing these only invites worse output.
const AI_TEMPERATURE = 0.2
const AI_MAX_TOKENS = 256

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoredConfig = Record<string, any>

// ── Internal helpers ─────────────────────────────────────────────────────────

function readConfigFromDisk(configPath: string): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as StoredConfig
  } catch {
    return {}
  }
}

function runGitDiff(repoPath: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    cp.execFile(
      'git', args,
      { cwd: repoPath, timeout: timeoutMs, maxBuffer: 500 * 1024 },
      (err, stdout) => resolve(err ? '' : stdout),
    )
  })
}

// GHD keeps changes unstaged until the moment of commit, so `diff --cached`
// is empty almost all the time.  Fall back to the working-tree diff against
// HEAD (and plain `git diff` for repos with an unborn HEAD).
async function getPendingDiff(repoPath: string, timeoutMs: number): Promise<string> {
  if (!repoPath) return ''
  for (const args of [
    ['diff', '--cached', '-p'],
    ['diff', 'HEAD', '-p'],
    ['diff', '-p'],
  ]) {
    const out = await runGitDiff(repoPath, args, timeoutMs)
    if (out.trim() !== '') return out
  }
  return ''
}

function callOpenAiApi(cfg: AiConfig, diff: string): Promise<{
  ok: boolean; summary?: string; description?: string; reason?: string
}> {
  return new Promise((resolve) => {
    const userPrompt = diff
      ? `以下是 git diff --cached 输出，请根据变更内容生成提交消息：\n\`\`\`\n${diff.slice(0, 8000)}\n\`\`\``
      : '暂无已暂存的变更，请生成一条通用提交消息。'

    const body = JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: cfg.system_prompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: AI_MAX_TOKENS,
    })

    let url: URL
    try { url = new URL('/chat/completions', cfg.base_url) }
    catch { resolve({ ok: false, reason: 'invalid_base_url' }); return }

    const isHttps = url.protocol === 'https:'
    const lib = isHttps ? https : http
    const port = url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80)

    const options = {
      hostname: url.hostname,
      port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.api_key}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: cfg.timeout_secs * 1000,
    }

    const req = lib.request(options, (res) => {
      const status = res.statusCode ?? 0
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        const trimmed = data.trim()
        if (trimmed === '') {
          // Empty body — almost always an unreachable/blocked endpoint or a bare
          // HTTP error. Report the status so the user knows it's the endpoint.
          resolve({ ok: false, reason: status ? `HTTP ${status}（空响应，请检查 Base URL 是否可达）` : '空响应（接口不可达，请检查网络/代理与 Base URL）' })
          return
        }
        let parsed: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          resolve({ ok: false, reason: `HTTP ${status}：接口返回非 JSON（${trimmed.slice(0, 120)}）` })
          return
        }
        if (parsed.error) { resolve({ ok: false, reason: parsed.error.message ?? `api_error (HTTP ${status})` }); return }
        if (status < 200 || status >= 300) { resolve({ ok: false, reason: `HTTP ${status}` }); return }
        const content = parsed.choices?.[0]?.message?.content?.trim() ?? ''
        if (!content) { resolve({ ok: false, reason: 'empty_response' }); return }
        const lines = content.split('\n')
        const summary = lines[0].trim()
        const description = lines.slice(1).join('\n').trim()
        resolve({ ok: true, summary, description: description || undefined })
      })
    })

    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }) })
    req.on('error', (e: Error) => resolve({ ok: false, reason: e.message }))
    req.write(body)
    req.end()
  })
}

// ── Public setup ──────────────────────────────────────────────────────────────

export function setupGdpIpc(
  configPath: string,
  dataDir: string,
  ipcMain: IpcMain,
  shell: Shell,
  BrowserWindow: BrowserWindowLike,
  activeWebContents: TrackedWebContents[],
  onConfigWritten?: (parsed: StoredConfig) => void,
): void {
  // Broadcast log entries to all active renderers (for the dialog Logs tab)
  setLogBroadcast((entry: LogEntry) => {
    const alive = activeWebContents.filter(wc => !wc.isDestroyed())
    for (const wc of alive) {
      try {
        wc.send('gdp:log-line', entry)
      } catch { /* renderer may have closed */ }
    }
  })

  // Renderer → main log bridge (diagnostics from preload scripts).
  ipcMain.handle('gdp:log', (_event, msg: unknown) => {
    gdpLog(`[renderer] ${String(msg)}`, 'info', 'system')
    return true
  })

  // ── Config ────────────────────────────────────────────────────────────────
  ipcMain.handle('gdp:get-config', () => readConfigFromDisk(configPath))

  ipcMain.handle('gdp:set-config', (_event, newCfg: StoredConfig) => {
    try {
      const dir = path.dirname(configPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify(newCfg, null, 2) + '\n', 'utf-8')
      const aiEnabled = (newCfg as { ai?: { enabled?: unknown } })?.ai?.enabled
      gdpLog(`gdp:set-config written (ai.enabled=${aiEnabled}); applying…`, 'info', 'system')
      // Apply + push immediately rather than waiting on the (unreliable) file
      // watcher — this is what makes a settings toggle take effect at once.
      try { onConfigWritten?.(newCfg) } catch (e) { gdpLog(`onConfigWritten threw: ${e}`, 'error', 'system') }
      return { ok: true }
    } catch (e) {
      gdpLog(`gdp:set-config failed: ${e}`, 'error', 'system')
      return { ok: false, reason: String(e) }
    }
  })

  // ── Locale CRUD ───────────────────────────────────────────────────────────
  ipcMain.handle('gdp:list-locales', () => {
    const localesDir = path.join(dataDir, 'locales')
    try {
      return fs.readdirSync(localesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''))
    } catch { return [] }
  })

  ipcMain.handle('gdp:read-locale', (_event, locale: string) => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'locales', `${locale}.json`), 'utf-8')) }
    catch { return {} }
  })

  ipcMain.handle('gdp:write-locale-category', (_event, locale: string, category: string, data: unknown) => {
    const filePath = path.join(dataDir, 'locales', `${locale}.json`)
    try {
      let bundle: Record<string, unknown> = {}
      try { bundle = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown> } catch {}
      bundle[category] = data
      fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2) + '\n', 'utf-8')
      return { ok: true }
    } catch (e) { return { ok: false, reason: String(e) } }
  })

  ipcMain.handle('gdp:create-locale', (_event, locale: string) => {
    const localesDir = path.join(dataDir, 'locales')
    const filePath = path.join(localesDir, `${locale}.json`)
    try {
      fs.mkdirSync(localesDir, { recursive: true })
      if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '{}\n', 'utf-8')
      return { ok: true }
    } catch (e) { return { ok: false, reason: String(e) } }
  })

  ipcMain.handle('gdp:delete-locale', (_event, locale: string) => {
    try { fs.unlinkSync(path.join(dataDir, 'locales', `${locale}.json`)); return { ok: true } }
    catch (e) { return { ok: false, reason: String(e) } }
  })

  ipcMain.handle('gdp:export-locale', (_event, locale: string) => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'locales', `${locale}.json`), 'utf-8'))
      return { ok: true, data }
    } catch (e) { return { ok: false, reason: String(e) } }
  })

  ipcMain.handle('gdp:import-locale', (_event, locale: string, data: unknown) => {
    const filePath = path.join(dataDir, 'locales', `${locale}.json`)
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      return { ok: true }
    } catch (e) { return { ok: false, reason: String(e) } }
  })

  // ── Logs ─────────────────────────────────────────────────────────────────
  ipcMain.handle('gdp:tail-log', (_event, n: unknown) => {
    const count = typeof n === 'number' ? n : 200
    try {
      const content = fs.readFileSync(LOG_JSON_FILE, 'utf-8')
      return content.trim().split('\n').filter(Boolean).slice(-count)
        .map(line => { try { return JSON.parse(line) } catch { return null } })
        .filter(Boolean)
    } catch { return [] }
  })

  ipcMain.handle('gdp:open-log-file', () => shell.openPath(LOG_JSON_FILE))

  // ── AI Commit Generation ──────────────────────────────────────────────────
  ipcMain.handle('gdp:ai-generate-commit', async (_event, payload?: { repo_path?: string }) => {
    const rawCfg = readConfigFromDisk(configPath)
    const ai = rawCfg.ai as Partial<AiConfig> | undefined

    if (!ai?.enabled) return { ok: false, reason: 'ai_disabled' }
    if (!ai?.api_key) return { ok: false, reason: 'api_key_missing' }

    const cfg: AiConfig = {
      enabled: true,
      base_url: ai.base_url ?? 'https://api.openai.com/v1',
      api_key: ai.api_key,
      model: ai.model ?? 'gpt-4o-mini',
      system_prompt: ai.system_prompt ?? '',
      timeout_secs: ai.timeout_secs ?? 30,
      fallback_to_copilot: ai.fallback_to_copilot ?? true,
    }

    const repoPath = payload?.repo_path ?? ''
    const diff = await getPendingDiff(repoPath, cfg.timeout_secs * 500)

    if (diff.trim() === '') {
      return { ok: false, reason: 'no_changes' }
    }

    try {
      const result = await callOpenAiApi(cfg, diff)
      gdpLog(`AI commit: ok=${result.ok} reason=${result.reason ?? ''}`, 'info', 'system')
      return result
    } catch (e) {
      gdpLog(`AI commit error: ${e}`, 'error', 'system')
      return { ok: false, reason: String(e) }
    }
  })

  // ── Open Settings Dialog ──────────────────────────────────────────────────
  ipcMain.handle('gdp:open-settings', (_event, tab?: string) => {
    const wins = BrowserWindow.getAllWindows?.() ?? []
    const win = BrowserWindow.getFocusedWindow?.() ?? wins[0] ?? null
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send('gdp:show-dialog', { tab: tab ?? 'general' })
    }
  })

  gdpLog('GDP IPC handlers registered', 'info', 'system')
}
