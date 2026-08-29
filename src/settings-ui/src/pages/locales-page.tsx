import { Download, FolderOpen, Globe, Plus, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBridge } from '@/bridge/context'
import { Badge, EmptyState, SettingSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useSettings } from '@/lib/settings-store'

export function LocalesPage() {
  const bridge = useBridge()
  const toast = useToast()
  const { draft } = useSettings()

  const [locales, setLocales] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  // Deleting takes two clicks: the first arms the button for a few seconds.
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setLocales(await bridge.invoke('gdp:list-locales'))
    } catch (error) {
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

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Input
          className="max-w-56"
          placeholder="新语言包名，如 en-US"
          spellCheck={false}
          value={newName}
          onChange={event => setNewName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void create()
            }
          }}
        />
        <Button size="sm" onClick={create} disabled={newName.trim() === ''}>
          <Plus />
          新建
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => fileInput.current?.click()}>
          <Upload />
          导入 JSON
        </Button>
        <Button
          size="sm"
          title="在文件管理器中打开语言包目录"
          onClick={() => {
            void bridge.invoke('gdp:open-locales-dir')
          }}
        >
          <FolderOpen />
          打开目录
        </Button>
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
      </div>

      <SettingSection title="已安装" hint={`${locales.length} 个语言包`}>
        {locales.length === 0 ? (
          <EmptyState icon={<Globe className="size-6" />}>
            暂无语言包 — 新建或导入一个开始翻译
          </EmptyState>
        ) : (
          locales.map(locale => (
            <div key={locale} className="flex items-center gap-2.5 px-3.5 py-2.5">
              <Globe className="size-4 text-fg-subtle" />
              <span className="text-[13px] font-medium">{locale}</span>
              {locale === draft.locale ? <Badge tone="accent">使用中</Badge> : null}
              <div className="flex-1" />
              <Button size="sm" onClick={() => exportLocale(locale)}>
                <Download />
                导出
              </Button>
              <Button
                size="sm"
                variant={armedDelete === locale ? 'danger' : 'secondary'}
                onClick={() => remove(locale)}
              >
                {armedDelete === locale ? (
                  '确认删除？'
                ) : (
                  <>
                    <Trash2 />
                    删除
                  </>
                )}
              </Button>
            </div>
          ))
        )}
      </SettingSection>
    </>
  )
}
