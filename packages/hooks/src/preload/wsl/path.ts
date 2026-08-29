export interface WslRepositoryPath {
  distro: string
  linuxPath: string
}

const WSL_UNC_PATTERN = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i

function normalizeWindowsPath(input: string): string {
  const normalized = input.replaceAll('/', '\\')
  return normalized.startsWith('\\\\?\\UNC\\')
    ? `\\\\${normalized.slice('\\\\?\\UNC\\'.length)}`
    : normalized
}

export function parseWslRepositoryPath(input: string): WslRepositoryPath | null {
  const match = WSL_UNC_PATTERN.exec(normalizeWindowsPath(input))
  if (!match?.[1]) return null

  const remainder = match[2] ?? ''
  return {
    distro: match[1],
    linuxPath: remainder === '' ? '/' : `/${remainder.replaceAll('\\', '/')}`,
  }
}

function drivePathToWsl(input: string): string | null {
  const match = /^([a-z]):[\\/](.*)$/i.exec(input)
  if (!match?.[1]) return null
  return `/mnt/${match[1].toLowerCase()}/${(match[2] ?? '').replaceAll('\\', '/')}`
}

function translatePathValue(input: string, distro: string): string {
  const wslPath = parseWslRepositoryPath(input)
  if (wslPath?.distro.toLowerCase() === distro.toLowerCase()) {
    return wslPath.linuxPath
  }
  return drivePathToWsl(input) ?? input
}

export function translateGitArgument(input: string, distro: string): string {
  const direct = translatePathValue(input, distro)
  if (direct !== input) return direct

  const optionMatch = /^(--(?:git-dir|work-tree|pathspec-from-file|super-prefix)=)(.*)$/i.exec(input)
  if (!optionMatch?.[1] || optionMatch[2] === undefined) return input
  return `${optionMatch[1]}${translatePathValue(optionMatch[2], distro)}`
}

const BLOCKED_GIT_ENVIRONMENT = new Set([
  'GIT_ASKPASS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_EDITOR',
  'GIT_EXEC_PATH',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_SSL_CAINFO',
  'GIT_TEMPLATE_DIR',
])

const PATH_GIT_ENVIRONMENT = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_WORK_TREE',
])

export function portableGitEnvironment(
  input: NodeJS.ProcessEnv | undefined,
  distro: string,
): Record<string, string> {
  const result: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }
  for (const [rawKey, value] of Object.entries(input ?? {})) {
    if (value === undefined) continue
    const key = rawKey.toUpperCase()
    if (!key.startsWith('GIT_') || BLOCKED_GIT_ENVIRONMENT.has(key)) continue
    result[key] = PATH_GIT_ENVIRONMENT.has(key)
      ? translatePathValue(value, distro)
      : value
  }
  return result
}

export function isGitExecutable(file: string): boolean {
  const normalized = file.replaceAll('\\', '/').toLowerCase()
  return normalized === 'git' || normalized.endsWith('/git') || normalized.endsWith('/git.exe')
}
