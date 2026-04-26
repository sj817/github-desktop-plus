import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HeroUIProvider } from '@heroui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from '@/pages/Dashboard'
import Locales from '@/pages/Locales'
import Logs from '@/pages/Logs'
import Settings from '@/pages/Settings'
import { useAuth } from '@/stores/auth'
import { Button } from '@heroui/react'

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
})

function Gate({ children }: { children: React.ReactNode }) {
  const { status, bootstrap, error } = useAuth()
  useEffect(() => { void bootstrap() }, [bootstrap])

  if (status === 'pending') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="glass px-8 py-6 text-[13px] text-default-500">正在建立会话…</div>
      </div>
    )
  }
  if (status !== 'ok') {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="glass max-w-md p-8 text-center">
          <div className="mb-2 title-grad text-[24px] font-bold">会话未建立</div>
          <p className="mb-6 text-[13px] text-default-500">
            {error === 'invalid_token' || error === 'token_expired'
              ? '链接已失效。请回到 GitHub Desktop 菜单，重新点击"控制面板"。'
              : '请通过 GDP 菜单或运行 `gdp open` 打开本控制台。'}
          </p>
          <Button color="primary" radius="full" onPress={() => location.reload()}>重试</Button>
        </div>
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <HeroUIProvider>
        <BrowserRouter>
          <Gate>
            <Routes>
              <Route path="/" element={<Dashboard />} />
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
