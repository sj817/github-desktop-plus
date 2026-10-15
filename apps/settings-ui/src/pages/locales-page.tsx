import { Check, Download, FolderOpen, Languages, Loader2, Plus, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBridge } from '@/bridge/context'
import { EmptyState, Note, PageHeader, SettingField } from '@/components/settings/section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useSettings } from '@/lib/settings-store'

const validLocaleName = (name: string) => name.length <= 64 && /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(name)

export function LocalesPage() {
  const bridge = useBridge()
  const toast = useToast()
  const { draft, update } = useSettings()
  const [locales, setLocales] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const list = await bridge.invoke('gdp:list-locales')
      if (mounted.current) { setLocales(list); setLoadError(null) }
    } catch (error) {
      if (mounted.current) setLoadError(String(error))
    }
  }, [bridge])
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false } }, [refresh])

  const create = async () => {
    const name = newName.trim()
    if (!validLocaleName(name)) { setCreateError('请使用字母、数字、短横线或下划线，例如 fr-FR。'); return }
    if (locales?.includes(name)) { setCreateError('这个语言包已经存在。'); return }
    setPending(true)
    setCreateError(null)
    try {
      const result = await bridge.invoke('gdp:create-locale', name)
      if (!result.ok) throw new Error(result.reason ?? '未知错误')
      setCreating(false)
      setNewName('')
      await refresh()
      toast('已创建语言包 ' + name)
    } catch (error) { setCreateError(String(error)) }
    finally { setPending(false) }
  }
  const remove = async () => {
    if (!deleting || deleting === draft.locale) return
    setPending(true)
    setDeleteError(null)
    try {
      const result = await bridge.invoke('gdp:delete-locale', deleting)
      if (!result.ok) throw new Error(result.reason ?? '未知错误')
      setDeleting(null)
      await refresh()
      toast('语言包已删除')
    } catch (error) { setDeleteError(String(error)) }
    finally { setPending(false) }
  }
  const exportLocale = async (locale: string) => {
    try {
      const result = await bridge.invoke('gdp:export-locale-file', locale)
      if (!result.ok) throw new Error(result.reason ?? '未知错误')
      toast('已导出到 ' + (result.path ?? '下载目录'))
    } catch (error) { toast('导出失败：' + String(error), 'error') }
  }
  const importFile = async (file: File) => {
    const name = file.name.replace(/\.json$/i, '')
    if (!validLocaleName(name)) { toast('语言包文件名应为语言代码，例如 fr-FR.json。', 'error'); return }
    setPending(true)
    try {
      const data: unknown = JSON.parse(await file.text())
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('语言包内容需要是 JSON 对象。')
      const result = await bridge.invoke('gdp:import-locale', name, data)
      if (!result.ok) throw new Error(result.reason ?? '未知错误')
      await refresh()
      toast('已导入语言包 ' + name)
    } catch (error) { toast('导入失败：' + String(error), 'error') }
    finally { setPending(false) }
  }

  return (
    <>
      <PageHeader title="语言包" description="管理界面翻译，或创建你自己的语言包。" actions={<>
        <Button onClick={() => fileInput.current?.click()} disabled={pending}><Upload />导入 JSON</Button>
        <Button variant="primary" onClick={() => { setNewName(''); setCreateError(null); setCreating(true) }} disabled={pending}><Plus />新建语言包</Button>
      </>} />
      <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="选择语言包文件" onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void importFile(file)
      }} />
      <div className="setting-stack">
        <div className="list-heading"><h2>已安装语言包</h2>{locales ? <Badge>{locales.length} 个</Badge> : null}
          <Button size="sm" variant="ghost" onClick={() => { void bridge.invoke('gdp:open-locales-dir').catch(error => toast('打开目录失败：' + String(error), 'error')) }}><FolderOpen />打开目录</Button>
        </div>
        {loadError ? <div className="setting-panel"><EmptyState icon={<Languages />} title="无法读取语言包" action={<Button onClick={() => void refresh()}><RotateCcw />重试</Button>}>{loadError}</EmptyState></div>
          : locales === null ? <div className="settings-loading" aria-label="正在加载语言包"><div className="gdp-skeleton" /><div className="gdp-skeleton" /></div>
          : locales.length === 0 ? <div className="setting-panel"><EmptyState icon={<Languages />} title="还没有语言包" action={<Button variant="primary" onClick={() => fileInput.current?.click()}><Upload />导入语言包</Button>}>导入已有的 JSON 翻译文件，或新建空白语言包开始翻译。</EmptyState></div>
          : <div className="locale-grid">{locales.map(locale => {
            const selected = locale === draft.locale
            return <article key={locale} className="locale-card" data-selected={selected}>
              <div className="locale-card-head">
                <span className="locale-tile">{getLocaleGlyph(locale)}</span>
                <div><h2 className="locale-name">{getLocaleDisplayName(locale)}</h2><p className="locale-code">{locale}</p></div>
                {selected ? <Badge tone="accent">已选择</Badge> : null}
              </div>
              <div className="locale-card-foot">
                <Button size="sm" variant={selected ? 'ghost' : 'primary'} disabled={selected} onClick={() => update(prev => ({ ...prev, locale }))} aria-label={'选用 ' + locale}>
                  {selected ? <Check /> : null}{selected ? '当前选择' : '选用'}
                </Button>
                <div className="card-spacer" />
                <Button size="icon-sm" variant="ghost" aria-label={'导出 ' + locale} onClick={() => void exportLocale(locale)}><Download /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={'删除 ' + locale} disabled={selected || pending} title={selected ? '请先选择其他语言包' : '删除语言包'} onClick={() => { setDeleteError(null); setDeleting(locale) }}><Trash2 /></Button>
              </div>
            </article>
          })}</div>}
        <Note>选择语言包后点击「保存更改」生效。新建、导入和删除会立即更新本机语言包文件。</Note>
      </div>
      <Dialog open={creating} title="新建语言包" description="创建一个空白 JSON 翻译文件，之后可在本机目录中编辑。" onClose={() => { if (!pending) setCreating(false) }}
        onSubmit={event => { event.preventDefault(); void create() }}
        footer={<><Button variant="ghost" disabled={pending} onClick={() => setCreating(false)}>取消</Button><Button variant="primary" type="submit" disabled={pending || !newName.trim()}>{pending ? <Loader2 className="gdp-spin" /> : <Plus />}创建语言包</Button></>}>
        <SettingField label="语言代码" htmlFor="gdp-locale-name" hint="例如 fr-FR、de-DE 或 zh-Hant。">
          <Input id="gdp-locale-name" className="gdp-mono" required maxLength={64} spellCheck={false} autoComplete="off" value={newName} aria-invalid={!!createError} onChange={event => { setNewName(event.target.value); setCreateError(null) }} placeholder="fr-FR" />
        </SettingField>
        {createError ? <div role="alert"><Note tone="danger">{createError}</Note></div> : null}
      </Dialog>
      <Dialog open={deleting !== null} title="删除语言包" description="将删除本机的语言包文件，此操作无法撤销。" onClose={() => { if (!pending) setDeleting(null) }}
        footer={<><Button variant="ghost" disabled={pending} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" disabled={pending} onClick={() => void remove()}>{pending ? <Loader2 className="gdp-spin" /> : <Trash2 />}删除语言包</Button></>}>
        <p>确定删除 <strong>{deleting ? getLocaleDisplayName(deleting) : ''}</strong>（{deleting}）？</p>
        {deleteError ? <div role="alert"><Note tone="danger">{deleteError}</Note></div> : null}
      </Dialog>
    </>
  )
}

function getLocaleGlyph(locale: string): string {
  const code = locale.split(/[-_]/)[0]!.toLowerCase()
  return ({ zh: '文', ja: 'あ', ko: '한', en: 'En' } as Record<string, string>)[code] ?? code.slice(0, 2).toUpperCase()
}

function getLocaleDisplayName(locale: string): string {
  const names: Record<string, string> = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'zh-HK': '繁體中文（香港）', 'en-US': 'English', 'en-GB': 'English (UK)', 'ja-JP': '日本語', 'ko-KR': '한국어' }
  if (names[locale]) return names[locale]
  try { return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(locale) ?? locale }
  catch { return locale }
}
