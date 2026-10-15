import type { LogEntry } from '@github-desktop-plus/shared'

export const MAX_LOG_ENTRIES = 500

/** Tail and live messages can overlap while the initial request is in flight. */
export function mergeLogEntries(previous: readonly LogEntry[], incoming: readonly LogEntry[]): LogEntry[] {
  const seen = new Set<string>()
  const merged: LogEntry[] = []
  for (const entry of [...previous, ...incoming]) {
    const key = [entry.ts, entry.level, entry.category, entry.message].join('\0')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return merged.slice(-MAX_LOG_ENTRIES)
}
