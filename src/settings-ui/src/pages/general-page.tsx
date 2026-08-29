import { useEffect, useState } from 'react'
import { useBridge } from '@/bridge/context'
import { SettingField, SettingItem, SettingSection } from '@/components/settings/section'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/lib/settings-store'

const LOG_LEVELS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '默认' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
]

export function GeneralPage() {
  const { draft, update } = useSettings()
  const bridge = useBridge()
  const [locales, setLocales] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    bridge
      .invoke('gdp:list-locales')
      .then(list => {
        if (!cancelled) setLocales(list)
      })
      .catch(() => {
        /* the current value stays selectable on its own */
      })
    return () => {
      cancelled = true
    }
  }, [bridge])

  // The configured locale is always offered, even if its file is missing, so
  // opening the dialog can never silently switch the language.
  const localeOptions = (locales.includes(draft.locale) ? locales : [draft.locale, ...locales]).map(
    locale => ({ value: locale, label: locale })
  )

  return (
    <>
      <SettingSection title="界面">
        <SettingItem
          title="界面翻译"
          description="用下方选中的语言包翻译界面文本，保存后界面自动刷新"
        >
          <Switch
            checked={draft.i18nEnabled}
            onCheckedChange={checked => update(prev => ({ ...prev, i18nEnabled: checked }))}
          />
        </SettingItem>

        <SettingItem title="语言包" description="从「语言包」页导入或新建后可在此切换">
          <Select
            aria-label="语言包"
            className="w-44"
            value={draft.locale}
            options={localeOptions}
            onValueChange={locale => update(prev => ({ ...prev, locale }))}
          />
        </SettingItem>

        <SettingField label="最近仓库显示数量" hint="导航栏下拉列表中的条数">
          <div className="flex items-center gap-3">
            <Slider
              aria-label="最近仓库显示数量"
              className="max-w-80"
              min={1}
              max={30}
              value={draft.recentReposLimit}
              onValueChange={value => update(prev => ({ ...prev, recentReposLimit: value }))}
            />
            <span className="w-8 shrink-0 rounded bg-surface px-1.5 py-0.5 text-center font-mono text-[12px] text-fg-muted tabular-nums">
              {draft.recentReposLimit}
            </span>
          </div>
        </SettingField>
      </SettingSection>

      <SettingSection title="Copilot">
        <SettingItem
          title="解锁提交信息生成"
          description="改写 GitHub Desktop 的订阅判断，让「选项 → Copilot → 提供方」里配置的自定义端点可用。不会解锁 GitHub 自家模型（那部分由服务端鉴权）。改动后需重启生效"
        >
          <Switch
            checked={draft.unlockCopilot}
            onCheckedChange={checked => update(prev => ({ ...prev, unlockCopilot: checked }))}
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="隐私与更新">
        <SettingItem
          title="禁用更新"
          description="阻止自动更新和手动检查更新，保持当前打了补丁的版本"
        >
          <Switch
            checked={draft.blockUpdates}
            onCheckedChange={checked => update(prev => ({ ...prev, blockUpdates: checked }))}
          />
        </SettingItem>
        <SettingItem title="拦截遥测" description="不向 GitHub 上报使用数据与统计信息">
          <Switch
            checked={draft.blockTelemetry}
            onCheckedChange={checked => update(prev => ({ ...prev, blockTelemetry: checked }))}
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="高级">
        <SettingItem title="日志级别" description="默认等同于 warn，仅记录警告与错误">
          <Segmented
            value={draft.logLevel}
            options={LOG_LEVELS}
            onValueChange={logLevel => update(prev => ({ ...prev, logLevel }))}
          />
        </SettingItem>
      </SettingSection>
    </>
  )
}
