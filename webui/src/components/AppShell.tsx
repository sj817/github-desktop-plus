import { ReactNode } from 'react'
import { TopBar } from './TopBar'

interface Props {
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
}

export function AppShell({ title, subtitle, children, actions }: Props) {
  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Ambient aurora orbs (decorative) */}
      <div className="aurora-orb h-[420px] w-[420px] -left-32 top-[-120px] bg-[radial-gradient(circle,var(--brand-glow),transparent_60%)]" />
      <div className="aurora-orb h-[360px] w-[360px] right-[-100px] top-[40%] bg-[radial-gradient(circle,var(--accent-soft),transparent_60%)]" />

      <main className="relative z-10 flex-1 overflow-hidden">
        <div className="flex h-full flex-col">
          <TopBar title={title} subtitle={subtitle} />
          {actions && <div className="px-8 pb-3">{actions}</div>}
          <div className="flex-1 overflow-auto px-8 pb-8 pt-2">{children}</div>
        </div>
      </main>
    </div>
  )
}
