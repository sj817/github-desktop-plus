import { useQuery } from '@tanstack/react-query'
import { Status, type RuntimePlan, type DetectResponse, type AppConfig } from '@/api/client'
import { AppShell } from '@/components/AppShell'
import { GlassCard } from '@/components/GlassCard'
import { Chip, Tooltip } from '@heroui/react'
import { Icons } from '@/components/icons'
import { motion } from 'framer-motion'

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>
}

function Stat({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow !text-[10px]">{label}</span>
      <span className={[mono ? 'font-mono' : '', 'text-[14.5px] font-semibold text-foreground/90'].join(' ')}>{value}</span>
    </div>
  )
}

function HeroCard({
  Icon,
  eyebrow,
  title,
  chip,
  chipColor = 'primary',
  children,
  delay = 0,
  className = '',
}: {
  Icon: (typeof Icons)[keyof typeof Icons]
  eyebrow: string
  title: string
  chip?: string
  chipColor?: 'primary' | 'success' | 'warning' | 'danger' | 'default'
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <GlassCard delay={delay} className={['relative overflow-hidden', className].join(' ')}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-500/12 text-primary-500 ring-1 ring-inset ring-white/10">
            <Icon className="h-[17px] w-[17px]" />
          </div>
          <div className="min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <div className="mt-1 truncate text-[15px] font-semibold">{title}</div>
          </div>
        </div>
        {chip && (
          <Chip
            size="sm"
            radius="full"
            variant="flat"
            color={chipColor}
            className="font-medium"
          >
            {chip}
          </Chip>
        )}
      </div>
      {children}
    </GlassCard>
  )
}

export default function Dashboard() {
  const plan = useQuery<RuntimePlan>({ queryKey: ['plan'], queryFn: Status.plan })
  const detect = useQuery<DetectResponse>({ queryKey: ['detect'], queryFn: Status.detect })
  const cfg = useQuery<AppConfig>({ queryKey: ['cfg'], queryFn: Status.config })

  const desktopOk = !!detect.data?.found
  const i18nOn = !!cfg.data?.i18n.enabled
  const updatesBlocked = !!cfg.data?.updates.disabled
  const telemetryBlocked = !!cfg.data?.telemetry.disabled

  return (
    <AppShell
      title="仪表盘"
      subtitle="GitHub Desktop Plus · 控制中心运行状态一览"
    >
      {/* Top quick-status strip */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-5 flex flex-wrap items-center gap-2.5 rounded-2xl border border-white/5 bg-content2/30 px-4 py-3 backdrop-blur"
      >
        <Eyebrow>实时状态</Eyebrow>
        <span className="mx-1 text-default-300">|</span>
        <StatusPill ok={desktopOk} okLabel="GitHub Desktop 已检测" failLabel="GitHub Desktop 未检测" />
        <StatusPill ok={i18nOn} okLabel="中文界面已启用" failLabel="中文界面已关闭" />
        <StatusPill ok={updatesBlocked} okLabel="更新已拦截" failLabel="更新未拦截" />
        <StatusPill ok={telemetryBlocked} okLabel="遥测已拦截" failLabel="遥测未拦截" />
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-default-400">
          <Icons.Activity className="h-3.5 w-3.5" />
          目标 &lt; {plan.data?.memory_target_mb ?? '—'} MB
        </span>
      </motion.div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <HeroCard
          Icon={Icons.Monitor}
          eyebrow="Desktop"
          title="GitHub Desktop"
          chip={desktopOk ? '已检测' : '未检测'}
          chipColor={desktopOk ? 'success' : 'warning'}
          delay={0.05}
        >
          <Tooltip content={detect.data?.path || '—'} placement="bottom" delay={300}>
            <div className="truncate font-mono text-[12px] text-default-500">
              {detect.data?.path || '—'}
            </div>
          </Tooltip>
        </HeroCard>

        <HeroCard
          Icon={Icons.Globe}
          eyebrow="i18n"
          title="中文界面"
          chip={i18nOn ? '已启用' : '已关闭'}
          chipColor={i18nOn ? 'primary' : 'default'}
          delay={0.1}
        >
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Locale" value={cfg.data?.i18n.locale || '—'} />
            <Stat label="日志级别" value={cfg.data?.logging.level || '—'} />
          </div>
        </HeroCard>

        <HeroCard
          Icon={Icons.Server}
          eyebrow="Runtime"
          title="运行时"
          chip={`< ${plan.data?.memory_target_mb ?? '—'} MB`}
          chipColor="primary"
          delay={0.15}
        >
          <div className="space-y-1.5 text-[13px] text-default-500">
            <Row k="core" v={plan.data?.runtime} />
            <Row k="web"  v={plan.data?.web_boundary} />
            <Row k="ui"   v={plan.data?.ui_strategy} />
          </div>
        </HeroCard>

        <GlassCard delay={0.22} className="md:col-span-2 xl:col-span-3">
          <div className="mb-4 flex items-center gap-2">
            <Icons.Spark className="h-4 w-4 text-primary-500" />
            <Eyebrow>设计原则</Eyebrow>
          </div>
          <ul className="grid grid-cols-1 gap-3 text-[13.5px] text-default-600 md:grid-cols-2">
            {(plan.data?.notes ?? []).map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500/70 shadow-[0_0_6px_var(--brand-glow)]" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>
    </AppShell>
  )
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-default-400">{k}</span>
      <span className="text-default-600">{v || '—'}</span>
    </div>
  )
}

function StatusPill({ ok, okLabel, failLabel }: { ok: boolean; okLabel: string; failLabel: string }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]',
        ok
          ? 'bg-emerald-500/10 text-emerald-500 ring-1 ring-inset ring-emerald-500/25'
          : 'bg-amber-500/10 text-amber-500 ring-1 ring-inset ring-amber-500/25',
      ].join(' ')}
    >
      {ok ? <Icons.Ok className="h-3 w-3" /> : <Icons.Warn className="h-3 w-3" />}
      {ok ? okLabel : failLabel}
    </span>
  )
}
