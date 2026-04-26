import { useQuery } from '@tanstack/react-query'
import { Status, type RuntimePlan, type DetectResponse, type AppConfig } from '@/api/client'
import { AppShell } from '@/components/AppShell'
import { GlassCard } from '@/components/GlassCard'
import { Chip } from '@heroui/react'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.18em] text-default-400">{label}</span>
      <span className="font-mono text-[18px] font-semibold text-foreground/90">{value}</span>
      {hint && <span className="text-[12px] text-default-500">{hint}</span>}
    </div>
  )
}

export default function Dashboard() {
  const plan = useQuery<RuntimePlan>({ queryKey: ['plan'], queryFn: Status.plan })
  const detect = useQuery<DetectResponse>({ queryKey: ['detect'], queryFn: Status.detect })
  const cfg = useQuery<AppConfig>({ queryKey: ['cfg'], queryFn: Status.config })

  const desktopOk = detect.data?.found
  const i18nOn = cfg.data?.i18n.enabled

  return (
    <AppShell
      title="仪表盘"
      subtitle="GitHub Desktop Plus · 控制中心运行状态一览"
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <GlassCard delay={0.05}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-default-400">Desktop</div>
              <div className="mt-1 text-[16px] font-semibold">GitHub Desktop</div>
            </div>
            <Chip
              size="sm"
              radius="full"
              variant="flat"
              color={desktopOk ? 'success' : 'warning'}
              className="font-medium"
            >
              {desktopOk ? '已检测' : '未检测'}
            </Chip>
          </div>
          <div className="text-[12px] text-default-500 break-all font-mono">
            {detect.data?.path || '—'}
          </div>
        </GlassCard>

        <GlassCard delay={0.1}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-default-400">i18n</div>
              <div className="mt-1 text-[16px] font-semibold">中文界面</div>
            </div>
            <Chip
              size="sm"
              radius="full"
              variant="flat"
              color={i18nOn ? 'primary' : 'default'}
            >
              {i18nOn ? '已启用' : '已关闭'}
            </Chip>
          </div>
          <div className="flex gap-6">
            <Stat label="Locale" value={cfg.data?.i18n.locale || '—'} />
            <Stat label="日志级别" value={cfg.data?.logging.level || '—'} />
          </div>
        </GlassCard>

        <GlassCard delay={0.15}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-default-400">Runtime</div>
              <div className="mt-1 text-[16px] font-semibold">运行时</div>
            </div>
            <Chip size="sm" radius="full" variant="flat" color="primary">
              &lt; {plan.data?.memory_target_mb ?? '—'} MB
            </Chip>
          </div>
          <div className="space-y-2 text-[13px] text-default-500">
            <div><span className="text-default-400">core</span> · {plan.data?.runtime}</div>
            <div><span className="text-default-400">web</span> · {plan.data?.web_boundary}</div>
            <div><span className="text-default-400">ui</span> · {plan.data?.ui_strategy}</div>
          </div>
        </GlassCard>

        <GlassCard delay={0.2} className="md:col-span-2 xl:col-span-3">
          <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-default-400">设计原则</div>
          <ul className="grid grid-cols-1 gap-3 text-[13.5px] text-default-600 md:grid-cols-2">
            {(plan.data?.notes ?? []).map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-primary-500/70" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>
    </AppShell>
  )
}
