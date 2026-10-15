import { ArrowDown, FileText, Pause, Play, ScrollText, Search, Trash2, X } from 'lucide-react'
import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry, LogLevel } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { EmptyState, PageHeader } from '@/components/settings/section'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { InputGroup } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useLogs } from '@/lib/log-store'

const LEVELS: readonly LogLevel[] = ['info', 'warn', 'error', 'block']
const LEVEL_LABEL: Record<LogLevel, string> = { info: '信息', warn: '警告', error: '错误', block: '拦截' }
const LEVEL_TONE: Record<LogLevel, BadgeTone> = { info: 'neutral', warn: 'warn', error: 'danger', block: 'accent' }
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

function formatTime(ts: string): string {
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? ts : timeFormatter.format(date)
}
function cleanLogMessage(category: string, message: string): string {
  const prefix = category + ': '
  return category && message.toLowerCase().startsWith(prefix.toLowerCase()) ? message.slice(prefix.length) : message
}

const LogRows = memo(function LogRows({ entries }: { entries: LogEntry[] }) {
  return <table className="logs-table" aria-label="运行日志"><tbody>
    {entries.map((entry, index) => <tr key={entry.ts + '-' + index}>
      <td className="log-time"><time dateTime={entry.ts} title={entry.ts}>{formatTime(entry.ts)}</time></td>
      <td className="log-tag"><Badge tone={LEVEL_TONE[entry.level]}>{entry.category || entry.level.toUpperCase()}</Badge></td>
      <td className="log-message">{cleanLogMessage(entry.category, entry.message)}</td>
    </tr>)}
  </tbody></table>
})

export function LogsPage() {
  const bridge = useBridge()
  const toast = useToast()
  const { entries, clear } = useLogs()
  const [filter, setFilter] = useState('')
  const query = useDeferredValue(filter.trim().toLowerCase())
  const [levels, setLevels] = useState<ReadonlySet<LogLevel>>(() => new Set(LEVELS))
  const [paused, setPaused] = useState<LogEntry[] | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const viewport = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const displayEntries = paused ?? entries

  const counts = useMemo(() => {
    const result: Record<LogLevel, number> = { info: 0, warn: 0, error: 0, block: 0 }
    for (const entry of displayEntries) result[entry.level] += 1
    return result
  }, [displayEntries])
  const visible = useMemo(() => displayEntries.filter(entry => levels.has(entry.level) &&
    (!query || (entry.ts + ' ' + entry.level + ' ' + entry.category + ' ' + entry.message).toLowerCase().includes(query))),
  [displayEntries, query, levels])

  useLayoutEffect(() => {
    if (viewport.current && stickToBottom.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [visible])
  const resetFilter = () => { setFilter(''); setLevels(new Set(LEVELS)) }

  return (
    <>
      <PageHeader title="运行日志" description="查看运行信息，快速定位配置和请求问题。" actions={<>
        <Button onClick={() => { if (paused) { stickToBottom.current = true; setAtBottom(true) }; setPaused(prev => prev ? null : entries) }}>{paused ? <Play /> : <Pause />}{paused ? '继续显示' : '暂停显示'}</Button>
        <Button onClick={() => { void bridge.invoke('gdp:open-log-file').catch(error => toast('打开日志失败：' + String(error), 'error')) }}><FileText />打开文件</Button>
      </>} />
      <div className="logs-page">
        <div className="logs-toolbar">
          <div className="log-levels" role="group" aria-label="日志级别筛选">{LEVELS.map(level => <Chip key={level} active={levels.has(level)} onClick={() => setLevels(prev => { const next = new Set(prev); if (next.has(level)) next.delete(level); else next.add(level); return next })}>{LEVEL_LABEL[level]}<span>{counts[level]}</span></Chip>)}</div>
          <InputGroup aria-label="搜索日志" placeholder="搜索日志内容…" value={filter} onChange={event => setFilter(event.target.value)} spellCheck={false} leading={<Search />}
            trailing={filter ? <Button size="icon-sm" variant="ghost" aria-label="清除搜索" onClick={() => setFilter('')}><X /></Button> : null} />
          <Button size="icon" variant="ghost" aria-label="清空日志" onClick={() => { clear(); if (paused) setPaused([]) }}><Trash2 /></Button>
        </div>
        <div className="logs-view">
          <div ref={viewport} className="logs-scroll" onScroll={event => {
            const element = event.currentTarget
            const near = element.scrollHeight - element.scrollTop - element.clientHeight < 48
            stickToBottom.current = near
            setAtBottom(near)
          }}>
            {visible.length ? <LogRows entries={visible} /> : <EmptyState icon={<ScrollText />} title={displayEntries.length ? '没有匹配的日志' : '暂无日志输出'}
              action={displayEntries.length ? <Button size="sm" onClick={resetFilter}>清除筛选</Button> : null}>
              {displayEntries.length ? '试试其他关键词或调整日志级别。' : paused ? '当前已暂停显示，继续后可查看新日志。' : '新的运行信息会自动显示在这里。'}
            </EmptyState>}
          </div>
          {!atBottom ? <Button className="logs-jump" size="sm" onClick={() => { stickToBottom.current = true; viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' }) }}><ArrowDown />跳到最新</Button> : null}
        </div>
        <div className="logs-footer">
          <span className="logs-live" data-paused={paused !== null}>{paused ? '显示已暂停' : '实时接收'}</span>
          <span>显示 {visible.length} / {displayEntries.length} 条 · 最多保留 500 条</span>
        </div>
      </div>
    </>
  )
}
