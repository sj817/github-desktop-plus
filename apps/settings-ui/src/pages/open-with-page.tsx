import { ArrowDown, ArrowUp, Bot, Code2, FolderOpen, GripVertical, Layers, Loader2, Pencil, Pin, Plus, ScanSearch, Terminal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { TARGET_PATH_TOKEN, type DetectedOpenWithItem, type OpenWithGroup } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { EmptyState, Note, PageHeader, SettingField, SettingItem, SettingSection } from '@/components/settings/section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { createEntry, uniqueId, type OpenWithEntry } from '@/lib/settings'
import { useSettings } from '@/lib/settings-store'

const GROUP_LABEL: Record<OpenWithGroup, string> = { editor: '编辑器', agent: 'AI 助手', shell: '终端' }
const GROUP_ICON: Record<OpenWithGroup, typeof Code2> = { editor: Code2, agent: Bot, shell: Terminal }

function GroupGlyph({ group }: { group: OpenWithGroup }) {
  const Icon = GROUP_ICON[group]
  return <span className="panel-glyph"><Icon /></span>
}

export function OpenWithPage() {
  const { draft, update } = useSettings()
  const bridge = useBridge()
  const toast = useToast()
  const [detected, setDetected] = useState<DetectedOpenWithItem[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [editing, setEditing] = useState<{ item: OpenWithEntry; isNew: boolean } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const items = draft.openWith.items

  const patchItem = (key: string, patch: Partial<OpenWithEntry>) => update(prev => ({
    ...prev, openWith: { ...prev.openWith, items: prev.openWith.items.map(item => item.key === key ? { ...item, ...patch } : item) },
  }))
  const removeItem = (key: string) => update(prev => ({
    ...prev, openWith: { ...prev.openWith, items: prev.openWith.items.filter(item => item.key !== key) },
  }))
  const moveItem = (key: string, target: string | number) => update(prev => {
    const list = [...prev.openWith.items]
    const from = list.findIndex(item => item.key === key)
    const to = typeof target === 'number' ? from + target : list.findIndex(item => item.key === target)
    if (from < 0 || to < 0 || to >= list.length || from === to) return prev
    list.splice(to, 0, list.splice(from, 1)[0]!)
    return { ...prev, openWith: { ...prev.openWith, items: list } }
  })
  const addCandidate = (candidate: DetectedOpenWithItem) => update(prev => {
    if (prev.openWith.items.some(item => item.path.toLowerCase() === candidate.path.toLowerCase())) return prev
    const item = createEntry({ ...candidate, id: uniqueId(prev.openWith.items, candidate.id) })
    return { ...prev, openWith: { ...prev.openWith, items: [...prev.openWith.items, item] } }
  })
  const detect = async () => {
    setDetecting(true)
    try { setDetected(await bridge.invoke('gdp:open-with-detect')) }
    catch (error) { toast('检测失败：' + String(error), 'error') }
    finally { setDetecting(false) }
  }
  const addCustom = () => setEditing({ isNew: true, item: createEntry({ id: uniqueId(items, 'custom'), path: '', args: '"' + TARGET_PATH_TOKEN + '"' }) })

  return (
    <>
      <PageHeader title="打开方式" description="从仓库或文件右键菜单启动常用的编辑器、AI 助手和终端。" actions={<>
        <Button onClick={detect} disabled={detecting}>{detecting ? <Loader2 className="gdp-spin" /> : <ScanSearch />}自动检测</Button>
        <Button variant="primary" onClick={addCustom}><Plus />添加程序</Button>
      </>} />
      <div className="setting-stack">
        <SettingSection title="菜单展示" icon={<Layers />}>
          <SettingItem title="折叠为子菜单" description="将程序收进「打开方式」子菜单，保持右键菜单简洁。标记为「单独显示」的程序仍留在菜单外。">
            <Switch aria-label="折叠为子菜单" checked={draft.openWith.submenu} onCheckedChange={submenu => update(prev => ({ ...prev, openWith: { ...prev.openWith, submenu } }))} />
          </SettingItem>
        </SettingSection>
        <section aria-label="已配置程序">
          <div className="list-heading"><h2>已配置程序</h2><Badge>{items.length} 个</Badge></div>
          {items.length === 0 ? (
            <div className="setting-panel"><EmptyState icon={<Code2 />} title="添加第一个打开方式" action={<Button variant="primary" onClick={detect} disabled={detecting}><ScanSearch />检测已安装的程序</Button>}>添加编辑器、AI 助手或终端后，即可从仓库或文件的右键菜单打开。</EmptyState></div>
          ) : (
            <div className="launcher-grid">
              {items.map((item, index) => (
                <article key={item.key} className="launcher-card" data-disabled={!item.enabled} data-dragging={dragging === item.key} data-drop={dropTarget === item.key}
                  onDragOver={event => { if (!dragging || dragging === item.key) return; event.preventDefault(); event.stopPropagation(); setDropTarget(item.key) }}
                  onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragging) moveItem(dragging, item.key); setDragging(null); setDropTarget(null) }}>
                  <div className="launcher-card-head">
                    <GroupGlyph group={item.group} />
                    <div><h3 className="launcher-name">{item.label || '未命名程序'}</h3><span className="setting-hint">{GROUP_LABEL[item.group]}{item.group === 'agent' ? (item.console ? ' · 命令行' : ' · 桌面版') : ''}</span></div>
                    <Switch aria-label={'启用 ' + (item.label || '未命名程序')} checked={item.enabled} onCheckedChange={enabled => patchItem(item.key, { enabled })} />
                  </div>
                  <p className="launcher-path" title={item.path}>{item.path}</p>
                  <div className="launcher-card-foot">
                    <Badge tone={item.enabled ? 'accent' : 'neutral'}>{item.enabled ? '已启用' : '已停用'}</Badge>
                    {draft.openWith.submenu ? <Chip className="launcher-pin" active={item.topLevel} title="折叠为子菜单时，仍直接显示在右键菜单中" onClick={() => patchItem(item.key, { topLevel: !item.topLevel })}><Pin />单独显示</Chip> : null}
                    <button type="button" draggable className="launcher-drag" aria-label={'拖动排序 ' + item.label} title="拖动排序"
                      onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-gdp-launcher', item.key); event.dataTransfer.effectAllowed = 'move'; setDragging(item.key) }}
                      onDragEnd={() => { setDragging(null); setDropTarget(null) }}><GripVertical /></button>
                    <Button size="icon-sm" variant="ghost" aria-label={'上移 ' + item.label} disabled={index === 0} onClick={() => moveItem(item.key, -1)}><ArrowUp /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={'下移 ' + item.label} disabled={index === items.length - 1} onClick={() => moveItem(item.key, 1)}><ArrowDown /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={'编辑 ' + item.label} onClick={() => setEditing({ item, isNew: false })}><Pencil /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={'移除 ' + item.label} onClick={() => removeItem(item.key)}><Trash2 /></Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <Note>拖动手柄或使用上下箭头调整顺序。编辑器打开右键选中的文件，终端进入文件所在目录，AI 助手始终打开整个仓库；仓库菜单使用仓库目录。</Note>
      </div>
      <Dialog open={detected !== null} onClose={() => setDetected(null)} title="检测到的程序" description="选择要加入仓库和文件右键菜单的程序。" footer={<Button variant="primary" onClick={() => setDetected(null)}>完成</Button>}>
        {detected?.length === 0 ? <EmptyState icon={<ScanSearch />} title="没有发现新程序">可以关闭此窗口，选择「添加程序」手动配置。</EmptyState> : detected?.map(candidate => {
          const added = items.some(item => item.path.toLowerCase() === candidate.path.toLowerCase())
          return <div key={candidate.path} className="candidate-row">
            <GroupGlyph group={candidate.group} />
            <div className="candidate-copy"><strong>{candidate.label}</strong><p>{candidate.path}</p></div>
            <Button size="sm" variant={added ? 'ghost' : 'primary'} disabled={added} onClick={() => addCandidate(candidate)} aria-label={'添加 ' + candidate.label}>{added ? '已添加' : '添加'}</Button>
          </div>
        })}
      </Dialog>
      {editing ? <EntryDialog key={editing.item.key} item={editing.item} isNew={editing.isNew} onClose={() => setEditing(null)} onSave={item => {
        update(prev => ({ ...prev, openWith: { ...prev.openWith, items: editing.isNew
          ? [...prev.openWith.items, { ...item, id: uniqueId(prev.openWith.items, item.id) }]
          : prev.openWith.items.map(current => current.key === item.key ? item : current) } }))
        setEditing(null)
      }} /> : null}
    </>
  )
}

function EntryDialog({ item, isNew, onClose, onSave }: { item: OpenWithEntry; isNew: boolean; onClose: () => void; onSave: (item: OpenWithEntry) => void }) {
  const [value, setValue] = useState(item)
  const [browsing, setBrowsing] = useState(false)
  const bridge = useBridge()
  const toast = useToast()
  const patch = (next: Partial<OpenWithEntry>) => setValue(prev => ({ ...prev, ...next }))
  const browse = async () => {
    setBrowsing(true)
    try {
      const result = await bridge.invoke('gdp:open-with-browse')
      if (result.ok && result.path) setValue(prev => ({ ...prev, path: result.path!, ...(prev.label.trim() === '' ? { label: result.label ?? '' } : {}) }))
      else if (result.reason && result.reason !== 'canceled') toast('选择失败：' + result.reason, 'error')
    } catch (error) { toast('选择失败：' + String(error), 'error') }
    finally { setBrowsing(false) }
  }
  return (
    <Dialog open title={isNew ? '添加程序' : '编辑程序'} description="设置程序名称、路径和启动方式，完成后保存设置生效。" onClose={onClose}
      onSubmit={event => { event.preventDefault(); if (value.path.trim()) onSave({ ...value, label: value.label.trim(), path: value.path.trim() }) }}
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={!value.path.trim()}>{isNew ? '添加到列表' : '完成编辑'}</Button></>}>
      <SettingField label="显示名称" htmlFor="gdp-entry-name"><Input id="gdp-entry-name" placeholder="例如 Visual Studio Code" value={value.label} onChange={event => patch({ label: event.target.value })} /></SettingField>
      <SettingField label="程序类型">
        <Segmented aria-label="程序类型" value={value.group} options={(['editor', 'agent', 'shell'] as const).map(group => ({ value: group, label: GROUP_LABEL[group] }))} onValueChange={group => patch({ group, ...(group === 'agent' ? {} : { console: group === 'shell' }) })} />
      </SettingField>
      <SettingField label="程序路径或应用链接" htmlFor="gdp-entry-path" hint={'也可以填写 claude:// 这类应用链接，其中的 ' + TARGET_PATH_TOKEN + ' 会自动编码。'} trailing={<Button size="xs" onClick={browse} disabled={browsing}>{browsing ? <Loader2 className="gdp-spin" /> : <FolderOpen />}选择程序</Button>}>
        <Input id="gdp-entry-path" className="gdp-mono" required spellCheck={false} placeholder="选择程序，或粘贴完整路径 / 应用链接" value={value.path} onChange={event => patch({ path: event.target.value })} />
      </SettingField>
      <SettingField label="启动参数" htmlFor="gdp-entry-args" hint={'使用 ' + TARGET_PATH_TOKEN + ' 作为目标占位符：编辑器接收文件或仓库路径，终端接收所在目录，AI 助手接收仓库路径。'}>
        <Input id="gdp-entry-args" className="gdp-mono" spellCheck={false} value={value.args} onChange={event => patch({ args: event.target.value })} />
      </SettingField>
      <SettingItem title="在终端窗口中运行" description="命令行程序（如 Claude Code CLI）需要开启。"><Switch aria-label="在终端窗口中运行" checked={value.console} onCheckedChange={console => patch({ console })} /></SettingItem>
    </Dialog>
  )
}
