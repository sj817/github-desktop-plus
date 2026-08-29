import {
  Check,
  Download,
  FolderOpen,
  Languages,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBridge } from '@/bridge/context'
import { EmptyState, SettingSection } from '@/components/settings/section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'
import { useSettings } from '@/lib/settings-store'
import { cn } from '@/lib/utils'

export function LocalesPage() {
  const bridge = useBridge()
  const toast = useToast()
  const { draft, update } = useSettings()

  const [locales, setLocales] = useState<string[] | null>(null)
  const [newName, setNewName] = useState('')
  // Deleting takes two clicks: the first arms the button for a few seconds.
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setLocales(await bridge.invoke('gdp:list-locales'))
    } catch (error) {
      setLocales([])
      toast(`读取语言包失败：${String(error)}`, 'error')
    }
  }, [bridge, toast])

  useEffect(() => {
    void refresh()
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [refresh])

  const create = async () => {
    const name = newName.trim()
    if (name === '') return
    try {
      await bridge.invoke('gdp:create-locale', name)
      setNewName('')
      await refresh()
      toast(`已创建语言包 ${name}`)
    } catch (error) {
      toast(`创建失败：${String(error)}`, 'error')
    }
  }

  const remove = async (locale: string) => {
    if (armedDelete !== locale) {
      setArmedDelete(locale)
      if (armTimer.current) clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setArmedDelete(null), 3000)
      return
    }
    setArmedDelete(null)
    try {
      await bridge.invoke('gdp:delete-locale', locale)
      await refresh()
      toast(`已删除语言包 ${locale}`)
    } catch (error) {
      toast(`删除失败：${String(error)}`, 'error')
    }
  }

  // Written by the main process — renderer-side blob downloads are silently
  // swallowed by GitHub Desktop's session, so this is the only path that works.
  const exportLocale = async (locale: string) => {
    try {
      const result = await bridge.invoke('gdp:export-locale-file', locale)
      if (!result.ok) {
        toast(`导出失败：${result.reason ?? '未知错误'}`, 'error')
        return
      }
      toast(`已导出到 ${result.path ?? '下载目录'}`)
    } catch (error) {
      toast(`导出失败：${String(error)}`, 'error')
    }
  }

  const importFile = async (file: File) => {
    const localeName = file.name.replace(/\.json$/i, '')
    try {
      const data: unknown = JSON.parse(await file.text())
      const result = await bridge.invoke('gdp:import-locale', localeName, data)
      if (!result.ok) {
        toast(`导入失败：${result.reason ?? '未知错误'}`, 'error')
        return
      }
      await refresh()
      toast(`已导入语言包 ${localeName}`)
    } catch (error) {
      toast(`JSON 解析失败：${String(error)}`, 'error')
    }
  }

  const activate = (locale: string) => update(prev => ({ ...prev, locale }))

  const count = locales?.length ?? 0

  return (
    <>
      <SettingSection
        title="已安装"
        description={
          locales === null
            ? '正在读取…'
            : count === 0
              ? '还没有语言包'
              : `${count} 个语言包，当前使用 ${draft.locale}`
        }
        action={
          <>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload />
              导入 JSON
            </Button>
            <Tooltip content="在文件管理器中打开语言包目录">
              <Button
                size="icon"
                variant="ghost"
                aria-label="打开语言包目录"
                onClick={() => {
                  void bridge.invoke('gdp:open-locales-dir')
                }}
              >
                <FolderOpen />
              </Button>
            </Tooltip>
            <input
              ref={fileInput}
              type="file"
              accept=".json"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0]
                // Reset so picking the same file twice fires onChange again.
                event.target.value = ''
                if (file) void importFile(file)
              }}
            />
          </>
        }
      >
        {locales === null ? (
          <div className="space-y-3 py-3">
            {[0, 1].map(row => (
              <div key={row} className="flex items-center gap-3">
                <div className="gdp-skeleton size-7 rounded-md" />
                <div className="gdp-skeleton h-3.5 w-20 rounded" />
              </div>
            ))}
          </div>
        ) : count === 0 ? (
          <EmptyState icon={<Languages />} title="还没有语言包">
            新建一个空白语言包，或导入一份已有的 JSON 翻译文件
          </EmptyState>
        ) : (
          locales!.map(locale => {
            const isActive = locale === draft.locale
            const armed = armedDelete === locale
            return (
              <div
                key={locale}
                className={cn(
                  'group/locale flex items-center gap-3 px-4 py-3',
                  'transition-colors duration-150 hover:bg-hover/30'
                )}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold',
                    'transition-colors duration-150',
                    isActive ? 'bg-accent text-white shadow-xs' : 'bg-inset text-fg-subtle border border-line'
                  )}
                >
                  {locale.slice(0, 2).toUpperCase()}
                </span>

                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-mono text-[12.5px] font-medium text-fg">{locale}</span>
                  {isActive ? <Badge tone="accent">使用中</Badge> : null}
                </div>

                <div
                  className={cn(
                    'flex items-center gap-1 transition-opacity duration-150',
                    armed
                      ? 'opacity-100'
                      : 'opacity-65 group-focus-within/locale:opacity-100 group-hover/locale:opacity-100'
                  )}
                >
                  {!isActive ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => activate(locale)}
                      className="opacity-0 transition-opacity duration-150 group-focus-within/locale:opacity-100 group-hover/locale:opacity-100"
                    >
                      <Check />
                      设为当前
                    </Button>
                  ) : null}
                  <Tooltip content="导出 JSON">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`导出 ${locale}`}
                      onClick={() => exportLocale(locale)}
                    >
                      <Download className="size-4" />
                    </Button>
                  </Tooltip>
                  {armed ? (
                    <Button
                      size="xs"
                      variant="danger-solid"
                      onClick={() => remove(locale)}
                      className="animate-fade-in"
                    >
                      确认删除
                    </Button>
                  ) : (
                    <Tooltip content="删除">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`删除 ${locale}`}
                        className="hover:bg-danger-soft hover:text-danger"
                        onClick={() => remove(locale)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
            )
          })
        )}
      </SettingSection>

      <SettingSection title="新建" description="创建一个空白语言包，之后在语言包目录里编辑">
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          <InputGroup
            className="w-64"
            placeholder="语言代码，如 en-US"
            spellCheck={false}
            autoComplete="off"
            value={newName}
            onChange={event => setNewName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void create()
              }
            }}
            leading={<Plus className="size-4" />}
          />
          <Button size="md" variant="secondary" onClick={create} disabled={newName.trim() === ''}>
            新建
          </Button>
        </div>
      </SettingSection>
    </>
  )
}
