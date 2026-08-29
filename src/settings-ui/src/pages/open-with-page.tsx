import { ChevronDown, ChevronUp, FolderPlus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { TARGET_PATH_TOKEN, type DetectedOpenWithItem } from '@shared/gdp-ipc'
import { useBridge } from '@/bridge/context'
import { Badge, EmptyState, SettingItem, SettingSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { createEntry, uniqueId, type OpenWithEntry } from '@/lib/settings'
import { useSettings } from '@/lib/settings-store'

const GROUP_OPTIONS = [
  { value: 'editor', label: '编辑器' },
  { value: 'shell', label: '终端' },
] as const

export function OpenWithPage() {
  const { draft, update } = useSettings()
  const bridge = useBridge()
  const toast = useToast()

  const [detected, setDetected] = useState<DetectedOpenWithItem[] | null>(null)
  const [detecting, setDetecting] = useState(false)

  const items = draft.openWith.items

  const setItems = (next: OpenWithEntry[]) =>
    update(prev => ({ ...prev, openWith: { ...prev.openWith, items: next } }))

  const patchItem = (key: string, patch: Partial<OpenWithEntry>) =>
    setItems(items.map(item => (item.key === key ? { ...item, ...patch } : item)))

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    setItems(next)
  }

  const addItem = (candidate: DetectedOpenWithItem) => {
    setItems([
      ...items,
      createEntry({
        id: uniqueId(items, candidate.id),
        label: candidate.label,
        path: candidate.path,
        args: candidate.args,
        group: candidate.group,
        console: candidate.console,
      }),
    ])
    // No need to prune `detected` — the render filters out anything already
    // present in the list.
  }

  const detect = async () => {
    setDetecting(true)
    try {
      const found = await bridge.invoke('gdp:open-with-detect')
      setDetected(found)
    } catch (error) {
      toast(`检测失败：${String(error)}`, 'error')
    } finally {
      setDetecting(false)
    }
  }

  const browse = async () => {
    try {
      const result = await bridge.invoke('gdp:open-with-browse')
      if (!result.ok || !result.path) {
        if (result.reason && result.reason !== 'canceled') {
          toast(`选择失败：${result.reason}`, 'error')
        }
        return
      }
      setItems([
        ...items,
        createEntry({
          id: uniqueId(items, `custom-${items.length + 1}`),
          label: result.label ?? '',
          path: result.path,
          args: `"${TARGET_PATH_TOKEN}"`,
        }),
      ])
    } catch (error) {
      toast(`选择失败：${String(error)}`, 'error')
    }
  }

  // Candidates already in the list are not worth offering again.
  const freshCandidates = (detected ?? []).filter(
    candidate => !items.some(item => item.path.toLowerCase() === candidate.path.toLowerCase())
  )

  return (
    <>
      <SettingSection title="显示方式">
        <SettingItem
          title="折叠为子菜单"
          description="条目较多时收进「打开方式 ▸」，而不是平铺在右键菜单里"
        >
          <Switch
            checked={draft.openWith.submenu}
            onCheckedChange={checked =>
              update(prev => ({ ...prev, openWith: { ...prev.openWith, submenu: checked } }))
            }
          />
        </SettingItem>
      </SettingSection>

      <SettingSection
        title="条目"
        hint="按此顺序显示在右键菜单中"
        action={
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={detect} disabled={detecting}>
              <Search />
              {detecting ? '扫描中…' : '自动检测'}
            </Button>
            <Button size="sm" onClick={browse}>
              <FolderPlus />
              手动添加
            </Button>
          </div>
        }
      >
        {items.length === 0 ? (
          <EmptyState>还没有条目 — 用「自动检测」找出已安装的编辑器和终端</EmptyState>
        ) : (
          items.map((item, index) => (
            <div key={item.key} className="flex flex-col gap-2 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <Switch
                  aria-label="启用该条目"
                  checked={item.enabled}
                  onCheckedChange={checked => patchItem(item.key, { enabled: checked })}
                />
                <Input
                  className="flex-1"
                  aria-label="显示名称"
                  placeholder="显示名称"
                  spellCheck={false}
                  value={item.label}
                  onChange={event => patchItem(item.key, { label: event.target.value })}
                />
                <Select
                  aria-label="分组"
                  className="w-24"
                  value={item.group}
                  options={GROUP_OPTIONS}
                  onValueChange={group => patchItem(item.key, { group })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  title="上移"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="下移"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="删除"
                  className="hover:text-danger"
                  onClick={() => setItems(items.filter(entry => entry.key !== item.key))}
                >
                  <Trash2 />
                </Button>
              </div>

              <div className="flex items-center gap-2 pl-1">
                <Input
                  className="flex-2 font-mono text-[12px]"
                  aria-label="可执行文件路径"
                  placeholder="可执行文件完整路径"
                  spellCheck={false}
                  value={item.path}
                  onChange={event => patchItem(item.key, { path: event.target.value })}
                />
                <Input
                  className="flex-1 font-mono text-[12px]"
                  aria-label="启动参数"
                  placeholder={`${TARGET_PATH_TOKEN} 会被替换成仓库路径`}
                  spellCheck={false}
                  value={item.args}
                  onChange={event => patchItem(item.key, { args: event.target.value })}
                />
                <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] whitespace-nowrap text-fg-subtle">
                  <input
                    type="checkbox"
                    className="size-3.5"
                    checked={item.console}
                    onChange={event => patchItem(item.key, { console: event.target.checked })}
                  />
                  新建终端窗口
                </label>
              </div>
            </div>
          ))
        )}
      </SettingSection>

      {detected !== null ? (
        <SettingSection
          title="检测结果"
          hint={
            freshCandidates.length > 0
              ? `找到 ${freshCandidates.length} 个未添加的程序`
              : undefined
          }
        >
          {freshCandidates.length === 0 ? (
            <EmptyState>没有找到新的程序 — 已安装的都在上面的列表里了</EmptyState>
          ) : (
            freshCandidates.map(candidate => (
              <div key={candidate.path} className="flex items-center gap-2.5 px-3.5 py-2">
                <span className="shrink-0 text-[13px] font-medium">{candidate.label}</span>
                <Badge>{candidate.group === 'shell' ? '终端' : '编辑器'}</Badge>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-subtle"
                  title={candidate.path}
                >
                  {candidate.path}
                </span>
                <Button size="sm" onClick={() => addItem(candidate)}>
                  添加
                </Button>
              </div>
            ))
          )}
        </SettingSection>
      ) : null}

      <p className="px-0.5 text-[11.5px] text-fg-subtle">
        参数中的 {TARGET_PATH_TOKEN} 会替换成仓库路径；GitHub Desktop 自带的编辑器与终端条目保持不变。
      </p>
    </>
  )
}
