import * as fs from 'node:fs'
import * as path from 'node:path'

const childProcess = process.getBuiltinModule('node:child_process')

interface WindowsGitConfiguration {
  userName?: string
  userEmail?: string
  signingKey?: string
  commitGpgSign?: string
  tagGpgSign?: string
  gpgFormat?: string
  gpgProgram?: string
  credentialHelper?: string
}

function wslExecutable(): string {
  const systemRoot = process.env.SystemRoot
  return systemRoot ? path.join(systemRoot, 'System32', 'wsl.exe') : 'wsl.exe'
}

function execFileText(file: string, args: readonly string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      file,
      [...args],
      { encoding: 'utf8', windowsHide: true, timeout },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()),
    )
  })
}

async function optionalExecFileText(file: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const value = await execFileText(file, args)
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

export function windowsPathToWsl(value: string): string | null {
  const match = /^([a-z]):[\\/](.*)$/i.exec(value.trim())
  if (!match?.[1]) return null
  return `/mnt/${match[1].toLowerCase()}/${(match[2] ?? '').replaceAll('\\', '/')}`
}

function quoteGitConfig(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')}"`
}

function shellEscapeWord(value: string): string {
  return value.replace(/[^A-Za-z0-9_@%+=:,./-]/g, character => `\\${character}`)
}

function pushSection(
  lines: string[],
  section: string,
  values: ReadonlyArray<readonly [string, string | undefined]>,
): void {
  const present = values.filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
  if (present.length === 0) return
  lines.push(`[${section}]`)
  for (const [key, value] of present) lines.push(`\t${key} = ${quoteGitConfig(value)}`)
  lines.push('')
}

export function renderManagedGitConfig(config: WindowsGitConfiguration): string {
  const lines = [
    '# Managed by GitHub Desktop Plus. Local WSL overrides belong in ~/.gitconfig.',
    '',
  ]
  pushSection(lines, 'user', [
    ['name', config.userName],
    ['email', config.userEmail],
    ['signingKey', config.signingKey],
  ])
  pushSection(lines, 'commit', [['gpgSign', config.commitGpgSign]])
  pushSection(lines, 'tag', [['gpgSign', config.tagGpgSign]])
  pushSection(lines, 'gpg', [
    ['format', config.gpgFormat],
    ['program', config.gpgProgram],
  ])
  if (config.credentialHelper) {
    lines.push('[credential]')
    lines.push('\thelper =')
    // Git appends "get", "store", or "erase" and executes the helper through
    // a POSIX shell. Keep the value absolute while escaping spaces and other
    // shell metacharacters, matching GCM's documented WSL configuration.
    lines.push(`\thelper = ${quoteGitConfig(shellEscapeWord(config.credentialHelper))}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

async function findWindowsGit(): Promise<string | undefined> {
  const result = await optionalExecFileText('where.exe', ['git.exe'])
  const fromPath = result
    ?.split(/\r?\n/)
    .map(candidate => candidate.trim())
    .find(candidate => candidate !== '' && fs.existsSync(candidate))
  if (fromPath) return fromPath

  // GitHub Desktop ships its own Git even when the user has not installed a
  // system-wide Git for Windows. In the injected renderer, process.execPath is
  // the versioned GitHubDesktop.exe next to resources/app/git.
  const bundled = path.join(
    path.dirname(process.execPath),
    'resources', 'app', 'git', 'cmd', 'git.exe',
  )
  return fs.existsSync(bundled) ? bundled : undefined
}

async function findCredentialManager(windowsGit: string | undefined): Promise<string | undefined> {
  const direct = await optionalExecFileText('where.exe', ['git-credential-manager.exe'])
  const directPath = direct?.split(/\r?\n/).find(candidate => candidate.trim() !== '')?.trim()
  if (directPath && fs.existsSync(directPath)) return directPath
  if (!windowsGit) return undefined
  const gitRoot = path.resolve(path.dirname(windowsGit), '..')
  const candidate = path.join(gitRoot, 'mingw64', 'bin', 'git-credential-manager.exe')
  return fs.existsSync(candidate) ? candidate : undefined
}

async function readWindowsGitConfiguration(): Promise<WindowsGitConfiguration> {
  const windowsGit = await findWindowsGit()
  if (!windowsGit) throw new Error('Git for Windows was not found')
  const read = (key: string) => optionalExecFileText(windowsGit, ['config', '--global', '--get', key])
  const [
    userName,
    userEmail,
    signingKey,
    commitGpgSign,
    tagGpgSign,
    gpgFormat,
    windowsGpgProgram,
    credentialManager,
  ] = await Promise.all([
    read('user.name'),
    read('user.email'),
    read('user.signingkey'),
    read('commit.gpgsign'),
    read('tag.gpgsign'),
    read('gpg.format'),
    read('gpg.program'),
    findCredentialManager(windowsGit),
  ])
  return {
    userName,
    userEmail,
    signingKey,
    commitGpgSign,
    tagGpgSign,
    gpgFormat,
    gpgProgram: windowsGpgProgram ? windowsPathToWsl(windowsGpgProgram) ?? undefined : undefined,
    credentialHelper: credentialManager ? windowsPathToWsl(credentialManager) ?? undefined : undefined,
  }
}

function writeIfChanged(file: string, content: string): void {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return
  } catch {
    // Missing or unreadable files are replaced below.
  }
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, file)
}

export async function syncWindowsGitConfiguration(distro: string, knownHome?: string): Promise<void> {
  const home = knownHome ?? await execFileText(
    wslExecutable(),
    ['-d', distro, '--exec', 'printenv', 'HOME'],
  )
  if (!home.startsWith('/')) throw new Error(`WSL returned an invalid HOME for ${distro}: ${home}`)

  const config = await readWindowsGitConfiguration()
  const linuxDirectory = `${home}/.config/github-desktop-plus`
  const linuxFile = `${linuxDirectory}/gitconfig`
  const uncDirectory = `\\\\wsl.localhost\\${distro}${linuxDirectory.replaceAll('/', '\\')}`
  const uncFile = path.join(uncDirectory, 'gitconfig')
  fs.mkdirSync(uncDirectory, { recursive: true })
  writeIfChanged(uncFile, renderManagedGitConfig(config))

  const includes = await optionalExecFileText(
    wslExecutable(),
    ['-d', distro, '--exec', 'git', 'config', '--global', '--get-all', 'include.path'],
  )
  if (!includes?.split(/\r?\n/).includes(linuxFile)) {
    await execFileText(
      wslExecutable(),
      ['-d', distro, '--exec', 'git', 'config', '--global', '--add', 'include.path', linuxFile],
    )
  }
}
