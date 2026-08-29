export interface PromptTemplate {
  name: string
  prompt: string
}

export interface ProviderPreset {
  name: string
  baseUrl: string
  defaultModel: string
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  { name: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V3' },
  { name: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1', defaultModel: 'qwen2.5-coder:7b' },
]

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    name: 'feat: 中文',
    prompt:
      '请用 `<type>: <中文描述>` 格式生成单行提交信息，type 取自 feat/fix/docs/refactor/test/chore/style/perf/build/ci。只输出提交信息，不要其他内容。',
  },
  {
    name: 'feat(scope): 中文',
    prompt:
      '请用 `<type>(<scope>): <中文描述>` 格式生成单行提交信息，type 取自 feat/fix/docs/refactor/test/chore/style/perf，scope 从变更路径推断。只输出提交信息，不要其他内容。',
  },
  {
    name: 'feat(emoji): 中文',
    prompt:
      '请用 `<type>(<emoji>): <中文描述>` 格式生成单行提交信息，emoji 从 gitmoji 选取，type 取自 feat/fix/docs/refactor 等。只输出提交信息，不要其他内容。',
  },
  {
    name: 'emoji: 中文',
    prompt:
      '请用 `<emoji> <中文描述>` 格式生成单行提交信息，emoji 取自 gitmoji，描述用中文。只输出提交信息，不要其他内容。',
  },
  {
    name: 'English Conventional',
    prompt:
      'Generate a single-line commit message using Conventional Commits format (type: description). Use English, imperative mood. Output only the commit message, nothing else.',
  },
]

export const MODEL_SUGGESTIONS: readonly string[] = [
  'gpt-4o-mini',
  'gpt-4o',
  'deepseek-chat',
  'deepseek-reasoner',
  'qwen-plus',
  'glm-4.5',
  'moonshot-v1-8k',
]
