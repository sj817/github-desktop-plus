export interface PromptTemplate {
  name: string
  prompt: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
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
