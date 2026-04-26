import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

interface Props {
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
}

export function AppShell({ title, subtitle, children, actions }: Props) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col">
          <TopBar title={title} subtitle={subtitle} />
          {actions && <div className="px-8 pb-4">{actions}</div>}
          <div className="flex-1 overflow-auto px-8 pb-8 pt-2">{children}</div>
        </div>
      </main>
    </div>
  )
}
