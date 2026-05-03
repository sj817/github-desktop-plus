import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HeroUIProvider } from '@heroui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Locales from '@/pages/Locales'
import Logs from '@/pages/Logs'
import Settings from '@/pages/Settings'
import { useAuth } from '@/stores/auth'
import { Button } from '@heroui/react'
import { Icons } from '@/components/icons'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
})

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden px-6">
      <div className="aurora-orb h-[520px] w-[520px] -left-24 -top-32 bg-[radial-gradient(circle,var(--brand-glow),transparent_60%)]" />
      <div className="aurora-orb h-[440px] w-[440px] -right-20 -bottom-24 bg-[radial-gradient(circle,var(--accent-soft),transparent_60%)]" />
      {children}
    </div>
  )
}

function Pending() {
  return (
    <GateShell>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass flex items-center gap-3 px-7 py-5"
      >
        <span className="relative inline-flex h-2.5 w-2.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary-500/60" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-primary-500" />
        </span>
        <span className="text-[13.5px] text-default-500">正在建立会话…</span>
      </motion.div>
    </GateShell>
  )
}

function Unauth({ error }: { error?: string }) {
  const expired = error === 'invalid_token' || error === 'token_expired'
  return (
    <GateShell>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass max-w-[440px] p-9 text-center"
      >
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary-500/25 to-[color:var(--accent-soft)] ring-1 ring-inset ring-white/10 shadow-[0_8px_28px_var(--brand-glow)]">
          <Icons.Shield className="h-6 w-6 text-primary-500" />
        </div>
        <div className="title-grad mb-2 text-[26px] font-bold">会话未建立</div>
        <p className="mb-7 text-[13.5px] leading-relaxed text-default-500">
          {expired
            ? '链接已失效。请回到 GitHub Desktop 的 GDP 菜单重新打开。'
            : '请通过 GitHub Desktop 中的 GDP 菜单（或快捷键 Ctrl+Alt+G）打开本控制台。'}
        </p>
        <div className="flex items-center justify-center gap-2.5">
          <Button color="primary" radius="full" onPress={() => location.reload()} className="px-6 shadow-[0_6px_22px_var(--brand-glow)]">
            重试
          </Button>
          <Button variant="flat" radius="full" onPress={() => window.open('https://github.com/nicexipi/github-desktop-plus', '_blank')}>
            了解 GDP
          </Button>
        </div>
        <div className="eyebrow mt-7 flex items-center justify-center gap-2 opacity-70">
          <Icons.Dot className="h-3 w-3" />
          GitHub Desktop Plus
        </div>
      </motion.div>
    </GateShell>
  )
}

function Gate({ children }: { children: React.ReactNode }) {
  const { status, bootstrap, error } = useAuth()
  useEffect(() => { void bootstrap() }, [bootstrap])

  if (status === 'pending') return <Pending />
  if (status !== 'ok') return <Unauth error={error} />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <HeroUIProvider>
        <BrowserRouter>
          <Gate>
            <Routes>
              <Route path="/" element={<Navigate to="/settings" replace />} />
              <Route path="/locales" element={<Locales />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Gate>
        </BrowserRouter>
      </HeroUIProvider>
    </QueryClientProvider>
  )
}
