import { Bot, Check, CircleAlert, Eye, EyeOff, Loader2, Plug, RotateCcw, SlidersHorizontal, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { AiTestResult } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { Note, PageHeader, SettingField, SettingItem, SettingSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input, InputGroup, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { MODEL_SUGGESTIONS, PROMPT_TEMPLATES, PROVIDER_PRESETS } from '@/lib/prompt-templates'
import { DEFAULT_TIMEOUT_SECS } from '@/lib/settings'
import { useSettings } from '@/lib/settings-store'

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'done'; result: AiTestResult }

export function AiPage() {
  const { draft, update } = useSettings()
  const bridge = useBridge()
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const request = useRef(0)
  const modelListId = useId()
  const ai = draft.ai
  const [timeoutText, setTimeoutText] = useState(() => String(ai.timeoutSecs))

  useEffect(() => () => { request.current += 1 }, [])
  const patchAi = (patch: Partial<typeof ai>) => {
    if ('baseUrl' in patch || 'apiKey' in patch || 'model' in patch || 'timeoutSecs' in patch) {
      request.current += 1
      setTest({ status: 'idle' })
    }
    update(prev => ({ ...prev, ai: { ...prev.ai, ...patch } }))
  }
  const ready = ai.baseUrl.trim() !== '' && ai.apiKey.trim() !== '' && ai.model.trim() !== ''
  const runTest = async () => {
    const current = ++request.current
    setTest({ status: 'testing' })
    try {
      const result = await bridge.invoke('gdp:ai-test', {
        base_url: ai.baseUrl.trim(), api_key: ai.apiKey.trim(), model: ai.model.trim(), timeout_secs: ai.timeoutSecs,
      })
      if (current === request.current) setTest({ status: 'done', result })
    } catch (error) {
      if (current === request.current) setTest({ status: 'done', result: { ok: false, reason: String(error) } })
    }
  }
  const normalizeTimeout = (text: string) => {
    const value = Number.parseInt(text, 10)
    return Number.isFinite(value) ? Math.min(600, Math.max(1, value)) : DEFAULT_TIMEOUT_SECS
  }

  return (
    <>
      <PageHeader title="AI 提交" description="连接自定义模型，在提交框中生成提交信息。" />
      <div className="setting-stack">
        <section className="setting-feature" aria-label="AI 提交开关">
          <span className="panel-glyph"><Sparkles /></span>
          <div><h2 className="setting-label">启用 AI 提交信息</h2><p className="setting-description">使用下方模型接管提交框中的 Copilot 按钮。</p></div>
          <Switch aria-label="启用 AI 提交信息" checked={ai.enabled} onCheckedChange={enabled => patchAi({ enabled })} />
        </section>
        <div className="settings-grid">
          <SettingSection title="模型连接" description="支持 OpenAI 兼容的接口。" icon={<Bot />}>
            <SettingField label="Base URL" htmlFor="gdp-ai-base-url">
              <Input id="gdp-ai-base-url" className="gdp-mono" spellCheck={false} autoComplete="off" placeholder="https://api.openai.com/v1" value={ai.baseUrl} onChange={event => patchAi({ baseUrl: event.target.value })} />
              <div className="setting-chips">
                {PROVIDER_PRESETS.map(provider => <Chip key={provider.name} active={ai.baseUrl.trim().toLowerCase() === provider.baseUrl.toLowerCase()} onClick={() => patchAi({ baseUrl: provider.baseUrl, ...(ai.model.trim() === '' ? { model: provider.defaultModel } : {}) })}>{provider.name}</Chip>)}
              </div>
            </SettingField>
            <SettingField label="API Key" htmlFor="gdp-ai-api-key" hint="仅保存在本机配置中。">
              <InputGroup id="gdp-ai-api-key" inputClassName="gdp-mono" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="sk-…" value={ai.apiKey} onChange={event => patchAi({ apiKey: event.target.value })} trailing={
                <Button size="icon-sm" variant="ghost" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff /> : <Eye />}</Button>
              } />
            </SettingField>
            <SettingField label="模型名称" htmlFor="gdp-ai-model">
              <Input id="gdp-ai-model" className="gdp-mono" list={modelListId} spellCheck={false} autoComplete="off" placeholder="输入模型 ID" value={ai.model} onChange={event => patchAi({ model: event.target.value })} />
              <datalist id={modelListId}>{MODEL_SUGGESTIONS.map(model => <option key={model} value={model} />)}</datalist>
            </SettingField>
            <Button variant="primary" onClick={runTest} disabled={test.status === 'testing' || !ready}>
              {test.status === 'testing' ? <Loader2 className="gdp-spin" /> : <Plug />}测试连接
            </Button>
            <div aria-live="polite"><TestStatus state={test} ready={ready} /></div>
          </SettingSection>
          <SettingSection title="生成策略" description="为提交信息选择合适的表达方式。" icon={<Wand2 />}>
            <SettingField label="提示词" htmlFor="gdp-ai-prompt" hint="留空时使用内置提示词。">
              <div className="setting-chips">{PROMPT_TEMPLATES.map(item => <Chip key={item.name} active={ai.systemPrompt === item.prompt} onClick={() => patchAi({ systemPrompt: item.prompt })}>{item.name}</Chip>)}</div>
              <Textarea id="gdp-ai-prompt" rows={7} placeholder="描述提交信息的语言、格式和重点…" value={ai.systemPrompt} onChange={event => patchAi({ systemPrompt: event.target.value })} />
            </SettingField>
            <Button size="sm" variant="ghost" disabled={ai.systemPrompt === ''} onClick={() => patchAi({ systemPrompt: '' })}><RotateCcw />恢复默认提示词</Button>
          </SettingSection>
          <SettingSection title="请求选项" icon={<SlidersHorizontal />} className="panel-span">
            <SettingItem title="请求超时" description="单次请求的最长等待时间，范围 1–600 秒。">
              <InputGroup className="gdp-input-number" type="number" min={1} max={600} aria-label="请求超时秒数" value={timeoutText}
                onChange={event => {
                  const text = event.target.value
                  setTimeoutText(text)
                  patchAi({ timeoutSecs: normalizeTimeout(text) })
                }}
                onBlur={() => { const value = normalizeTimeout(timeoutText); setTimeoutText(String(value)); patchAi({ timeoutSecs: value }) }}
                trailing={<>秒</>} />
            </SettingItem>
            <SettingItem title="失败时回退到 Copilot" description="自定义模型请求失败时，尝试使用原生 Copilot。">
              <Switch aria-label="失败时回退到 Copilot" checked={ai.fallbackToCopilot} onCheckedChange={fallbackToCopilot => patchAi({ fallbackToCopilot })} />
            </SettingItem>
          </SettingSection>
        </div>
      </div>
    </>
  )
}

function TestStatus({ state, ready }: { state: TestState; ready: boolean }) {
  if (!ready) return <Note>填写接口地址、API Key 和模型名称后可测试连接。</Note>
  if (state.status === 'idle') return <Note>使用当前填写的参数测试，不会保存设置。</Note>
  if (state.status === 'testing') return <Note>正在请求模型接口…</Note>
  return state.result.ok
    ? <Note tone="success" icon={<Check />}>连接正常 · {state.result.latency_ms} ms{state.result.reply ? ' · ' + state.result.reply : ''}</Note>
    : <Note tone="danger" icon={<CircleAlert />}>{state.result.reason ?? '连接失败，请检查模型配置。'}</Note>
}
