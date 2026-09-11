import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'block'
  category: 'update' | 'telemetry' | 'i18n' | 'menu' | 'system' | 'navbar'
  message: string
}

// Overridable so tests (and the desktop self-check) can point the sinks at a
// scratch directory instead of the real per-user log files.
const LOG_DIR = process.env.GDP_LOG_DIR || os.tmpdir()
export const LOG_FILE = path.join(LOG_DIR, 'gdp-hooks.log')
export const LOG_JSON_FILE = path.join(LOG_DIR, 'gdp-hooks-stream.jsonl')

/** The text log is rotated (one previous generation kept) once it grows past this. */
const LOG_FILE_ROTATE_BYTES = 4 * 1024 * 1024

const logLevelOrder: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  warning: 2,
  error: 3,
  block: 3,
}

let currentLogLevel = 'warn'
let lastLogKey: string | null = null
let lastLogTs = 0
let lastLogCount = 0

// Broadcast hook: set by index.ts after activeWebContents is available
let _logBroadcast: ((entry: LogEntry) => void) | null = null

export function setLogBroadcast(fn: (entry: LogEntry) => void): void {
  _logBroadcast = fn
}

export function configureLogLevel(level: string): void {
  currentLogLevel = level || 'warn'
}

// ── Asynchronous file sink ───────────────────────────────────────────────────
// gdpLog runs on Electron's main thread, which is also the browser UI thread:
// every synchronous file write there stalls input delivery for the whole app.
// Lines are therefore queued in memory and appended in the background, in
// order, one write in flight per file. Whatever is still queued when the
// process exits is written synchronously so nothing is lost.

interface FileSink {
  readonly file: string
  pending: string[]
  writing: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const FLUSH_DELAY_MS = 100
const FLUSH_IMMEDIATELY_AT = 256

const textSink: FileSink = { file: LOG_FILE, pending: [], writing: false, timer: null }
const jsonSink: FileSink = { file: LOG_JSON_FILE, pending: [], writing: false, timer: null }
const sinks: readonly FileSink[] = [textSink, jsonSink]

function flush(sink: FileSink): void {
  if (sink.timer) {
    clearTimeout(sink.timer)
    sink.timer = null
  }
  if (sink.writing || sink.pending.length === 0) return
  const chunk = sink.pending.join('')
  sink.pending = []
  sink.writing = true
  fs.appendFile(sink.file, chunk, () => {
    sink.writing = false
    // Lines queued while the write was in flight go out next.
    if (sink.pending.length > 0) flush(sink)
  })
}

function enqueue(sink: FileSink, line: string): void {
  sink.pending.push(line)
  if (sink.pending.length >= FLUSH_IMMEDIATELY_AT) {
    flush(sink)
    return
  }
  if (sink.timer === null && !sink.writing) {
    sink.timer = setTimeout(() => flush(sink), FLUSH_DELAY_MS)
    sink.timer.unref?.()
  }
}

/** Write whatever is still queued, synchronously. Only for process exit. */
export function flushLogsSync(): void {
  for (const sink of sinks) {
    if (sink.timer) {
      clearTimeout(sink.timer)
      sink.timer = null
    }
    if (sink.pending.length === 0) continue
    const chunk = sink.pending.join('')
    sink.pending = []
    try {
      fs.appendFileSync(sink.file, chunk)
    } catch {
      // best effort
    }
  }
}

let exitHookInstalled = false
function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  try {
    process.once('exit', flushLogsSync)
  } catch {
    // Not a Node environment — nothing to flush on exit.
  }
}

/**
 * Called once at startup: the JSONL stream (what the settings dialog tails)
 * starts empty for every session, and the plain-text log is rotated so it
 * cannot grow without bound across sessions.
 */
export function resetLogStream(): void {
  try {
    fs.writeFileSync(LOG_JSON_FILE, '')
  } catch {
    // Logging must never block hook startup.
  }
  try {
    const { size } = fs.statSync(LOG_FILE)
    if (size > LOG_FILE_ROTATE_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`)
    }
  } catch {
    // Missing file or a locked previous generation — leave it alone.
  }
  installExitHook()
}

export function gdpLog(
  msg: string,
  level: LogEntry['level'] = 'info',
  category: LogEntry['category'] = 'system',
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message: msg,
  }
  const key = `${level}|${category}|${msg}`
  const now = Date.now()

  if (lastLogKey === key && now - lastLogTs < 1000) {
    lastLogCount += 1
    enqueue(jsonSink, `${JSON.stringify(entry)}\n`)
    _logBroadcast?.(entry)
    return
  }

  if (lastLogKey && lastLogCount > 0) {
    const tail = ` (repeated ${lastLogCount}x in 1s)`
    console.log(tail)
    enqueue(textSink, `${tail}\n`)
  }

  lastLogKey = key
  lastLogTs = now
  lastLogCount = 0

  const line = `${entry.ts} [${entry.level.toUpperCase()}][${entry.category}] ${msg}`
  const minOrder = logLevelOrder[currentLogLevel.toLowerCase()] ?? 2
  if ((logLevelOrder[level] ?? 1) >= minOrder) {
    console.log(line)
  }

  enqueue(textSink, `${line}\n`)
  enqueue(jsonSink, `${JSON.stringify(entry)}\n`)

  _logBroadcast?.(entry)
}
