import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, CheckCheck, CircleCheck, ExternalLink, Globe2, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { DOWNLOAD_MIRRORS, RELEASES_URL, type GdpInvokeChannel, type UpdateState } from '@github-desktop-plus/shared'
import { version } from '../../package.json'
import { useBridge } from '@/bridge/context'
import { Note, PageHeader, SettingField, SettingSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useSettings } from '@/lib/settings-store'
import { normalizeDownloadMirror } from '@github-desktop-plus/shared'

const MIRROR_OPTIONS = [
  { value: 'auto', label: '自动切换 · 推荐' },
  { value: 'direct', label: 'GitHub 直连' },
  ...DOWNLOAD_MIRRORS.map(node => ({ value: node.id, label: node.label })),
]
const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function UpdatesPage() {
  const bridge = useBridge()
  const toast = useToast()
  const { draft, update, dirty, saving } = useSettings()
  const [state, setState] = useState<UpdateState>({ phase: 'idle', currentVersion: version, revision: -1 })
  const [pending, setPending] = useState(false)
  const [installing, setInstalling] = useState(false)
  const mounted = useRef(true)
  const busyRef = useRef(false)
  const accept = (next: UpdateState) => {
    if (mounted.current) setState(prev => next.revision >= prev.revision ? next : prev)
  }
  useEffect(() => {
    mounted.current = true
    const unsubscribe = bridge.on('gdp:update-state', accept)
    bridge.invoke('gdp:update-state').then(accept).catch(error => toast(String(error), 'error'))
    return () => { mounted.current = false; unsubscribe() }
  }, [bridge, toast])

  async function run(channel: Extract<GdpInvokeChannel, 'gdp:update-check' | 'gdp:update-download'>) {
    if (busyRef.current) return
    busyRef.current = true
    setPending(true)
    try { accept(await bridge.invoke(channel, draft.downloadMirror)) }
    catch (error) { if (mounted.current) toast(String(error), 'error') }
    finally { busyRef.current = false; if (mounted.current) setPending(false) }
  }
  const busy = pending || state.phase === 'checking' || state.phase === 'downloading'
  const diskImage = state.installerType === 'disk-image'
  const canDownload = !!state.release && (state.phase === 'available' || (state.phase === 'error' && state.total !== undefined))
  const percent = state.total ? Math.min(100, Math.floor((state.received ?? 0) / state.total * 100)) : 0
  const title = state.phase === 'checking' ? '正在检查新版本'
    : state.phase === 'current' ? '当前已是最新版本'
    : state.phase === 'downloading' ? '正在下载安装包'
    : state.phase === 'ready' ? '更新已准备就绪'
    : state.phase === 'available' ? `发现新版本 v${state.release?.version}`
    : state.phase === 'error' ? '更新未完成' : '让 Plus 保持最新'

  return (
    <>
      <PageHeader title="更新与下载" description="检查 GitHub Desktop Plus 新版本，选择适合当前网络的下载线路。"
        actions={<Button disabled={busy || installing} onClick={() => void run('gdp:update-check')}><RefreshCw className={state.phase === 'checking' ? 'gdp-spin' : undefined} />检查更新</Button>} />
      <div className="settings-grid">
        <SettingSection className="panel-span" title="GitHub Desktop Plus" description={`当前版本 v${state.currentVersion}`} icon={<ArrowDownToLine />}>
          <div className="update-summary" aria-live="polite">
            <span className="update-status-icon" data-phase={state.phase}>
              {busy ? <Loader2 className="gdp-spin" /> : state.phase === 'ready' || state.phase === 'current' ? <CircleCheck /> : <ArrowDownToLine />}
            </span>
            <div className="update-copy"><h3>{title}</h3><p>{state.phase === 'ready' ? diskImage ? '安装包已通过 SHA-256 校验，打开后将 Plus 拖入 Applications。' : '安装包已通过 SHA-256 校验，可以启动安装向导。'
              : state.phase === 'downloading' ? `${formatSize(state.received ?? 0)} / ${formatSize(state.total ?? 0)} · ${state.source ?? ''}`
              : state.release && canDownload ? `v${state.release.version} · ${formatSize(state.release.size)}`
              : '点击检查更新，从 GitHub Releases 获取最新的稳定版本。'}</p></div>
            <div className="update-actions">
              {canDownload && <Button variant="primary" disabled={busy} onClick={() => void run('gdp:update-download')}><ArrowDownToLine />下载更新</Button>}
              {state.phase === 'ready' && <Button variant="primary" disabled={installing || dirty || saving} onClick={async () => {
                if (busyRef.current) return
                busyRef.current = true
                setInstalling(true)
                try {
                  const result = await bridge.invoke('gdp:update-install')
                  if (!result.ok) throw new Error(result.reason ?? '无法启动安装向导')
                  if (mounted.current) toast(diskImage ? '磁盘映像已打开，将 Plus 拖入 Applications 后重新启动。' : '安装向导已完成', 'success')
                } catch (error) { if (mounted.current) toast(String(error), 'error') }
                finally { busyRef.current = false; if (mounted.current) setInstalling(false) }
              }}>{installing ? <Loader2 className="gdp-spin" /> : <CheckCheck />}{diskImage ? '打开安装包' : '安装更新'}</Button>}
              {busy && <Button onClick={() => void bridge.invoke('gdp:update-cancel').then(accept).catch(error => toast(String(error), 'error'))}><X />取消{state.phase === 'checking' ? '检查' : '下载'}</Button>}
              <Button variant="ghost" disabled={installing} onClick={() => bridge.openExternal(state.release?.url ?? RELEASES_URL)}><ExternalLink />发布页</Button>
            </div>
          </div>
          {state.phase === 'downloading' && <progress className="update-progress" aria-label="更新下载进度" value={percent} max={100} />}
          {state.error && <Note tone="danger">{state.error}</Note>}
          {state.phase === 'ready' && dirty && <Note tone="warn">请先保存更改，再安装更新。</Note>}
          {state.checkedAt && <p className="setting-hint">上次检查 {new Date(state.checkedAt).toLocaleString('zh-CN')}{state.source ? ` · ${state.source}` : ''}</p>}
        </SettingSection>
        <SettingSection title="下载加速" description="只用于 Plus 的公开发布文件，按需连接。" icon={<Globe2 />}>
          <SettingField label="下载线路" hint="自动模式优先使用镜像；线路失败或校验不符时切换备用源。直连模式只访问 GitHub。">
            <Select aria-label="下载线路" value={draft.downloadMirror} options={MIRROR_OPTIONS} disabled={busy} onValueChange={value => update(prev => ({ ...prev, downloadMirror: normalizeDownloadMirror(value) }))} />
          </SettingField>
          <Button variant="link" onClick={() => bridge.openExternal('https://github.akams.cn/')}><ExternalLink />查看 akams 镜像目录</Button>
        </SettingSection>
        <SettingSection title="安装与校验" description={diskImage ? '文件校验通过后打开磁盘映像并替换 Applications 中的 Plus。' : '文件校验通过后再启动安装向导。'} icon={<ShieldCheck />}>
          <p className="setting-description">使用 GitHub 发布信息中的 SHA-256 校验下载内容；镜像异常会丢弃文件并重试。安装包流式写入磁盘，只保留最近一份。</p>
          <p className="setting-description">此处更新 GitHub Desktop Plus。常规中的「禁用官方更新」控制 GitHub Desktop 本体，两者互不影响。</p>
        </SettingSection>
        {state.release?.notes && <SettingSection className="panel-span" title={`v${state.release.version} 更新说明`}><pre className="update-notes">{state.release.notes}</pre></SettingSection>}
      </div>
    </>
  )
}
