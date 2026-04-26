import { Button, Tooltip } from '@heroui/react'
import { useTheme } from '@/stores/theme'
import { useAuth } from '@/stores/auth'
import { useEffect, useState } from 'react'
import { Icons } from './icons'

function fmtRemain(s: number) {
  if (s <= 0) return '已过期'
  const m = Math.floor(s / 60), r = s % 60
  return `${m}m ${r.toString().padStart(2, '0')}s`
}

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { theme, toggle } = useTheme()
  const { expiresInSecs, refresh } = useAuth()
  const [, force] = useState(0)

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    const r = setInterval(() => refresh(), 60_000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [refresh])

  return (
    <header className="relative flex items-center justify-between px-8 pb-3 pt-7">
      <div className="min-w-0">
        <h1 className="title-grad text-[28px] font-bold leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-[13.5px] text-default-500">{subtitle}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <Tooltip content="本机会话过期时间" placement="bottom">
          <div className="flex items-center gap-2 rounded-full border border-white/5 bg-content2/40 px-3.5 py-1.5 backdrop-blur">
            <Icons.Key className="h-3.5 w-3.5 text-default-500" />
            <span className="text-[11px] tracking-wide text-default-500">
              会话剩余 <span className="font-mono text-default-700">{fmtRemain(expiresInSecs)}</span>
            </span>
          </div>
        </Tooltip>

        <Button
          isIconOnly
          variant="flat"
          radius="full"
          onPress={toggle}
          aria-label="切换主题"
          className="bg-content2/60 backdrop-blur hover:bg-content2"
        >
          {theme === 'dark' ? <Icons.Moon className="h-4 w-4" /> : <Icons.Sun className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  )
}
