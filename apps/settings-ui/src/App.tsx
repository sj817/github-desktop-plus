import {
  ExternalLink,
  Languages,
  Loader2,
  Settings2,
  Sparkles,
  SquareArrowOutUpRight,
  Terminal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { MountOptions } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { Button } from '@/components/ui/button'
import { LogProvider } from '@/lib/log-store'
import { SettingsProvider, useSettings } from '@/lib/settings-store'
import { cn } from '@/lib/utils'
import { AiPage } from '@/pages/ai-page'
import { GeneralPage } from '@/pages/general-page'
import { LocalesPage } from '@/pages/locales-page'
import { LogsPage } from '@/pages/logs-page'
import { OpenWithPage } from '@/pages/open-with-page'

const PROJECT_URL = 'https://github.com/sj817/github-desktop-plus'

interface TabMeta {
  id: string
  label: string
  subtitle: string
  icon: LucideIcon
  render: () => ReactNode
  /** Logs manage their own scrolling; forms scroll as a whole. */
  scroll: boolean
}

const TABS: readonly TabMeta[] = [
  {
    id: 'general',
    label: '常规',
    subtitle: '界面语言、更新与隐私偏好',
    icon: Settings2,
    render: () => <GeneralPage />,
    scroll: true,
  },
  {
    id: 'open-with',
    label: '打开方式',
    subtitle: '右键仓库时可选的编辑器与终端',
    icon: SquareArrowOutUpRight,
    render: () => <OpenWithPage />,
    scroll: true,
  },
  {
    id: 'ai',
    label: 'AI 提交',
    subtitle: '用自定义模型生成提交信息',
    icon: Sparkles,
    render: () => <AiPage />,
    scroll: true,
  },
  {
    id: 'locales',
    label: '语言包',
    subtitle: '导入、导出与管理翻译',
    icon: Languages,
    render: () => <LocalesPage />,
    scroll: true,
  },
  {
    id: 'logs',
    label: '日志',
    subtitle: '实时运行诊断输出',
    icon: Terminal,
    render: () => <LogsPage />,
    scroll: false,
  },
]

export function App({ options }: { options: MountOptions }) {
  return (
    <SettingsProvider fallback={<LoadingShell />}>
      <LogProvider>
        <Shell initialTab={options.initialTab} />
      </LogProvider>
    </SettingsProvider>
  )
}

function LoadingShell() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[13px] text-fg-subtle">
      <Loader2 className="size-4 animate-spin" />
      正在读取配置…
    </div>
  )
}

function Shell({ initialTab }: { initialTab?: string }) {
  const bridge = useBridge()
  const { dirty, saving, save } = useSettings()
  const [activeId, setActiveId] = useState(
    () => TABS.find(tab => tab.id === initialTab)?.id ?? 'general'
  )

  const active = TABS.find(tab => tab.id === activeId) ?? TABS[0]!

  // Ctrl+S saves, Esc closes — same shortcuts the old dialog had.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        bridge.close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bridge, save])

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-46 shrink-0 flex-col gap-0.5 border-r border-line bg-surface p-2.5">
        <div className="mb-3 flex items-center gap-2 px-1.5 pt-1">
          <span className="grid size-6 place-items-center rounded-md bg-accent text-[11px] font-bold text-accent-fg">
            G+
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] leading-tight font-semibold">GDP 设置</span>
            <span className="block truncate text-[10.5px] text-fg-subtle">GitHub Desktop Plus</span>
          </span>
        </div>

        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = tab.id === active.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                isActive
                  ? 'bg-surface-alt font-medium text-fg shadow-sm'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
              )}
            >
              <Icon className={cn('size-4', isActive ? 'text-accent' : 'text-fg-subtle')} />
              {tab.label}
            </button>
          )
        })}

        <div className="flex-1" />
        <div className="flex items-center justify-center gap-1 pb-1 text-[10px] text-fg-subtle">
          {['Ctrl', 'Alt', 'G'].map(key => (
            <kbd
              key={key}
              className="rounded border border-line bg-surface-alt px-1 py-px font-mono"
            >
              {key}
            </kbd>
          ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] leading-tight font-semibold">{active.label}</h1>
            <p className="mt-0.5 text-[12px] text-fg-muted">{active.subtitle}</p>
          </div>
          <Button size="icon" variant="ghost" title="关闭" onClick={() => bridge.close()}>
            <X />
          </Button>
        </header>

        <main
          key={active.id}
          className={cn(
            'min-h-0 flex-1 animate-[gdp-page-in_180ms_ease-out] px-5 py-4',
            active.scroll ? 'overflow-y-auto' : 'overflow-hidden'
          )}
        >
          {active.render()}
        </main>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-2.5">
          <Button
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => bridge.openExternal(PROJECT_URL)}
          >
            <ExternalLink />
            关于 GDP
          </Button>
          <div className="flex-1" />
          {dirty ? <span className="text-[11.5px] text-fg-subtle">有未保存的更改</span> : null}
          <Button size="sm" onClick={() => bridge.close()}>
            取消
          </Button>
          <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            保存更改
          </Button>
        </footer>
      </div>
    </div>
  )
}
