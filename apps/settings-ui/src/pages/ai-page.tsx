import {
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plug,
  RotateCcw,
} from 'lucide-react'
import { useId, useState } from 'react'
import type { AiTestResult } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { Note, SettingField, SettingItem, SettingSection } from '@/components/settings/section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, InputGroup, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
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
  const modelListId = useId()

  const ai = draft.ai
  const [timeoutText, setTimeoutText] = useState(() => String(ai.timeoutSecs))
  const patchAi = (patch: Partial<typeof ai>) =>
    update(prev => ({ ...prev, ai: { ...prev.ai, ...patch } }))

  const ready = ai.baseUrl.trim() !== '' && ai.apiKey.trim() !== '' && ai.model.trim() !== ''

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

  const activeTemplate = PROMPT_TEMPLATES.find(item => item.prompt === ai.systemPrompt)

  return (
    <>
      {/* The master switch stands alone: everything below only matters once it is on. */}
      <div className="mb-6 flex items-center gap-6 rounded-xl border border-line bg-elevated px-4 py-3.5 shadow-xs">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] leading-5 font-semibold text-fg">启用 AI 提交信息</span>
            <Badge tone={ai.enabled ? 'success' : 'neutral'}>{ai.enabled ? '已启用' : '未启用'}</Badge>
          </div>
          <p className="mt-0.5 text-[12px] leading-[18px] text-fg-muted">
            接管提交框的 Copilot 按钮，改用下方配置的模型生成提交信息
          </p>
        </div>
        <Switch checked={ai.enabled} onCheckedChange={enabled => patchAi({ enabled })} />
      </div>

      <SettingSection title="模型接入" description="任意 OpenAI 兼容接口都可以">
        <SettingField label="Base URL" htmlFor="gdp-ai-base-url">
          <Input
            id="gdp-ai-base-url"
            spellCheck={false}
            autoComplete="off"
            placeholder="https://api.openai.com/v1"
            value={ai.baseUrl}
            onChange={event => patchAi({ baseUrl: event.target.value })}
          />
        </SettingField>

        <SettingField
          label="API Key"
          htmlFor="gdp-ai-api-key"
          hint={
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" />
              仅保存在本机配置文件
            </span>
          }
        >
          <InputGroup
            id="gdp-ai-api-key"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            inputClassName={cn(!showKey && ai.apiKey !== '' && 'font-mono tracking-[0.12em]')}
            value={ai.apiKey}
            onChange={event => patchAi({ apiKey: event.target.value })}
            trailing={
              <Tooltip content={showKey ? '隐藏' : '显示'}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowKey(value => !value)}
                >
                  {showKey ? <EyeOff /> : <Eye />}
                </Button>
              </Tooltip>
            }
          />
        </SettingField>

        <SettingField label="模型" htmlFor="gdp-ai-model">
          <Input
            id="gdp-ai-model"
            list={modelListId}
            spellCheck={false}
            autoComplete="off"
            placeholder="gpt-4o-mini"
            value={ai.model}
            onChange={event => patchAi({ model: event.target.value })}
          />
          <datalist id={modelListId}>
            {MODEL_SUGGESTIONS.map(model => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <div className="mt-2 flex flex-wrap gap-1">
            {MODEL_SUGGESTIONS.map(model => (
              <Chip
                key={model}
                active={ai.model.trim() === model}
                onClick={() => patchAi({ model })}
              >
                {model}
              </Chip>
            ))}
          </div>
        </SettingField>

        <SettingItem
          align="start"
          title="连通性"
          description={
            <TestStatus state={test} ready={ready} />
          }
        >
          <Button
            size="sm"
            onClick={runTest}
            disabled={test.status === 'testing' || !ready}
            className="min-w-[88px]"
          >
            {test.status === 'testing' ? <Loader2 className="animate-spin" /> : <Plug />}
            测试连接
          </Button>
        </SettingItem>
      </SettingSection>

      <SettingSection title="生成" description="控制模型如何写提交信息">
        <SettingField
          label="System Prompt"
          hint="留空使用内置默认"
          trailing={
            ai.systemPrompt !== '' ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => patchAi({ systemPrompt: '' })}
                className="text-fg-subtle"
              >
                <RotateCcw />
                恢复默认
              </Button>
            ) : null
          }
        >
          <div className="mb-2 flex flex-wrap gap-1">
            {PROMPT_TEMPLATES.map(item => (
              <Chip
                key={item.name}
                active={activeTemplate?.name === item.name}
                onClick={() => patchAi({ systemPrompt: item.prompt })}
              >
                {item.name}
              </Chip>
            ))}
          </div>
          <Textarea
            rows={4}
            placeholder="留空使用内置默认 prompt，或从上方模板开始"
            value={ai.systemPrompt}
            onChange={event => patchAi({ systemPrompt: event.target.value })}
          />
        </SettingField>

        <SettingItem title="请求超时" description="单次生成请求的最长等待时间">
          <InputGroup
            className="w-24"
            inputClassName="text-right tabular-nums"
            type="number"
            min={1}
            max={600}
            aria-label="请求超时秒数"
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
            trailing={<span className="pr-1 text-[11.5px] text-fg-subtle">秒</span>}
          />
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

function TestStatus({ state, ready }: { state: TestState; ready: boolean }) {
  if (!ready) return <>填写 Base URL、API Key 与模型后可测试</>
  if (state.status === 'idle') return <>用当前填写的参数实际调用一次接口，不会写入配置</>
  if (state.status === 'testing') return <>正在请求接口…</>

  const { result } = state
  if (result.ok) {
    return (
      <Note tone="success" icon={<Check strokeWidth={2.5} />} className="animate-rise-in">
        连接正常 · {result.latency_ms}ms
        {result.reply ? (
          <span className="text-fg-muted">
            {' '}
            · 模型回复「
            <span className="font-mono">{result.reply}</span>」
          </span>
        ) : null}
      </Note>
    )
  }
  return (
    <Note tone="danger" icon={<CircleAlert />} className="animate-rise-in">
      {result.reason ?? '未知错误'}
    </Note>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-[24px] rounded-lg px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-all duration-150 border',
        active
          ? 'bg-accent text-white border-accent shadow-xs'
          : 'bg-field border-line text-fg-muted hover:border-line-strong hover:text-fg hover:bg-hover'
      )}
    >
      {children}
    </button>
  )
}
