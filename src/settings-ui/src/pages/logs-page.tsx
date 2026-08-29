import { FileText, Search, Terminal, Trash2 } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry, LogLevel } from '@shared/gdp-ipc'
import { useBridge } from '@/bridge/context'
import { EmptyState } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLogs } from '@/lib/log-store'
import { cn } from '@/lib/utils'

const LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-fg-subtle',
  warn: 'text-warn',
  error: 'text-danger',
  block: 'text-accent',
}

/** "2026-07-31T02:14:05.123Z" → "02:14:05" */
function formatTime(ts: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(ts)
  return match?.[1] ?? ts
}

function matches(entry: LogEntry, query: string): boolean {
  if (query === '') return true
  const haystack = `${entry.ts} ${entry.level} ${entry.category} ${entry.message}`.toLowerCase()
  return haystack.includes(query)
}

export function LogsPage() {
  const bridge = useBridge()
  const { entries, clear } = useLogs()
  const [filter, setFilter] = useState('')

  const viewport = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return entries.filter(entry => matches(entry, query))
  }, [entries, filter])

  // Follow the tail unless the user has scrolled up to read something.
  useLayoutEffect(() => {
    const element = viewport.current
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight
  }, [visible])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          实时
        </span>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            className="w-52 pl-7"
            placeholder="过滤日志…"
            spellCheck={false}
            value={filter}
            onChange={event => setFilter(event.target.value)}
          />
        </div>
        <Button size="sm" onClick={clear}>
          <Trash2 />
          清空
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void bridge.invoke('gdp:open-log-file')
          }}
        >
          <FileText />
          日志文件
        </Button>
      </div>

      <div
        ref={viewport}
        onScroll={event => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          stickToBottom.current = scrollHeight - scrollTop - clientHeight < 80
        }}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface',
          'p-1 font-mono text-[11.5px] leading-relaxed'
        )}
      >
        {visible.length === 0 ? (
          <EmptyState icon={<Terminal className="size-6" />}>
            {entries.length === 0 ? '暂无日志输出' : '没有匹配的日志'}
          </EmptyState>
        ) : (
          visible.map((entry, index) => (
            <div
              key={`${entry.ts}-${index}`}
              className="flex gap-2 rounded px-1.5 py-0.5 hover:bg-surface-hover"
            >
              <span className="shrink-0 text-fg-subtle tabular-nums">{formatTime(entry.ts)}</span>
              <span className={cn('w-11 shrink-0 uppercase', LEVEL_STYLES[entry.level])}>
                {entry.level}
              </span>
              <span className="w-16 shrink-0 truncate text-fg-muted">{entry.category}</span>
              <span className="min-w-0 break-all whitespace-pre-wrap text-fg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
