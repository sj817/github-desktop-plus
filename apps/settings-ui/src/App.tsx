import {
  Languages,
  Loader2,
  ScrollText,
  Settings2,
  Sparkles,
  SquareArrowOutUpRight,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { MountOptions } from '@github-desktop-plus/shared'
import { version } from '../package.json'
import { useBridge } from '@/bridge/context'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip } from '@/components/ui/tooltip'
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
  theme: {
    inactiveCircle: string
    activeCircle: string
    activePill: string
  }
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
    theme: {
      inactiveCircle: 'bg-[#d3e3fd] text-[#0b57d0] dark:bg-[#004a77] dark:text-[#c2e7ff]',
      activeCircle: 'bg-[#0b57d0] text-white dark:bg-[#a8c7fa] dark:text-[#003355]',
      activePill: 'bg-[#d3e3fd]/60 text-[#041e49] dark:bg-[#004a77]/40 dark:text-[#d3e3fd]',
    },
    render: () => <GeneralPage />,
    scroll: true,
  },
  {
    id: 'open-with',
    label: '打开方式',
    subtitle: '右键仓库时可选的编辑器与终端',
    icon: SquareArrowOutUpRight,
    theme: {
      inactiveCircle: 'bg-[#c4eed0] text-[#146c2e] dark:bg-[#0f5223] dark:text-[#c4eed0]',
      activeCircle: 'bg-[#146c2e] text-white dark:bg-[#6dd58c] dark:text-[#04210b]',
      activePill: 'bg-[#c4eed0]/60 text-[#072711] dark:bg-[#0f5223]/40 dark:text-[#c4eed0]',
    },
    render: () => <OpenWithPage />,
    scroll: true,
  },
  {
    id: 'ai',
    label: 'AI 提交',
    subtitle: '用自定义模型生成提交信息',
    icon: Sparkles,
    theme: {
      inactiveCircle: 'bg-[#e8def8] text-[#6750a4] dark:bg-[#4a2574] dark:text-[#e8def8]',
      activeCircle: 'bg-[#6750a4] text-white dark:bg-[#d0bcff] dark:text-[#381e72]',
      activePill: 'bg-[#e8def8]/60 text-[#21005d] dark:bg-[#4a2574]/40 dark:text-[#e8def8]',
    },
    render: () => <AiPage />,
    scroll: true,
  },
  {
    id: 'locales',
    label: '语言包',
    subtitle: '导入、导出与管理翻译',
    icon: Languages,
    theme: {
      inactiveCircle: 'bg-[#ffdcc2] text-[#8f4c00] dark:bg-[#602f00] dark:text-[#ffdcc2]',
      activeCircle: 'bg-[#8f4c00] text-white dark:bg-[#ffb77b] dark:text-[#4d2700]',
      activePill: 'bg-[#ffdcc2]/60 text-[#2e1500] dark:bg-[#602f00]/40 dark:text-[#ffdcc2]',
    },
    render: () => <LocalesPage />,
    scroll: true,
  },
  {
    id: 'logs',
    label: '日志',
    subtitle: '实时运行诊断输出',
    icon: ScrollText,
    theme: {
      inactiveCircle: 'bg-[#c2f0f7] text-[#006874] dark:bg-[#004f58] dark:text-[#c2f0f7]',
      activeCircle: 'bg-[#006874] text-white dark:bg-[#4ddad9] dark:text-[#00363d]',
      activePill: 'bg-[#c2f0f7]/60 text-[#001f24] dark:bg-[#004f58]/40 dark:text-[#c2f0f7]',
    },
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

/** Mirrors the real layout so the content does not jump when the config lands. */
function LoadingShell() {
  return (
    <div className="flex h-full min-h-0 animate-fade-in">
      <div className="w-[196px] shrink-0 bg-sidebar @max-[620px]:w-[52px]" />
      <div className="flex min-w-0 flex-1 flex-col px-8 pt-7">
        <div className="gdp-skeleton h-5 w-24 rounded" />
        <div className="gdp-skeleton mt-2 h-3.5 w-48 rounded" />
        <div className="mt-10 space-y-6">
          {[0, 1, 2].map(row => (
            <div key={row} className="flex items-center gap-6">
              <div className="flex-1 space-y-2">
                <div className="gdp-skeleton h-3.5 w-32 rounded" />
                <div className="gdp-skeleton h-3 w-64 rounded" />
              </div>
              <div className="gdp-skeleton h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
        <div className="mt-auto mb-6 flex items-center gap-2 self-center text-[12px] text-fg-subtle">
          <Loader2 className="size-3.5 animate-spin" />
          正在读取配置…
        </div>
      </div>
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
    <div className="flex h-full min-h-0 bg-canvas">
      <Sidebar activeId={active.id} onSelect={setActiveId} />

      <div className="relative flex min-w-0 flex-1 flex-col bg-canvas">
        <Tooltip content="关闭 (Esc)">
          <Button
            size="icon"
            variant="ghost"
            aria-label="关闭"
            className="absolute top-3.5 right-3.5 z-20 size-7 rounded-full text-fg-subtle hover:text-fg hover:bg-hover transition-colors"
            onClick={() => bridge.close()}
          >
            <X className="size-3.5" />
          </Button>
        </Tooltip>

        <ScrollArea key={active.id} scroll={active.scroll}>
          {active.render()}
        </ScrollArea>

        <footer className="flex h-[48px] shrink-0 items-center gap-2 border-t border-line px-5 @max-[620px]:px-4">
          <Tooltip content="GitHub Desktop Plus 开源仓库">
            <Button
              variant="ghost"
              size="icon"
              aria-label="GitHub Desktop Plus 开源仓库"
              className="size-7 rounded-md text-fg-muted hover:text-fg hover:bg-hover"
              onClick={() => bridge.openExternal(PROJECT_URL)}
            >
              <GithubIcon className="size-4" />
            </Button>
          </Tooltip>

          <div className="flex-1" />

          <span
            aria-live="polite"
            className={cn(
              'mr-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-warn',
              'transition-[opacity,transform] duration-200',
              dirty ? 'opacity-100' : 'pointer-events-none translate-x-1 opacity-0'
            )}
          >
            <span className="size-1.5 rounded-full bg-warn animate-pulse" />
            未保存
          </span>

          <Button size="sm" variant="secondary" onClick={() => bridge.close()}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={saving}
            className="min-w-[72px]"
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : null}
            保存
          </Button>
        </footer>
      </div>
    </div>
  )
}

/**
 * The page body. Forms scroll as a whole; the logs page owns its own viewport.
 * A hairline appears at the top once content has scrolled under the header.
 */
function ScrollArea({ scroll, children }: { scroll: boolean; children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-line transition-opacity duration-200',
          scrolled ? 'opacity-100' : 'opacity-0'
        )}
      />
      <main
        onScroll={scroll ? event => setScrolled(event.currentTarget.scrollTop > 2) : undefined}
        className={cn(
          'min-h-0 flex-1 animate-page-in pl-7 pr-12 pt-4.5 @max-[620px]:pl-5 @max-[620px]:pr-10',
          scroll ? 'overflow-y-auto pb-6' : 'flex flex-col overflow-hidden pb-4'
        )}
      >
        {children}
      </main>
    </div>
  )
}

function Sidebar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  const navRef = useRef<HTMLElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Below ~620px the container query collapses the rail to icons; labels then
  // move into tooltips.
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const observer = new ResizeObserver(() => setCollapsed(nav.offsetWidth < 100))
    observer.observe(nav)
    return () => observer.disconnect()
  }, [])

  return (
    <nav
      ref={navRef}
      aria-label="设置分类"
      className={cn(
        'flex w-[204px] shrink-0 flex-col bg-sidebar border-r border-line/60 pt-4 pb-0 transition-[width] duration-200 select-none',
        '@max-[620px]:w-[58px]'
      )}
    >
      <div className="flex flex-col gap-1.5 px-3 @max-[620px]:px-2">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = tab.id === activeId
          const item = (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-label={collapsed ? tab.label : undefined}
              onClick={() => onSelect(tab.id)}
              className={cn(
                'group relative flex h-[42px] items-center gap-3 rounded-full px-2.5 text-[13px] font-medium transition-all duration-200 outline-none',
                'focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1',
                '@max-[620px]:justify-center @max-[620px]:px-0',
                isActive
                  ? cn(tab.theme.activePill, 'font-semibold shadow-xs')
                  : 'text-fg-muted hover:bg-hover hover:text-fg'
              )}
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full transition-all duration-200',
                  isActive
                    ? tab.theme.activeCircle
                    : cn(tab.theme.inactiveCircle, 'group-hover:scale-105')
                )}
              >
                <Icon className="size-3.5" strokeWidth={isActive ? 2.4 : 2} />
              </span>
              <span className="truncate @max-[620px]:hidden">{tab.label}</span>
            </button>
          )
          return collapsed ? (
            <Tooltip key={tab.id} content={tab.label}>
              {item}
            </Tooltip>
          ) : (
            item
          )
        })}
      </div>

      <div className="flex-1" />

      <div className="mt-auto px-3 pb-3 pt-2 @max-[620px]:px-1.5 @max-[620px]:pb-2">
        <div className="flex items-center justify-between rounded-lg bg-black/[0.025] dark:bg-white/[0.03] px-2.5 py-1.5 border border-black/[0.04] dark:border-white/[0.05] select-none @max-[620px]:justify-center">
          <span className="font-mono text-[11px] font-medium text-fg-subtle">v{version}</span>
          <div className="flex items-center gap-1 @max-[620px]:hidden">
            <Kbd keys={['Ctrl', 'Alt', 'G']} />
          </div>
        </div>
      </div>
    </nav>
  )
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
