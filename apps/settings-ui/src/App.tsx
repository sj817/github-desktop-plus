import { ArrowDownToLine, CircleCheck, CircleDot, Code2, Languages, Loader2, ScrollText, Settings2, Sparkles, SquareArrowOutUpRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MountOptions } from '@github-desktop-plus/shared'
import { version } from '../package.json'
import appIcon from './assets/logo.png?inline'
import { useBridge } from '@/bridge/context'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip } from '@/components/ui/tooltip'
import { LogProvider } from '@/lib/log-store'
import { SettingsProvider, useSettings } from '@/lib/settings-store'
import { AiPage } from '@/pages/ai-page'
import { GeneralPage } from '@/pages/general-page'
import { LocalesPage } from '@/pages/locales-page'
import { LogsPage } from '@/pages/logs-page'
import { OpenWithPage } from '@/pages/open-with-page'
import { UpdatesPage } from '@/pages/updates-page'

const TABS = [
  { id: 'general', label: '常规', icon: Settings2, Page: GeneralPage },
  { id: 'open-with', label: '打开方式', icon: SquareArrowOutUpRight, Page: OpenWithPage },
  { id: 'ai', label: 'AI 提交', icon: Sparkles, Page: AiPage },
  { id: 'locales', label: '语言包', icon: Languages, Page: LocalesPage },
  { id: 'updates', label: '更新', icon: ArrowDownToLine, Page: UpdatesPage },
  { id: 'logs', label: '运行日志', icon: ScrollText, Page: LogsPage },
] as const

export function App({ options }: { options: MountOptions }) {
  return (
    <SettingsProvider fallback={<LoadingShell />}>
      <LogProvider><Shell initialTab={options.initialTab} /></LogProvider>
    </SettingsProvider>
  )
}

function Topbar() {
  const bridge = useBridge()
  return (
    <header className="settings-topbar">
      <div className="settings-brand">
        <img src={appIcon} alt="" width="36" height="36" />
        <div><strong>GitHub Desktop Plus</strong><span>偏好设置</span></div>
      </div>
      <span className="settings-version">v{version}</span>
      <Tooltip content="查看开源仓库">
        <Button variant="ghost" size="icon" aria-label="查看开源仓库" onClick={() => bridge.openExternal('https://github.com/sj817/github-desktop-plus')}><Code2 /></Button>
      </Tooltip>
      <Tooltip content="关闭设置 · Esc">
        <Button variant="ghost" size="icon" aria-label="关闭设置" onClick={() => bridge.close()}><X /></Button>
      </Tooltip>
    </header>
  )
}

function Navigation({ activeId, onSelect, loading = false }: { activeId: string; onSelect: (id: string) => void; loading?: boolean }) {
  return (
    <nav className="settings-nav" role="tablist" aria-label="设置分类">
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          id={'gdp-tab-' + tab.id}
          role="tab"
          type="button"
          aria-label={tab.label}
          aria-selected={activeId === tab.id}
          aria-controls={'gdp-panel-' + tab.id}
          tabIndex={activeId === tab.id ? 0 : -1}
          disabled={loading}
          className="settings-tab"
          onClick={() => onSelect(tab.id)}
          onKeyDown={event => {
            const key = event.key
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
            event.preventDefault()
            const nextIndex = key === 'Home' ? 0 : key === 'End' ? TABS.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length
            const next = TABS[nextIndex]!
            onSelect(next.id)
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('#gdp-tab-' + next.id)?.focus()
          }}
        >
          <tab.icon />
          <span className="settings-tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

function LoadingShell() {
  return (
    <div className="settings-shell" aria-busy="true">
      <Topbar />
      <Navigation activeId="general" onSelect={() => {}} loading />
      <div className="settings-content">
        <div className="page-heading"><div><h1>正在读取设置</h1><p>稍候，正在载入本机配置。</p></div></div>
        <div className="settings-loading">{[0, 1, 2, 3].map(key => <div key={key} className="gdp-skeleton" />)}</div>
      </div>
      <div className="settings-savebar"><span className="settings-save-status"><Loader2 className="gdp-spin" />正在载入…</span></div>
    </div>
  )
}

function Shell({ initialTab }: { initialTab?: string }) {
  const bridge = useBridge()
  const { dirty, saving, save } = useSettings()
  const [activeId, setActiveId] = useState<string>(() => TABS.find(tab => tab.id === initialTab)?.id ?? 'general')
  const active = TABS.find(tab => tab.id === activeId) ?? TABS[0]
  const Page = active.Page

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if (event.key === 'Escape') {
        // A nested popup owns Escape; do not close the entire settings dialog.
        event.preventDefault()
        if (document.getElementById('gdp-settings-root')?.querySelector('[role="dialog"], [role="listbox"]')) return
        bridge.close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bridge, save])

  return (
    <div className="settings-shell">
      <Topbar />
      <Navigation activeId={active.id} onSelect={setActiveId} />
      <main className="settings-content" data-scroll={active.id !== 'logs'}>
        <div key={active.id} id={'gdp-panel-' + active.id} role="tabpanel" aria-labelledby={'gdp-tab-' + active.id} className={active.id === 'logs' ? 'page-body page-body-fill' : 'page-body'}>
          <Page />
        </div>
      </main>
      <footer className="settings-savebar">
        <div className="settings-save-status" data-dirty={dirty} aria-live="polite">
          {saving ? <Loader2 className="gdp-spin" /> : dirty ? <CircleDot /> : <CircleCheck />}
          <span>{saving ? '正在保存…' : dirty ? '有未保存的更改' : '所有更改已保存'}</span>
        </div>
        <span className="setting-save-shortcut"><Kbd keys={['Ctrl', 'S']} /></span>
        <div className="settings-save-actions">
          <Button variant="ghost" onClick={() => bridge.close()}>取消</Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <Loader2 className="gdp-spin" /> : null}保存更改
          </Button>
        </div>
      </footer>
    </div>
  )
}
