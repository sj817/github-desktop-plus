import { useEffect, useState } from 'react'
import { Button, Input, Switch } from '@heroui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Status, type AppConfig } from '@/api/client'
import { AppShell } from '@/components/AppShell'
import { GlassCard } from '@/components/GlassCard'

export default function SettingsPage() {
  const qc = useQueryClient()
  const cfg = useQuery<AppConfig>({ queryKey: ['cfg'], queryFn: Status.config })
  const [draft, setDraft] = useState<AppConfig | null>(null)
  useEffect(() => { if (cfg.data) setDraft(cfg.data) }, [cfg.data])

  const save = useMutation({
    mutationFn: (c: AppConfig) => Status.saveConfig(c),
    onSuccess: (saved) => {
      qc.setQueryData(['cfg'], saved)
      setDraft(saved)
      void qc.invalidateQueries({ queryKey: ['cfg'] })
    },
  })

  if (!draft) return <AppShell title="设置"><div /></AppShell>

  const update = (patch: Partial<AppConfig>) => setDraft({ ...draft, ...patch })

  return (
    <AppShell title="设置" subtitle="配置改动会保存到 config.json，部分需重启 GitHub Desktop 生效">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <GlassCard>
          <h3 className="mb-4 text-[15px] font-semibold">更新拦截</h3>
          <Row label="禁用自动更新">
            <Switch
              isSelected={draft.updates.disabled}
              onValueChange={(v) => update({ updates: { ...draft.updates, disabled: v } })}
            />
          </Row>
          <Row label="拦截手动检查更新按钮">
            <Switch
              isSelected={draft.updates.block_manual_check}
              onValueChange={(v) => update({ updates: { ...draft.updates, block_manual_check: v } })}
            />
          </Row>
        </GlassCard>

        <GlassCard delay={0.05}>
          <h3 className="mb-4 text-[15px] font-semibold">遥测</h3>
          <Row label="禁用统计上报">
            <Switch
              isSelected={draft.telemetry.disabled}
              onValueChange={(v) => update({ telemetry: { ...draft.telemetry, disabled: v } })}
            />
          </Row>
          <Row label="拦截异常上报">
            <Switch
              isSelected={draft.telemetry.block_exceptions}
              onValueChange={(v) => update({ telemetry: { ...draft.telemetry, block_exceptions: v } })}
            />
          </Row>
        </GlassCard>

        <GlassCard delay={0.1}>
          <h3 className="mb-4 text-[15px] font-semibold">日志</h3>
          <Row label="日志级别">
            <select
              value={draft.logging.level}
              onChange={(e) => update({ logging: { ...draft.logging, level: e.target.value } })}
              className="rounded-lg border border-divider bg-content2/40 px-3 py-1.5 text-[13px] outline-none focus:border-primary-500"
            >
              {['debug', 'info', 'warn', 'error'].map((lv) => (
                <option key={lv} value={lv}>{lv}</option>
              ))}
            </select>
          </Row>
          <Row label="禁用文件日志">
            <Switch
              isSelected={draft.logging.disable_file_log}
              onValueChange={(v) => update({ logging: { ...draft.logging, disable_file_log: v } })}
            />
          </Row>
        </GlassCard>

        <GlassCard delay={0.15}>
          <h3 className="mb-4 text-[15px] font-semibold">界面</h3>
          <Row label="启用中文界面">
            <Switch
              isSelected={draft.i18n.enabled}
              onValueChange={(v) => update({ i18n: { ...draft.i18n, enabled: v } })}
            />
          </Row>
          <Row label="语言">
            <Input
              size="sm"
              variant="bordered"
              value={draft.i18n.locale}
              onValueChange={(v) => update({ i18n: { ...draft.i18n, locale: v } })}
              className="w-32"
            />
          </Row>
          <Row label="最近仓库数量">
            <Input
              size="sm"
              type="number"
              variant="bordered"
              value={String(draft.ui.recent_repos_limit)}
              onValueChange={(v) => update({ ui: { ...draft.ui, recent_repos_limit: Math.max(1, +v || 3) } })}
              className="w-24"
            />
          </Row>
        </GlassCard>

        <div className="xl:col-span-2 flex items-center justify-end gap-4">
          {save.isSuccess && (
            <span className="text-[12.5px] text-success-500">已保存，最近仓库数量会自动同步</span>
          )}
          {save.isError && (
            <span className="text-[12.5px] text-danger-500">
              保存失败：{save.error instanceof Error ? save.error.message : 'unknown'}
            </span>
          )}
          <Button
            color="primary"
            radius="full"
            isLoading={save.isPending}
            onPress={() => save.mutate(draft)}
            className="px-8 shadow-glow-sm"
          >
            保存配置
          </Button>
        </div>
      </div>
    </AppShell>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-divider/30 py-3 last:border-b-0">
      <span className="text-[13.5px] text-default-600">{label}</span>
      {children}
    </div>
  )
}
