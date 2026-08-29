import { useEffect, useState } from 'react'
import { Activity, Monitor, ShieldCheck, Sparkles } from 'lucide-react'
import { useBridge } from '@/bridge/context'
import { SettingItem, SettingSection } from '@/components/settings/section'
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
      <SettingSection
        title={
          <span className="flex items-center gap-1.5">
            <Monitor className="size-3.5 text-accent" />
            <span>界面偏好</span>
          </span>
        }
      >
        <SettingItem
          title="界面翻译"
          description="用选中的语言包翻译界面文本，保存后界面自动刷新"
        >
          <Switch
            checked={draft.i18nEnabled}
            onCheckedChange={checked => update(prev => ({ ...prev, i18nEnabled: checked }))}
          />
        </SettingItem>

        <SettingItem title="语言包" description="可在「语言包」页导入或新建">
          <Select
            aria-label="语言包"
            className="w-40"
            value={draft.locale}
            options={localeOptions}
            onValueChange={locale => update(prev => ({ ...prev, locale }))}
          />
        </SettingItem>

        <SettingItem title="最近仓库数量" description="导航栏下拉列表中显示的条数">
          <div className="flex w-56 items-center gap-3 @max-[620px]:w-36">
            <Slider
              aria-label="最近仓库数量"
              min={1}
              max={30}
              value={draft.recentReposLimit}
              onValueChange={value => update(prev => ({ ...prev, recentReposLimit: value }))}
            />
            <span className="w-8 shrink-0 rounded-lg bg-inset border border-line/60 py-0.5 text-center font-mono text-[11.5px] font-medium text-fg tabular-nums select-none">
              {draft.recentReposLimit}
            </span>
          </div>
        </SettingItem>
      </SettingSection>

      <SettingSection
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-purple-600 dark:text-purple-400" />
            <span>Copilot</span>
          </span>
        }
      >
        <SettingItem
          title="解锁提交信息生成"
          description="改写 GitHub Desktop 的订阅判断，让「选项 → Copilot → 提供方」里配置的自定义端点可用。不会解锁 GitHub 自家模型（由服务端鉴权）。改动后需重启生效"
        >
          <Switch
            checked={draft.unlockCopilot}
            onCheckedChange={checked => update(prev => ({ ...prev, unlockCopilot: checked }))}
          />
        </SettingItem>
      </SettingSection>

      <SettingSection
        title={
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-green-600 dark:text-green-400" />
            <span>隐私与更新</span>
          </span>
        }
      >
        <SettingItem
          title="禁用更新"
          description="阻止自动更新与手动检查更新，保持当前已打补丁的版本"
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

      <SettingSection
        title={
          <span className="flex items-center gap-1.5">
            <Activity className="size-3.5 text-blue-600 dark:text-blue-400" />
            <span>诊断与排错</span>
          </span>
        }
      >
        <SettingItem title="日志级别" description="选择控制台和日志文件记录的详细程度">
          <Segmented
            size="sm"
            value={draft.logLevel}
            options={LOG_LEVELS}
            onValueChange={logLevel => update(prev => ({ ...prev, logLevel }))}
          />
        </SettingItem>
      </SettingSection>
    </>
  )
}
