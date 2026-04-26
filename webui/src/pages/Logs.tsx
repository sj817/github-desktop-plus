import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, Input, Switch } from '@heroui/react'
import { AppShell } from '@/components/AppShell'
import { GlassCard } from '@/components/GlassCard'
import { openLogStream, type LogEntry } from '@/api/client'

const LEVELS: { key: LogEntry['level']; label: string; tone: string }[] = [
  { key: 'debug', label: 'DEBUG', tone: 'text-default-500 bg-default-500/10' },
  { key: 'info', label: 'INFO', tone: 'text-emerald-500 bg-emerald-500/10' },
  { key: 'warn', label: 'WARN', tone: 'text-amber-500 bg-amber-500/12' },
  { key: 'error', label: 'ERROR', tone: 'text-rose-500 bg-rose-500/12' },
  { key: 'block', label: 'BLOCK', tone: 'text-fuchsia-500 bg-fuchsia-500/12' },
]

export default function LogsPage() {
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const [enabledLevels, setEnabledLevels] = useState<Set<LogEntry['level']>>(
    new Set(['info', 'warn', 'error', 'block']),
  )
  const [status, setStatus] = useState<'open' | 'closed' | 'error'>('closed')
  const [items, setItems] = useState<LogEntry[]>([])
  const bufRef = useRef<LogEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = openLogStream({
      levels: Array.from(enabledLevels),
      onStatus: setStatus,
      onMessage: (e) => {
        if (paused) bufRef.current.push(e)
        else setItems((prev) => {
          const next = [...prev, e]
          return next.length > 5000 ? next.slice(-5000) : next
        })
      },
    })
    return close
  }, [enabledLevels, paused])

  useEffect(() => {
    if (paused) return
    if (bufRef.current.length) {
      setItems((prev) => {
        const merged = [...prev, ...bufRef.current]
        bufRef.current = []
        return merged.length > 5000 ? merged.slice(-5000) : merged
      })
    }
  }, [paused])

  useEffect(() => {
    if (!autoScroll) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, autoScroll])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return items.filter((e) => {
      if (!enabledLevels.has(e.level)) return false
      if (q && !e.message.toLowerCase().includes(q) && !e.category.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, enabledLevels, filter])

  return (
    <AppShell title="日志" subtitle="实时流式日志 · 支持等级与关键词过滤">
      <div className="flex h-full flex-col gap-4">
        <GlassCard hoverable={false} className="!p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              {LEVELS.map((lv) => {
                const active = enabledLevels.has(lv.key)
                return (
                  <button
                    key={lv.key}
                    onClick={() => {
                      const n = new Set(enabledLevels)
                      active ? n.delete(lv.key) : n.add(lv.key)
                      setEnabledLevels(n)
                    }}
                    className={[
                      'rounded-full px-3 py-1 text-[10.5px] font-bold tracking-[0.18em] transition',
                      active ? lv.tone : 'bg-default-200/50 text-default-400 line-through',
                    ].join(' ')}
                  >
                    {lv.label}
                  </button>
                )
              })}
            </div>
            <Input
              size="sm"
              placeholder="搜索消息或分类…"
              value={filter}
              onValueChange={setFilter}
              className="max-w-xs"
            />
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2 text-[11px] text-default-500">
                <span
                  className={[
                    'inline-block h-2 w-2 rounded-full',
                    status === 'open' ? 'bg-emerald-400 animate-breath' : status === 'error' ? 'bg-rose-400' : 'bg-default-400',
                  ].join(' ')}
                />
                {status === 'open' ? '已连接' : status === 'error' ? '连接异常' : '未连接'}
              </div>
              <Switch size="sm" isSelected={autoScroll} onValueChange={setAutoScroll}>
                <span className="text-[12px]">自动滚动</span>
              </Switch>
              <Button size="sm" variant="flat" onPress={() => setPaused(!paused)}>
                {paused ? '继续' : '暂停'}
              </Button>
              <Button size="sm" variant="flat" onPress={() => setItems([])}>清空</Button>
              <Chip size="sm" variant="flat">
                {visible.length} / {items.length}
              </Chip>
            </div>
          </div>
        </GlassCard>

        <GlassCard hoverable={false} className="!p-0 flex-1 overflow-hidden">
          <div ref={scrollRef} className="h-full max-h-[calc(100vh-260px)] overflow-auto font-mono text-[12px] leading-[1.55]">
            {visible.length === 0 && (
              <div className="px-6 py-20 text-center text-[13px] font-sans text-default-400">
                暂无日志…
              </div>
            )}
            {visible.map((e, i) => {
              const lv = LEVELS.find((l) => l.key === e.level) ?? LEVELS[1]
              return (
                <div
                  key={i}
                  className="grid grid-cols-[170px_70px_120px_1fr] gap-3 border-b border-divider/30 px-4 py-1.5 hover:bg-foreground/[0.02]"
                >
                  <span className="text-default-400">{e.ts.replace('T', ' ').replace('Z', '')}</span>
                  <span className={['rounded-md px-1.5 text-center text-[10.5px] font-bold tracking-wider', lv.tone].join(' ')}>
                    {lv.label}
                  </span>
                  <span className="truncate text-primary-500/90">{e.category}</span>
                  <span className="whitespace-pre-wrap break-words text-foreground/90">{e.message}</span>
                </div>
              )
            })}
          </div>
        </GlassCard>
      </div>
    </AppShell>
  )
}
