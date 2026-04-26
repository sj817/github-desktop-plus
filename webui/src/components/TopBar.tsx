import { Button } from '@heroui/react'
import { useTheme } from '@/stores/theme'
import { useAuth } from '@/stores/auth'
import { useEffect, useState } from 'react'

function fmtRemain(s: number) {
  if (s <= 0) return '已过期'
  const m = Math.floor(s / 60), r = s % 60
  return `${m}m ${r.toString().padStart(2, '0')}s`
}

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { theme, toggle } = useTheme()
  const { expiresInSecs, refresh } = useAuth()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    const r = setInterval(() => refresh(), 60_000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [refresh])

  // local countdown (refresh updates ground truth every 60s)
  const elapsed = Math.floor((Date.now() - now) / 1000)
  void elapsed

  return (
    <header className="flex items-center justify-between px-8 pb-2 pt-7">
      <div>
        <h1 className="title-grad text-[26px] font-bold leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-default-500">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="rounded-full border border-divider/60 bg-content2/40 px-3 py-1.5 text-[11px] tracking-wide text-default-500 backdrop-blur">
          会话剩余 <span className="font-mono text-default-700">{fmtRemain(expiresInSecs)}</span>
        </div>
        <Button
          isIconOnly
          variant="flat"
          radius="full"
          onPress={toggle}
          aria-label="切换主题"
          className="bg-content2/60 backdrop-blur"
        >
          {theme === 'dark' ? '☾' : '☀'}
        </Button>
      </div>
    </header>
  )
}
