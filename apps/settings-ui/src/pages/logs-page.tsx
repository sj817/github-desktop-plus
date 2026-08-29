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

const LEVEL_CHIP_ON: Record<LogLevel, string> = {
  info: 'bg-[color-mix(in_srgb,var(--gdp-fg)_8%,transparent)] text-fg-subtle border border-line/60',
  warn: 'bg-warn-soft/80 text-warn border border-warn/20',
  error: 'bg-danger-soft/80 text-danger border border-danger/20',
  block: 'bg-accent-soft/80 text-accent border border-accent/20',
}

/** "2026-07-31T02:14:05.123Z" → "02:14:05" */
function formatTime(ts: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(ts)
  return match ? match[1] : ts
}

function cleanLogMessage(category: string, message: string): string {
  if (!message) return ''
  if (!category) return message
  // Strip redundant category prefix like "Menu: " or "AI: " since the tag badge already displays it
  const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escaped}:?\\s+`, 'i')
  return message.replace(regex, '')
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
    <div className="flex h-full min-h-0 flex-col space-y-2.5">
      {/* 顶部控制栏 */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[12.5px] font-semibold text-fg flex items-center gap-1">
            <FileText className="size-3.5 text-cyan-600 dark:text-cyan-400" />
            <span>实时输出</span>
          </span>
        </div>

        <div className="flex items-center gap-1 ml-2">
          {LEVELS.map(level => {
            const on = levels.has(level)
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLevel(level)}
                className={cn(
                  'inline-flex h-[22px] items-center gap-1 rounded-md px-2 font-mono text-[10.5px]',
                  'font-medium transition-all duration-150 select-none cursor-pointer border',
                  on
                    ? LEVEL_CHIP_ON[level]
                    : 'border-transparent text-fg-faint opacity-40 hover:opacity-80'
                )}
              >
                {LEVEL_LABEL[level]}
                <span className={cn('tabular-nums', on ? 'opacity-70' : 'opacity-40')}>
                  {counts[level]}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        <InputGroup
          className="w-40 h-7.5 bg-field border-line/60"
          placeholder="过滤日志…"
          spellCheck={false}
          autoComplete="off"
          value={filter}
          onChange={event => setFilter(event.target.value)}
          leading={<Search className="size-3 text-fg-subtle" />}
          trailing={
            filter !== '' ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="清除过滤"
                onClick={() => setFilter('')}
              >
                <X className="size-3" />
              </Button>
            ) : null
          }
        />
        <Tooltip content="清空当前日志">
          <Button
            size="icon"
            variant="ghost"
            aria-label="清空"
            className="size-7 rounded-md text-fg-subtle hover:text-fg hover:bg-hover"
            onClick={clear}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="打开日志文件">
          <Button
            size="icon"
            variant="ghost"
            aria-label="打开日志文件"
            className="size-7 rounded-md text-fg-subtle hover:text-fg hover:bg-hover"
            onClick={() => {
              void bridge.invoke('gdp:open-log-file')
            }}
          >
            <FileText className="size-3.5" />
          </Button>
        </Tooltip>
      </div>

      {/* 日志内容区域：深层终端内嵌背景，紧凑排版 */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line/70 bg-inset">
        <div
          ref={viewport}
          onScroll={event => {
            const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
            const near = scrollHeight - scrollTop - clientHeight < 80
            stickToBottom.current = near
            setAtBottom(near)
          }}
          className="h-full overflow-auto py-2 font-mono text-[11.5px] leading-[20px]"
        >
          {visible.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-5 text-cyan-600 dark:text-cyan-400" />}
              title={entries.length === 0 ? '暂无日志输出' : '没有匹配的日志'}
              className="h-full"
            >
              {entries.length === 0
                ? 'GitHub Desktop Plus 的运行输出会实时显示在此处'
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
                    className="group/row align-top hover:bg-hover/30 transition-colors"
                  >
                    {/* 时间：精简至秒级，不占用多余宽度 */}
                    <td className="w-16 py-0.5 pl-3 pr-2 whitespace-nowrap text-fg-faint text-[11px] tabular-nums select-none group-hover/row:text-fg-subtle">
                      {formatTime(entry.ts)}
                    </td>

                    {/* 模块与等级：合并为紧凑微胶囊，色彩区分等级 */}
                    <td className="w-16 py-0.5 pr-2.5 whitespace-nowrap select-none">
                      <span
                        className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-medium uppercase tracking-tight',
                          LEVEL_CHIP_ON[entry.level]
                        )}
                        title={`等级: ${entry.level.toUpperCase()} | 模块: ${entry.category}`}
                      >
                        {entry.category || LEVEL_LABEL[entry.level]}
                      </span>
                    </td>

                    {/* 实际日志内容：获得最大横向宽度 */}
                    <td className="py-0.5 pr-3 text-fg font-mono text-[11.5px] leading-relaxed break-all">
                      {cleanLogMessage(entry.category, entry.message)}
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
            'bg-elevated pr-3 pl-2.5 text-[11px] font-medium text-fg shadow-xs border border-line',
            'transition-[opacity,transform] duration-200 hover:bg-hover cursor-pointer',
            atBottom ? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100'
          )}
        >
          <ArrowDown className="size-3.5" />
          跳到最新
        </button>
      </div>

      {/* 底部状态条 */}
      <div className="flex shrink-0 items-center justify-between px-1 text-[11px] text-fg-subtle tabular-nums">
        <span>
          {filtered ? `显示 ${visible.length} / 共 ${entries.length} 条` : `共 ${entries.length} 条日志`}
        </span>
        <span>最多保留最近 500 条</span>
      </div>
    </div>
  )
}
