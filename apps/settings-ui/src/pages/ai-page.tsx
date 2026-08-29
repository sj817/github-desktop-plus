import {
  Bot,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plug,
  RotateCcw,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useId, useState } from 'react'
import type { AiTestResult } from '@github-desktop-plus/shared'
import { useBridge } from '@/bridge/context'
import { Note } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { Input, InputGroup, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MODEL_SUGGESTIONS, PROMPT_TEMPLATES, PROVIDER_PRESETS } from '@/lib/prompt-templates'
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
      {/* 顶部主开关卡片 */}
      <div className="mb-6 flex items-center gap-3.5 rounded-xl border border-line/70 bg-elevated px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-5 font-semibold text-fg">启用 AI 提交信息</div>
          <p className="text-[12px] leading-relaxed text-fg-muted">
            接管提交框的 Copilot 按钮，改用下方配置的模型自动生成提交信息
          </p>
        </div>
        <Switch
          aria-label="启用 AI 提交信息"
          checked={ai.enabled}
          onCheckedChange={enabled => patchAi({ enabled })}
        />
      </div>

      {/* 模型接入 */}
      <section className="mb-6 space-y-2.5">
        <header className="px-1.5">
          <h2 className="text-[13px] leading-5 font-semibold text-fg tracking-normal flex items-center gap-1.5">
            <Bot className="size-3.5 text-purple-600 dark:text-purple-400" />
            <span>模型接入</span>
          </h2>
        </header>

        <div className="rounded-xl border border-line/70 bg-elevated divide-y divide-line/40 overflow-hidden">
          {/* Base URL */}
          <div className="p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="gdp-ai-base-url" className="text-[12.5px] font-medium text-fg">
                Base URL
              </label>
              <div className="flex flex-wrap items-center gap-1">
                {PROVIDER_PRESETS.map(provider => {
                  const active = ai.baseUrl.trim().toLowerCase() === provider.baseUrl.toLowerCase()
                  return (
                    <Chip
                      key={provider.name}
                      active={active}
                      onClick={() => {
                        patchAi({
                          baseUrl: provider.baseUrl,
                          ...(ai.model.trim() === '' ? { model: provider.defaultModel } : {}),
                        })
                      }}
                    >
                      {provider.name}
                    </Chip>
                  )
                })}
              </div>
            </div>
            <Input
              id="gdp-ai-base-url"
              className="h-8 font-mono text-[12px] bg-field border-line/60"
              spellCheck={false}
              autoComplete="off"
              placeholder="https://api.openai.com/v1"
              value={ai.baseUrl}
              onChange={event => patchAi({ baseUrl: event.target.value })}
            />
          </div>

          {/* API Key */}
          <div className="p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="gdp-ai-api-key" className="text-[12.5px] font-medium text-fg">
                API Key
              </label>
              <span className="text-[11px] text-fg-subtle flex items-center gap-1">
                <Lock className="size-3" />
                仅保存在本机配置文件
              </span>
            </div>
            <InputGroup
              id="gdp-ai-api-key"
              className="h-8 bg-field border-line/60"
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
          </div>

          {/* 模型名称 */}
          <div className="p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="gdp-ai-model" className="text-[12.5px] font-medium text-fg">
                模型名称
              </label>
              <div className="flex flex-wrap items-center gap-1">
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
            </div>
            <Input
              id="gdp-ai-model"
              className="h-8 font-mono text-[12px] bg-field border-line/60"
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
          </div>

          {/* 连通性测试 */}
          <div className="p-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-fg">连通性测试</div>
              <TestStatus state={test} ready={ready} />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={runTest}
              disabled={test.status === 'testing' || !ready}
              className="min-w-[92px]"
            >
              {test.status === 'testing' ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5 text-purple-600 dark:text-purple-400" />}
              测试连接
            </Button>
          </div>
        </div>
      </section>

      {/* 生成策略 */}
      <section className="mb-6 space-y-2.5">
        <header className="px-1.5">
          <h2 className="text-[13px] leading-5 font-semibold text-fg tracking-normal flex items-center gap-1.5">
            <Wand2 className="size-3.5 text-purple-600 dark:text-purple-400" />
            <span>生成策略</span>
          </h2>
        </header>

        <div className="rounded-xl border border-line/70 bg-elevated divide-y divide-line/40 overflow-hidden">
          {/* System Prompt */}
          <div className="p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="gdp-ai-prompt" className="text-[12.5px] font-medium text-fg">
                System Prompt
              </label>
              <div className="flex flex-wrap items-center gap-1">
                {PROMPT_TEMPLATES.map(item => (
                  <Chip
                    key={item.name}
                    active={activeTemplate?.name === item.name}
                    onClick={() => patchAi({ systemPrompt: item.prompt })}
                  >
                    {item.name}
                  </Chip>
                ))}
                {ai.systemPrompt !== '' ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => patchAi({ systemPrompt: '' })}
                    className="text-fg-subtle hover:text-fg h-6 px-1.5 text-[11px]"
                  >
                    <RotateCcw className="size-3" />
                    恢复默认
                  </Button>
                ) : null}
              </div>
            </div>
            <Textarea
              id="gdp-ai-prompt"
              rows={3}
              className="font-normal text-[12px] leading-relaxed bg-field border-line/60"
              placeholder="留空使用内置默认 prompt，或从上方模板快速选择"
              value={ai.systemPrompt}
              onChange={event => patchAi({ systemPrompt: event.target.value })}
            />
          </div>

          {/* 请求超时 */}
          <div className="p-3.5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[12.5px] font-medium text-fg">请求超时</div>
              <div className="text-[11.5px] text-fg-muted">单次生成请求的最长等待时间</div>
            </div>
            <InputGroup
              className="w-24 h-8 bg-field border-line/60"
              inputClassName="text-right tabular-nums text-[12px]"
              type="number"
              min={1}
              max={600}
              aria-label="请求超时秒数"
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
              trailing={<span className="pr-1 text-[11px] text-fg-subtle">秒</span>}
            />
          </div>

          {/* 失败时回退到 Copilot */}
          <div className="p-3.5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[12.5px] font-medium text-fg">失败时回退到 Copilot</div>
              <div className="text-[11.5px] text-fg-muted">AI 请求失败时改用原生 Copilot 生成</div>
            </div>
            <Switch
              aria-label="失败时回退到 Copilot"
              checked={ai.fallbackToCopilot}
              onCheckedChange={fallbackToCopilot => patchAi({ fallbackToCopilot })}
            />
          </div>
        </div>
      </section>
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
      <Note tone="success" icon={<Check strokeWidth={2.5} />} className="animate-rise-in mt-1">
        连接正常 · {result.latency_ms}ms
        {result.reply ? (
          <span className="text-fg-muted">
            {' '}
            · 模型回复「
            <span className="font-mono text-fg">{result.reply}</span>」
          </span>
        ) : null}
      </Note>
    )
  }
  return (
    <Note tone="danger" icon={<CircleAlert />} className="animate-rise-in mt-1">
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
        'h-[24px] rounded-lg px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-all duration-150 border cursor-pointer select-none',
        active
          ? 'border-[#409eff] bg-[#409eff]/10 text-[#409eff] font-medium'
          : 'bg-transparent border-line/70 text-fg-muted hover:border-line-strong hover:text-fg hover:bg-hover'
      )}
    >
      {children}
    </button>
  )
}
