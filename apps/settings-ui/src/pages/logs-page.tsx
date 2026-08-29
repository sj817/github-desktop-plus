import { ArrowDown, FileText, ScrollText, Search, Trash2, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry, LogLevel } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { EmptyState } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { useLogs } from '@/lib/log-store'
import { cn } from '@/lib/utils'

const LEVELS: readonly LogLevel[] = ['info', 'warn', 'error', 'block']

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
  block: 'BLOCK',
}

const LEVEL_TEXT: Record<LogLevel, string> = {
  info: 'text-fg-subtle',
  warn: 'text-warn',
  error: 'text-danger',
  block: 'text-accent',
}

const LEVEL_CHIP_ON: Record<LogLevel, string> = {
  info: 'bg-[color-mix(in_srgb,var(--gdp-fg)_10%,transparent)] text-fg',
  warn: 'bg-warn-soft text-warn',
  error: 'bg-danger-soft text-danger',
  block: 'bg-accent-soft text-accent',
}

/** "2026-07-31T02:14:05.123Z" → "02:14:05.123" */
function formatTime(ts: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/.exec(ts)
  if (!match) return ts
  return match[2] ? `${match[1]}.${match[2].padEnd(3, '0')}` : match[1]!
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
  const [levels, setLevels] = useState<ReadonlySet<LogLevel>>(() => new Set(LEVELS))
  const [atBottom, setAtBottom] = useState(true)

  const viewport = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const counts = useMemo(() => {
    const result: Record<LogLevel, number> = { info: 0, warn: 0, error: 0, block: 0 }
    for (const entry of entries) result[entry.level] += 1
    return result
  }, [entries])

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return entries.filter(entry => levels.has(entry.level) && matches(entry, query))
  }, [entries, filter, levels])

  // Follow the tail unless the user has scrolled up to read something.
  useLayoutEffect(() => {
    const element = viewport.current
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight
  }, [visible])

  const toggleLevel = (level: LogLevel) =>
    setLevels(prev => {
      const next = new Set(prev)
      if (next.has(level)) {
        // Clicking the only remaining level would hide everything; treat it as
        // "back to all" instead.
        if (next.size === 1) return new Set(LEVELS)
        next.delete(level)
      } else {
        next.add(level)
      }
      return next
    })

  const jumpToEnd = () => {
    const element = viewport.current
    if (!element) return
    stickToBottom.current = true
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }

  const filtered = filter.trim() !== '' || levels.size !== LEVELS.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-1.5">
        <span className="mr-2 inline-flex items-center gap-1.5 text-[12px] text-fg-muted">
          <span className="gdp-live-dot size-1.5 rounded-full bg-success" />
          实时
        </span>

        {LEVELS.map(level => {
          const on = levels.has(level)
          return (
            <button
              key={level}
              type="button"
              aria-pressed={on}
              onClick={() => toggleLevel(level)}
              className={cn(
                'inline-flex h-[22px] items-center gap-1 rounded-full px-2 font-mono text-[10.5px]',
                'font-medium transition-colors duration-150 select-none',
                on ? LEVEL_CHIP_ON[level] : 'text-fg-faint line-through hover:bg-hover hover:text-fg-subtle'
              )}
            >
              {LEVEL_LABEL[level]}
              <span className={cn('tabular-nums', on ? 'opacity-60' : 'opacity-50')}>
                {counts[level]}
              </span>
            </button>
          )
        })}

        <div className="flex-1" />

        <InputGroup
          className="w-48 @max-[620px]:w-32"
          placeholder="过滤…"
          spellCheck={false}
          autoComplete="off"
          value={filter}
          onChange={event => setFilter(event.target.value)}
          leading={<Search />}
          trailing={
            filter !== '' ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="清除过滤"
                onClick={() => setFilter('')}
              >
                <X />
              </Button>
            ) : null
          }
        />
        <Tooltip content="清空当前列表">
          <Button size="icon" variant="ghost" aria-label="清空" onClick={clear}>
            <Trash2 />
          </Button>
        </Tooltip>
        <Tooltip content="打开日志文件">
          <Button
            size="icon"
            variant="ghost"
            aria-label="打开日志文件"
            onClick={() => {
              void bridge.invoke('gdp:open-log-file')
            }}
          >
            <FileText />
          </Button>
        </Tooltip>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-inset shadow-[inset_0_0_0_1px_var(--gdp-line)]">
        <div
          ref={viewport}
          onScroll={event => {
            const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
            const near = scrollHeight - scrollTop - clientHeight < 80
            stickToBottom.current = near
            setAtBottom(near)
          }}
          className="h-full overflow-auto py-1.5 font-mono text-[11.5px] leading-[20px]"
        >
          {visible.length === 0 ? (
            <EmptyState
              icon={<ScrollText />}
              title={entries.length === 0 ? '暂无日志' : '没有匹配的日志'}
              className="h-full"
            >
              {entries.length === 0
                ? 'GDP 的运行输出会实时显示在这里'
                : filtered
                  ? '换个关键词，或恢复被隐藏的级别'
                  : null}
            </EmptyState>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {visible.map((entry, index) => (
                  <tr
                    key={`${entry.ts}-${index}`}
                    className="group/row align-top hover:bg-[color-mix(in_srgb,var(--gdp-fg)_4%,transparent)]"
                  >
                    <td className="w-[1%] py-0 pr-3 pl-3 whitespace-nowrap text-fg-faint tabular-nums select-none group-hover/row:text-fg-subtle">
                      {formatTime(entry.ts)}
                    </td>
                    <td
                      className={cn(
                        'w-[1%] py-0 pr-3 text-[10.5px] font-semibold whitespace-nowrap',
                        LEVEL_TEXT[entry.level]
                      )}
                    >
                      {LEVEL_LABEL[entry.level]}
                    </td>
                    <td
                      className="w-[1%] max-w-24 truncate py-0 pr-3 whitespace-nowrap text-fg-subtle"
                      title={entry.category}
                    >
                      {entry.category}
                    </td>
                    <td className="py-0 pr-3 break-all whitespace-pre-wrap text-fg">
                      {entry.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <button
          type="button"
          onClick={jumpToEnd}
          aria-hidden={atBottom}
          tabIndex={atBottom ? -1 : 0}
          className={cn(
            'absolute right-3 bottom-3 inline-flex h-7 items-center gap-1.5 rounded-full',
            'bg-elevated pr-3 pl-2.5 text-[11.5px] font-medium text-fg shadow-md',
            'transition-[opacity,transform] duration-200 hover:bg-hover',
            atBottom ? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100'
          )}
        >
          <ArrowDown className="size-3.5" />
          跳到最新
        </button>
      </div>

      <div className="mt-2 flex shrink-0 items-center justify-between text-[11px] text-fg-subtle tabular-nums">
        <span>
          {filtered ? `${visible.length} / ${entries.length} 条` : `${entries.length} 条`}
        </span>
        <span>最多保留最近 500 条</span>
      </div>
    </div>
  )
}
