import { Eye, EyeOff, Plug } from 'lucide-react'
import { useId, useState } from 'react'
import type { AiTestResult } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { SettingField, SettingItem, SettingSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { MODEL_SUGGESTIONS, PROMPT_TEMPLATES } from '@/lib/prompt-templates'
import { DEFAULT_TIMEOUT_SECS } from '@/lib/settings'
import { useSettings } from '@/lib/settings-store'

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'done'; result: AiTestResult }

export function AiPage() {
  const { draft, update } = useSettings()
  const bridge = useBridge()
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [template, setTemplate] = useState('')
  const modelListId = useId()

  const ai = draft.ai
  const [timeoutText, setTimeoutText] = useState(() => String(ai.timeoutSecs))
  const patchAi = (patch: Partial<typeof ai>) =>
    update(prev => ({ ...prev, ai: { ...prev.ai, ...patch } }))

  // Deliberately tests the values currently in the form, not the saved ones, so
  // credentials can be verified before they are persisted.
  const runTest = async () => {
    setTest({ status: 'testing' })
    try {
      const result = await bridge.invoke('gdp:ai-test', {
        base_url: ai.baseUrl.trim(),
        api_key: ai.apiKey.trim(),
        model: ai.model.trim(),
        timeout_secs: ai.timeoutSecs > 0 ? ai.timeoutSecs : 15,
      })
      setTest({ status: 'done', result })
    } catch (error) {
      setTest({ status: 'done', result: { ok: false, reason: String(error) } })
    }
  }

  return (
    <>
      <SettingSection title="AI 提交">
        <SettingItem
          title="启用 AI 提交信息"
          description="接管提交框的 Copilot 按钮，改用下方配置的模型生成提交信息"
        >
          <Switch checked={ai.enabled} onCheckedChange={enabled => patchAi({ enabled })} />
        </SettingItem>
      </SettingSection>

      <SettingSection title="模型接入" hint="任意 OpenAI 兼容接口">
        <SettingField label="Base URL" htmlFor="gdp-ai-base-url">
          <Input
            id="gdp-ai-base-url"
            spellCheck={false}
            placeholder="https://api.openai.com/v1"
            value={ai.baseUrl}
            onChange={event => patchAi({ baseUrl: event.target.value })}
          />
        </SettingField>

        <SettingField label="API Key" htmlFor="gdp-ai-api-key">
          <div className="relative">
            <Input
              id="gdp-ai-api-key"
              className="pr-9"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-…"
              value={ai.apiKey}
              onChange={event => patchAi({ apiKey: event.target.value })}
            />
            <Button
              size="icon"
              variant="ghost"
              title={showKey ? '隐藏' : '显示'}
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={() => setShowKey(value => !value)}
            >
              {showKey ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </SettingField>

        <SettingField label="模型" htmlFor="gdp-ai-model">
          <Input
            id="gdp-ai-model"
            list={modelListId}
            spellCheck={false}
            placeholder="gpt-4o-mini"
            value={ai.model}
            onChange={event => patchAi({ model: event.target.value })}
          />
          <datalist id={modelListId}>
            {MODEL_SUGGESTIONS.map(model => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </SettingField>

        <SettingItem
          title="连通性"
          description={
            test.status === 'idle' ? (
              '用当前填写的参数实际调用一次接口'
            ) : test.status === 'testing' ? (
              '测试中…'
            ) : (
              <span className={cn(test.result.ok ? 'text-success' : 'text-danger')}>
                {test.result.ok
                  ? `连接正常 · ${test.result.latency_ms}ms · 模型响应：${test.result.reply || '(空)'}`
                  : (test.result.reason ?? '未知错误')}
              </span>
            )
          }
        >
          <Button size="sm" onClick={runTest} disabled={test.status === 'testing'}>
            <Plug />
            测试连接
          </Button>
        </SettingItem>
      </SettingSection>

      <SettingSection title="高级">
        <SettingField label="System Prompt" hint="留空使用内置默认">
          <div className="mb-2 flex items-center gap-2">
            <Select
              aria-label="预设模板"
              className="min-w-0 flex-1"
              placeholder="— 选择预设模板 —"
              value={template}
              options={PROMPT_TEMPLATES.map(item => ({ value: item.name, label: item.name }))}
              onValueChange={setTemplate}
            />
            <Button
              size="sm"
              disabled={template === ''}
              onClick={() => {
                const found = PROMPT_TEMPLATES.find(item => item.name === template)
                if (found) patchAi({ systemPrompt: found.prompt })
              }}
            >
              填入
            </Button>
          </div>
          <Textarea
            rows={5}
            placeholder="留空使用内置默认 prompt"
            value={ai.systemPrompt}
            onChange={event => patchAi({ systemPrompt: event.target.value })}
          />
        </SettingField>

        <SettingItem title="请求超时" description="单次生成请求的最长等待秒数">
          <div className="flex items-center gap-1.5">
            <Input
              className="w-20 text-right"
              type="number"
              min={1}
              max={600}
              // Held as text while editing so the field can be cleared; an
              // unparseable value only falls back to the default on blur.
              value={timeoutText}
              onChange={event => {
                setTimeoutText(event.target.value)
                const parsed = Number.parseInt(event.target.value, 10)
                if (Number.isFinite(parsed) && parsed > 0) patchAi({ timeoutSecs: parsed })
              }}
              onBlur={() => {
                const parsed = Number.parseInt(timeoutText, 10)
                const next = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_SECS
                setTimeoutText(String(next))
                patchAi({ timeoutSecs: next })
              }}
            />
            <span className="text-[12px] text-fg-subtle">秒</span>
          </div>
        </SettingItem>

        <SettingItem title="失败时回退到 Copilot" description="AI 请求失败时改用原生 Copilot 生成">
          <Switch
            checked={ai.fallbackToCopilot}
            onCheckedChange={fallbackToCopilot => patchAi({ fallbackToCopilot })}
          />
        </SettingItem>
      </SettingSection>
    </>
  )
}
