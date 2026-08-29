import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useBridge } from '@/bridge/context'
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

/**
 * One draft for the whole dialog rather than one per tab.
 *
 * The old dialog persisted each built tab separately on save; keeping a single
 * draft preserves that behaviour (edits on a tab you navigated away from are
 * still written) while making "cancel discards everything" fall out of the
 * dialog simply unmounting.
 */
export function SettingsProvider({
  children,
  fallback,
}: {
  children: ReactNode
  fallback: ReactNode
}) {
  const bridge = useBridge()
  const toast = useToast()

  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [baseline, setBaseline] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const draftRef = useRef<SettingsDraft | null>(null)
  draftRef.current = draft

  useEffect(() => {
    let cancelled = false
    bridge
      .invoke('gdp:get-config')
      .then(config => {
        if (cancelled) return
        const next = draftFromConfig(config)
        setDraft(next)
        setBaseline(JSON.stringify(next))
      })
      .catch((error: unknown) => {
        if (!cancelled) toast(`读取配置失败：${String(error)}`, 'error')
      })
    return () => {
      cancelled = true
    }
  }, [bridge, toast])

  const update = useCallback((updater: (prev: SettingsDraft) => SettingsDraft) => {
    setDraft(prev => (prev ? updater(prev) : prev))
  }, [])

  const save = useCallback(async () => {
    const current = draftRef.current
    if (!current) return
    setSaving(true)
    try {
      // Re-read from disk so keys this dialog does not manage — and locales
      // created while it was open — are not clobbered by a stale copy.
      const onDisk = await bridge.invoke('gdp:get-config')
      const result = await bridge.invoke('gdp:set-config', applyDraft(onDisk, current))
      if (result && result.ok === false) throw new Error(result.reason ?? '未知错误')
      setBaseline(JSON.stringify(current))
      toast('设置已保存')
    } catch (error) {
      toast(`保存失败：${String(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [bridge, toast])

  const value = useMemo<SettingsStore | null>(() => {
    if (!draft) return null
    return { draft, update, dirty: JSON.stringify(draft) !== baseline, saving, save }
  }, [draft, baseline, saving, save, update])

  if (!value) return <>{fallback}</>
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsStore {
  const store = useContext(SettingsContext)
  if (!store) throw new Error('SettingsProvider is missing')
  return store
}
