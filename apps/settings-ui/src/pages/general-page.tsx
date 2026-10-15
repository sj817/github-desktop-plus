import { useEffect, useState } from 'react'
import { Activity, Monitor, ShieldCheck, Sparkles } from 'lucide-react'
import { useBridge } from '@/bridge/context'
import { PageHeader, SettingField, SettingItem, SettingSection } from '@/components/settings/section'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/lib/settings-store'

const LOG_LEVELS = [
  { value: '', label: '默认' }, { value: 'debug', label: 'Debug' }, { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' }, { value: 'error', label: 'Error' },
] as const

export function GeneralPage() {
  const { draft, update } = useSettings()
  const bridge = useBridge()
  const [locales, setLocales] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    bridge.invoke('gdp:list-locales').then(list => { if (!cancelled) setLocales(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [bridge])
  const localeOptions = Array.from(new Set([draft.locale, ...locales])).map(locale => ({ value: locale, label: locale }))

  return (
    <>
      <PageHeader title="常规" description="配置界面语言、仓库列表和隐私偏好。" />
      <div className="settings-grid">
        <SettingSection title="界面偏好" description="设置翻译语言和最近使用的仓库。" icon={<Monitor />}>
          <SettingItem title="界面翻译" description="使用语言包翻译 GitHub Desktop 的界面文本。">
            <Switch aria-label="界面翻译" checked={draft.i18nEnabled} onCheckedChange={checked => update(prev => ({ ...prev, i18nEnabled: checked }))} />
          </SettingItem>
          <SettingItem title="语言包" description="更多翻译可在「语言包」中管理。">
            <Select aria-label="语言包" value={draft.locale} options={localeOptions} onValueChange={locale => update(prev => ({ ...prev, locale }))} />
          </SettingItem>
          <SettingItem title="最近仓库数量" description="仓库切换菜单中保留的最近使用记录。">
            <div className="setting-range">
              <Slider aria-label="最近仓库数量" min={1} max={30} value={draft.recentReposLimit} onValueChange={value => update(prev => ({ ...prev, recentReposLimit: value }))} />
              <output className="setting-value" aria-label="最近仓库数量值">{draft.recentReposLimit}</output>
            </div>
          </SettingItem>
        </SettingSection>
        <SettingSection title="隐私与更新" description="自行决定版本更新和数据上报。" icon={<ShieldCheck />}>
          <SettingItem title="禁用官方更新" description="阻止自动更新与手动检查，保留当前 GitHub Desktop 版本。">
            <Switch aria-label="禁用官方更新" checked={draft.blockUpdates} onCheckedChange={checked => update(prev => ({ ...prev, blockUpdates: checked }))} />
          </SettingItem>
          <SettingItem title="拦截遥测" description="阻止向 GitHub 发送使用数据与统计信息。">
            <Switch aria-label="拦截遥测" checked={draft.blockTelemetry} onCheckedChange={checked => update(prev => ({ ...prev, blockTelemetry: checked }))} />
          </SettingItem>
        </SettingSection>
        <SettingSection title="Copilot" description="使用官方提交框中的自定义模型入口。" icon={<Sparkles />}>
          <SettingItem title="解锁提交信息生成" description="启用自定义提供方入口；修改后需重启 GitHub Desktop。">
            <Switch aria-label="解锁提交信息生成" checked={draft.unlockCopilot} onCheckedChange={checked => update(prev => ({ ...prev, unlockCopilot: checked }))} />
          </SettingItem>
          <p className="setting-description">GitHub 自家模型仍需有效订阅。自定义模型也可在「AI 提交」中单独配置。</p>
        </SettingSection>
        <SettingSection title="诊断与排错" description="按需记录运行信息，便于排查问题。" icon={<Activity />}>
          <SettingField label="日志级别" hint="默认使用应用的常规记录级别；Debug 会记录更多细节。">
            <Segmented aria-label="日志级别" value={draft.logLevel} options={LOG_LEVELS} onValueChange={logLevel => update(prev => ({ ...prev, logLevel }))} />
          </SettingField>
        </SettingSection>
      </div>
    </>
  )
}
