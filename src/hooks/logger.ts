import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'block'
  category: 'update' | 'telemetry' | 'i18n' | 'menu' | 'system' | 'navbar'
  message: string
}

export const LOG_FILE = path.join(os.tmpdir(), 'gdp-hooks.log')
export const LOG_JSON_FILE = path.join(os.tmpdir(), 'gdp-hooks-stream.jsonl')

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

export function configureLogLevel(level: string): void {
  currentLogLevel = level || 'warn'
}

export function resetLogStream(): void {
  try {
    fs.writeFileSync(LOG_JSON_FILE, '')
  } catch {
    // Logging must never block hook startup.
  }
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
    try {
      fs.appendFileSync(LOG_JSON_FILE, `${JSON.stringify(entry)}\n`)
    } catch {
      // best effort
    }
    return
  }

  if (lastLogKey && lastLogCount > 0) {
    const tail = ` (repeated ${lastLogCount}x in 1s)`
    console.log(tail)
    try {
      fs.appendFileSync(LOG_FILE, `${tail}\n`)
    } catch {
      // best effort
    }
  }

  lastLogKey = key
  lastLogTs = now
  lastLogCount = 0

  const line = `${entry.ts} [${entry.level.toUpperCase()}][${entry.category}] ${msg}`
  const minOrder = logLevelOrder[currentLogLevel.toLowerCase()] ?? 2
  if ((logLevelOrder[level] ?? 1) >= minOrder) {
    console.log(line)
  }

  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`)
    fs.appendFileSync(LOG_JSON_FILE, `${JSON.stringify(entry)}\n`)
  } catch {
    // best effort
  }
}
