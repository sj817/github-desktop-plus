import {
  Check,
  Download,
  FolderOpen,
  FolderPlus,
  Languages,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import * as Flags from 'country-flag-icons/react/3x2'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBridge } from '@/bridge/context'
import { EmptyState, Note, SettingItem, SettingSection } from '@/components/settings/section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
      <section className="mb-6 space-y-2.5">
        <header className="flex items-center justify-between gap-3 px-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] leading-5 font-semibold text-fg tracking-normal flex items-center gap-1.5">
              <Languages className="size-3.5 text-amber-600 dark:text-amber-400" />
              <span>已安装语言包</span>
            </h2>
            {count > 0 ? (
              <span className="rounded-full bg-inset px-2 py-0.5 font-mono text-[11px] text-fg-subtle border border-line/60">
                {count}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
              <Upload className="size-3.5" />
              导入 JSON
            </Button>
            <Tooltip content="在文件管理器中打开语言包目录">
              <Button
                size="sm"
                variant="secondary"
                aria-label="打开语言包目录"
                onClick={() => {
                  void bridge.invoke('gdp:open-locales-dir')
                }}
              >
                <FolderOpen className="size-3.5" />
                打开目录
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
          </div>
        </header>

        {locales === null ? (
          <div className="space-y-2">
            {[0, 1].map(row => (
              <div key={row} className="flex items-center gap-3 rounded-xl border border-line/70 bg-elevated px-3.5 py-3">
                <div className="gdp-skeleton h-4.5 w-6.5 rounded-[2px]" />
                <div className="gdp-skeleton h-3.5 w-24 rounded" />
              </div>
            ))}
          </div>
        ) : count === 0 ? (
          <div className="rounded-2xl border border-line/70 bg-elevated shadow-xs overflow-hidden">
            <EmptyState icon={<Languages className="size-5 text-amber-600 dark:text-amber-400" />} title="还没有语言包">
              新建一个空白语言包，或点击上方「导入 JSON」添加已有翻译文件
            </EmptyState>
          </div>
        ) : (
          <div className="space-y-2">
            {locales!.map(locale => {
              const isActive = locale === draft.locale
              const armed = armedDelete === locale
              const displayName = getLocaleDisplayName(locale)

              return (
                <div
                  key={locale}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border border-line/70 bg-elevated px-3.5 py-2.5 transition-all duration-150',
                    isActive ? 'border-accent/40 bg-accent-soft/10' : 'hover:border-line-strong'
                  )}
                >
                  {/* 国家/地区国旗图标 */}
                  <LocaleFlag locale={locale} />

                  {/* 语言名称与语言代码 */}
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="text-[13px] font-medium text-fg">{displayName}</span>
                    <span className="font-mono text-[11.5px] text-fg-subtle">({locale})</span>
                    {isActive ? <Badge tone="accent">使用中</Badge> : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!isActive ? (
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => activate(locale)}
                      >
                        <Check className="size-3.5 text-green-600 dark:text-green-400" />
                        设为当前
                      </Button>
                    ) : null}

                    <Tooltip content="导出 JSON 文件">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`导出 ${locale}`}
                        className="size-7 rounded-md text-fg-subtle hover:text-fg hover:bg-hover"
                        onClick={() => exportLocale(locale)}
                      >
                        <Download className="size-3.5" />
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
                      <Tooltip content="删除语言包">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`删除 ${locale}`}
                          className="size-7 rounded-md text-fg-subtle hover:bg-danger-soft hover:text-danger"
                          onClick={() => remove(locale)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <SettingSection
        title={
          <span className="flex items-center gap-1.5">
            <FolderPlus className="size-3.5 text-amber-600 dark:text-amber-400" />
            <span>新建语言包</span>
          </span>
        }
      >
        <SettingItem
          title="语言代码"
          description="例如 ja-JP、fr-FR、de-DE"
        >
          <div className="flex items-center gap-2">
            <Input
              className="h-8 w-36 font-mono text-[12px] bg-field border-line/60"
              placeholder="如 ja-JP"
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
            />
            <Button size="sm" variant="secondary" onClick={create} disabled={newName.trim() === ''}>
              <Plus className="size-3.5" />
              新建
            </Button>
          </div>
        </SettingItem>
      </SettingSection>

      <div className="px-1">
        <Note tone="neutral">
          语言包文件存放在本机的 <code className="rounded bg-inset px-1 font-mono text-[11px] border border-line/60">locales</code> 目录下，编辑 JSON 文件后即时热生效。
        </Note>
      </div>
    </>
  )
}

function getCountryCodeForLocale(locale: string): string | null {
  const parts = locale.split(/[-_]/)
  if (parts.length >= 2) {
    const region = parts[parts.length - 1].toUpperCase()
    if (/^[A-Z]{2}$/.test(region)) {
      return region
    }
  }
  const lang = parts[0].toLowerCase()
  const map: Record<string, string> = {
    zh: 'CN',
    en: 'US',
    ja: 'JP',
    ko: 'KR',
    ru: 'RU',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
    it: 'IT',
    pt: 'BR',
    uk: 'UA',
    pl: 'PL',
    nl: 'NL',
    tr: 'TR',
    vi: 'VN',
    th: 'TH',
    id: 'ID',
    ar: 'SA',
    hi: 'IN',
  }
  return map[lang] ?? null
}

function getLocaleDisplayName(locale: string): string {
  const map: Record<string, string> = {
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文（台湾）',
    'zh-HK': '繁體中文（香港）',
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'ja-JP': '日本語',
    'ko-KR': '한국어',
    'ru-RU': 'Русский',
    'fr-FR': 'Français',
    'de-DE': 'Deutsch',
    'es-ES': 'Español',
    'pt-BR': 'Português (Brasil)',
    'it-IT': 'Italiano',
  }
  if (map[locale]) return map[locale]
  try {
    const intl = new Intl.DisplayNames(['zh-CN'], { type: 'language' })
    const name = intl.of(locale)
    if (name && name !== locale) return name
  } catch {
    // fallback
  }
  return locale
}

function LocaleFlag({ locale }: { locale: string }) {
  const code = getCountryCodeForLocale(locale)
  const FlagComponent =
    code && code in Flags
      ? (Flags as unknown as Record<string, React.ComponentType<{ className?: string }>>)[code]
      : null

  if (FlagComponent) {
    return (
      <div className="flex h-4.5 w-6.5 shrink-0 items-center justify-center overflow-hidden rounded-[2px] border border-line/60 bg-inset">
        <FlagComponent className="h-full w-full object-cover" />
      </div>
    )
  }

  return (
    <div className="flex h-4.5 w-6.5 shrink-0 items-center justify-center rounded-[2px] border border-line/60 bg-inset text-[10px] font-bold text-fg-subtle">
      {locale.slice(0, 2).toUpperCase()}
    </div>
  )
}
