import {
  ChevronDown,
  Code2,
  FolderPlus,
  GripVertical,
  Layers,
  Loader2,
  Plus,
  ScanSearch,
  Terminal,
  Trash2,
} from 'lucide-react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion'
import { useState } from 'react'
import { TARGET_PATH_TOKEN, type DetectedOpenWithItem } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { EmptyState, Note, SettingItem, SettingSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { createEntry, uniqueId, type OpenWithEntry } from '@/lib/settings'
import { useSettings } from '@/lib/settings-store'
import { cn } from '@/lib/utils'

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

  const toolbar = (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={detect} disabled={detecting}>
        {detecting ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5 text-green-600 dark:text-green-400" />}
        自动检测
      </Button>
      <Button size="sm" variant="secondary" onClick={browse}>
        <FolderPlus className="size-3.5" />
        手动添加
      </Button>
    </div>
  )

  return (
    <>
      <SettingSection
        title={
          <span className="flex items-center gap-1.5">
            <Layers className="size-3.5 text-green-600 dark:text-green-400" />
            <span>菜单展示</span>
          </span>
        }
      >
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

      <section className="mb-6 space-y-2.5">
        <header className="flex items-center justify-between gap-3 px-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] leading-5 font-semibold text-fg tracking-normal flex items-center gap-1.5">
              <Terminal className="size-3.5 text-green-600 dark:text-green-400" />
              <span>已配置条目</span>
            </h2>
            {items.length > 0 ? (
              <span className="rounded-full bg-inset px-2 py-0.5 font-mono text-[11px] text-fg-subtle border border-line/60">
                {items.length}
              </span>
            ) : null}
          </div>
          {toolbar}
        </header>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-line/70 bg-elevated shadow-xs overflow-hidden">
            <EmptyState
              icon={<Code2 className="size-5 text-green-600 dark:text-green-400" />}
              title="还没有配置打开方式"
              action={
                <Button size="sm" variant="primary" onClick={detect} disabled={detecting}>
                  {detecting ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
                  检测已安装的程序
                </Button>
              }
            >
              自动检测会扫描常见的编辑器与终端，也可点击上方「手动添加」选择任意程序
            </EmptyState>
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={items}
            onReorder={setItems}
            className="space-y-2"
          >
            {items.map(item => (
              <EntryCard
                key={item.key}
                item={item}
                onPatch={patch => patchItem(item.key, patch)}
                onRemove={() => setItems(items.filter(entry => entry.key !== item.key))}
              />
            ))}
          </Reorder.Group>
        )}
      </section>

      {detected !== null ? (
        <SettingSection
          title={
            <span className="flex items-center gap-1.5">
              <ScanSearch className="size-3.5 text-green-600 dark:text-green-400" />
              <span>检测到的程序</span>
            </span>
          }
          className="animate-rise-in"
        >
          {freshCandidates.length === 0 ? (
            <div className="px-4.5 py-4 text-[12px] text-fg-muted text-center">
              已安装的程序都在上面的列表里了，没有发现新程序
            </div>
          ) : (
            freshCandidates.map(candidate => {
              const isShell = candidate.group === 'shell'
              return (
                <div key={candidate.path} className="flex items-center gap-3 px-4.5 py-3 hover:bg-hover/20 transition-colors">
                  <div
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-md',
                      isShell
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-green-500/10 text-green-600 dark:text-green-400'
                    )}
                  >
                    {isShell ? <Terminal className="size-3.5" /> : <Code2 className="size-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-fg">{candidate.label}</span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none border',
                          isShell
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
                            : 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20'
                        )}
                      >
                        {isShell ? '终端' : '编辑器'}
                      </span>
                    </div>
                    <div
                      className="truncate font-mono text-[11px] text-fg-subtle mt-0.5"
                      title={candidate.path}
                    >
                      {candidate.path}
                    </div>
                  </div>
                  <Button size="xs" variant="secondary" onClick={() => addItem(candidate)}>
                    <Plus className="size-3.5" />
                    添加
                  </Button>
                </div>
              )
            })
          )}
        </SettingSection>
      ) : null}

      <div className="px-1">
        <Note tone="neutral">
          参数中的 <code className="rounded bg-inset px-1 font-mono text-[11px] border border-line/60">{TARGET_PATH_TOKEN}</code> 会在调用时自动替换为仓库路径。
        </Note>
      </div>
    </>
  )
}

function EntryCard({
  item,
  onPatch,
  onRemove,
}: {
  item: OpenWithEntry
  onPatch: (patch: Partial<OpenWithEntry>) => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const [expanded, setExpanded] = useState(false)

  const isShell =
    item.group === 'shell' ||
    /\b(cmd|powershell|pwsh|wt|bash|sh|zsh|terminal|alacritty|wezterm|warp|tabby|git-bash|hyper|kitty|conemu)\b/i.test(
      item.path || item.label || ''
    )

  return (
    <Reorder.Item
      value={item}
      id={item.key}
      layout="position"
      dragListener={false}
      dragControls={controls}
      whileDrag={{
        zIndex: 50,
        opacity: 0.9,
      }}
      className={cn(
        'rounded-xl border border-line/70 bg-elevated shadow-xs transition-colors overflow-hidden',
        !item.enabled && 'opacity-55 bg-canvas/40'
      )}
    >
      {/* 核心行：拖拽手柄 + 分类图标 + 140px名称框 + 占位空间 + 展开/折叠 + 删除 + 主开关 */}
      <div className="flex items-center gap-2 p-2.5">
        {/* 6 个圆点纯图标手柄（无底色小方块） */}
        <div
          onPointerDown={e => controls.start(e)}
          className="flex size-5 shrink-0 cursor-grab items-center justify-center text-fg-subtle/50 hover:text-fg active:cursor-grabbing transition-colors touch-none select-none"
          title="拖拽调整顺序"
        >
          <GripVertical className="size-3.5" />
        </div>

        {/* 终端/编辑器色彩图标 */}
        <Tooltip content={isShell ? '终端程序（点击切换）' : '编辑器 / IDE（点击切换）'}>
          <button
            type="button"
            aria-label={isShell ? '终端程序' : '编辑器程序'}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer',
              isShell
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                : 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20'
            )}
            onClick={() => onPatch({ group: isShell ? 'editor' : 'shell', console: !isShell })}
          >
            {isShell ? <Terminal className="size-3.5" /> : <Code2 className="size-3.5" />}
          </button>
        </Tooltip>

        {/* 砍半宽度的名称输入框 (140px) */}
        <Input
          className="h-7.5 w-[140px] shrink-0 font-medium text-[13px] bg-field border-line/60"
          aria-label="显示名称"
          placeholder="名称（如 VS Code）"
          spellCheck={false}
          value={item.label}
          onChange={event => onPatch({ label: event.target.value })}
        />

        {/* 中间留白区 */}
        <div className="min-w-0 flex-1 h-7.5" />

        {/* 展开/折叠按钮 */}
        <Tooltip content={expanded ? '收起配置' : '展开详细路径与参数'}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={expanded ? '收起配置' : '展开详细路径与参数'}
            className="size-7 rounded-md text-fg-subtle hover:text-fg hover:bg-hover"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDown className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
          </Button>
        </Tooltip>

        {/* 删除按钮 */}
        <Tooltip content="删除">
          <Button
            size="icon"
            variant="ghost"
            aria-label="删除"
            className="size-7 rounded-md text-fg-subtle hover:bg-danger-soft hover:text-danger"
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </Tooltip>

        {/* 主开关 */}
        <div className="pl-1 border-l border-line/50 ml-0.5">
          <Switch
            aria-label="启用该条目"
            checked={item.enabled}
            onCheckedChange={checked => onPatch({ enabled: checked })}
          />
        </div>
      </div>

      {/* 展开配置区：采用 AnimatePresence + motion.div 平滑高度过渡，绝无抖动 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
            className="overflow-hidden border-t border-line/40 bg-canvas/30"
          >
            <div className="px-3 py-2.5 space-y-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-fg-muted px-0.5">可执行文件路径</label>
                <Input
                  className="h-7.5 font-mono text-[11px] bg-field border-line/60"
                  aria-label="可执行文件路径"
                  placeholder="可执行文件完整路径（如 C:\Program Files\Microsoft VS Code\Code.exe）"
                  spellCheck={false}
                  value={item.path}
                  onChange={event => onPatch({ path: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-fg-muted px-0.5">启动参数</label>
                <Input
                  className="h-7.5 font-mono text-[11px] bg-field border-line/60"
                  aria-label="启动参数"
                  placeholder={`参数: "${TARGET_PATH_TOKEN}"`}
                  spellCheck={false}
                  value={item.args}
                  onChange={event => onPatch({ args: event.target.value })}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}
