import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, RotateCcw } from 'lucide-react'
import { useBridge } from '@/bridge/context'
import { EmptyState } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { applyDraft, draftFromConfig, type SettingsDraft } from '@/lib/settings'

interface SettingsStore {
  draft: SettingsDraft
  update: (updater: (prev: SettingsDraft) => SettingsDraft) => void
  dirty: boolean
  saving: boolean
  save: () => Promise<void>
}
const SettingsContext = createContext<SettingsStore | null>(null)

export function SettingsProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const bridge = useBridge()
  const toast = useToast()
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [baseline, setBaseline] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  const savingRef = useRef(false)
  const mounted = useRef(true)
  draftRef.current = draft
  baselineRef.current = baseline

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    bridge.invoke('gdp:get-config').then(config => {
      if (cancelled) return
      const next = draftFromConfig(config)
      setDraft(next)
      setBaseline(JSON.stringify(next))
    }).catch((reason: unknown) => {
      if (!cancelled) setError(String(reason))
    })
    return () => { cancelled = true }
  }, [bridge, loadAttempt])

  const update = useCallback((updater: (prev: SettingsDraft) => SettingsDraft) => {
    setDraft(prev => prev ? updater(prev) : prev)
  }, [])

  const save = useCallback(async () => {
    const current = draftRef.current
    if (!current || savingRef.current || JSON.stringify(current) === baselineRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      // Merge with a fresh disk read so unrelated keys and newly created locales survive.
      const onDisk = await bridge.invoke('gdp:get-config')
      const result = await bridge.invoke('gdp:set-config', applyDraft(onDisk, current))
      if (!result.ok) throw new Error(result.reason ?? '未知错误')
      if (mounted.current) {
        setBaseline(JSON.stringify(current))
        toast('设置已保存')
      }
    } catch (reason) {
      if (mounted.current) toast('保存失败：' + String(reason), 'error')
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }, [bridge, toast])

  const value = useMemo<SettingsStore | null>(() => draft ? {
    draft, update, dirty: JSON.stringify(draft) !== baseline, saving, save,
  } : null, [draft, baseline, saving, save, update])

  if (error) return (
    <div className="settings-load-error">
      <EmptyState icon={<CircleAlert />} title="无法读取设置" action={<>
        <Button onClick={() => bridge.close()}>关闭</Button>
        <Button variant="primary" onClick={() => setLoadAttempt(prev => prev + 1)}><RotateCcw />重试</Button>
      </>}>{error}</EmptyState>
    </div>
  )
  if (!value) return <>{fallback}</>
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsStore {
  const store = useContext(SettingsContext)
  if (!store) throw new Error('SettingsProvider is missing')
  return store
}
