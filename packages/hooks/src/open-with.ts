/**
 * "Open with" targets — detection and launching, main process side.
 *
 * GitHub Desktop only ever exposes ONE external editor and ONE shell in its
 * repository context menu (whichever pair is selected in its own settings).
 * GDP lets the user configure any number of them; this module finds the
 * installed candidates and launches the one the user picked.
 *
 * The renderer half (preload/open-with.ts) injects the menu entries and calls
 * `gdp:open-with-launch` with the item id + repository path.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as cp from 'child_process'
import { gdpLog } from './logger'

/** Placeholder replaced with the repository path — same token GD uses. */
export const TARGET_PATH_TOKEN = '%TARGET_PATH%'

export interface OpenWithItem {
  id: string
  label: string
  path: string
  /** Command line; `%TARGET_PATH%` is replaced with the repository path. */
  args: string
  /** 'editor' | 'shell' — decides which native entry the item sits next to. */
  group: string
  /** Launch through `start` so console programs get their own window. */
  console: boolean
  enabled: boolean
}

/** A candidate found on disk, ready to be added to the configured list. */
export interface DetectedItem {
  id: string
  label: string
  path: string
  args: string
  group: 'editor' | 'shell'
  console: boolean
}

// ── Path helpers ────────────────────────────────────────────────────────────

/** Expand `%NAME%` environment placeholders; unknown names disable the entry. */
function expandEnv(template: string): string | null {
  let missing = false
  const expanded = template.replace(/%([^%]+)%/g, (_m, name: string) => {
    const value = process.env[name] ?? process.env[name.toUpperCase()]
    if (!value) {
      missing = true
      return ''
    }
    return value
  })
  return missing ? null : path.normalize(expanded)
}

function firstExisting(templates: readonly string[]): string | null {
  for (const template of templates) {
    const candidate = expandEnv(template)
    if (candidate !== null && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

// ── Candidate tables ────────────────────────────────────────────────────────

interface CandidateSpec {
  id: string
  label: string
  paths: readonly string[]
  group: 'editor' | 'shell'
  /** Defaults to `"%TARGET_PATH%"` for editors and '' for shells. */
  args?: string
  console?: boolean
}

const WIN32_CANDIDATES: readonly CandidateSpec[] = [
  // Editors — every one of these takes the folder as a bare argument.
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    group: 'editor',
    paths: [
      '%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe',
      '%ProgramFiles%/Microsoft VS Code/Code.exe',
      '%ProgramFiles(x86)%/Microsoft VS Code/Code.exe',
    ],
  },
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    group: 'editor',
    paths: [
      '%LOCALAPPDATA%/Programs/Microsoft VS Code Insiders/Code - Insiders.exe',
      '%ProgramFiles%/Microsoft VS Code Insiders/Code - Insiders.exe',
    ],
  },
  {
    id: 'vscodium',
    label: 'VSCodium',
    group: 'editor',
    paths: [
      '%LOCALAPPDATA%/Programs/VSCodium/VSCodium.exe',
      '%ProgramFiles%/VSCodium/VSCodium.exe',
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    group: 'editor',
    paths: [
      '%LOCALAPPDATA%/Programs/cursor/Cursor.exe',
      '%ProgramFiles%/cursor/Cursor.exe',
    ],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    group: 'editor',
    paths: ['%LOCALAPPDATA%/Programs/Windsurf/Windsurf.exe'],
  },
  {
    id: 'trae',
    label: 'Trae',
    group: 'editor',
    paths: [
      '%LOCALAPPDATA%/Programs/Trae/Trae.exe',
      '%LOCALAPPDATA%/Programs/Trae CN/Trae CN.exe',
    ],
  },
  {
    id: 'zed',
    label: 'Zed',
    group: 'editor',
    paths: [
      '%LOCALAPPDATA%/Programs/Zed/zed.exe',
      '%LOCALAPPDATA%/Zed/zed.exe',
      '%ProgramFiles%/Zed/zed.exe',
    ],
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    group: 'editor',
    paths: [
      '%ProgramFiles%/Sublime Text/sublime_text.exe',
      '%ProgramFiles%/Sublime Text 3/sublime_text.exe',
      '%ProgramFiles(x86)%/Sublime Text 3/sublime_text.exe',
    ],
  },
  {
    id: 'notepadpp',
    label: 'Notepad++',
    group: 'editor',
    paths: [
      '%ProgramFiles%/Notepad++/notepad++.exe',
      '%ProgramFiles(x86)%/Notepad++/notepad++.exe',
    ],
  },
  {
    id: 'android-studio',
    label: 'Android Studio',
    group: 'editor',
    paths: ['%ProgramFiles%/Android/Android Studio/bin/studio64.exe'],
  },
  {
    id: 'fleet',
    label: 'JetBrains Fleet',
    group: 'editor',
    paths: ['%LOCALAPPDATA%/Programs/Fleet/Fleet.exe'],
  },

  // Shells — console programs are launched through `start` (see launch()).
  {
    id: 'cmd',
    label: '命令提示符',
    group: 'shell',
    paths: ['%WINDIR%/System32/cmd.exe'],
    args: '',
    console: true,
  },
  {
    id: 'powershell',
    label: 'Windows PowerShell',
    group: 'shell',
    paths: ['%WINDIR%/System32/WindowsPowerShell/v1.0/powershell.exe'],
    args: '',
    console: true,
  },
  {
    id: 'pwsh',
    label: 'PowerShell 7',
    group: 'shell',
    paths: [
      '%ProgramFiles%/PowerShell/7/pwsh.exe',
      '%ProgramFiles(x86)%/PowerShell/7/pwsh.exe',
    ],
    args: '',
    console: true,
  },
  {
    id: 'windows-terminal',
    label: 'Windows Terminal',
    group: 'shell',
    // wt is a GUI host, so it starts directly; the profile's own starting
    // directory wins unless we pass -d explicitly.
    paths: ['%LOCALAPPDATA%/Microsoft/WindowsApps/wt.exe'],
    args: `-d "${TARGET_PATH_TOKEN}"`,
  },
  {
    id: 'git-bash',
    label: 'Git Bash',
    group: 'shell',
    paths: [
      '%ProgramFiles%/Git/git-bash.exe',
      '%ProgramFiles(x86)%/Git/git-bash.exe',
      '%LOCALAPPDATA%/Programs/Git/git-bash.exe',
    ],
    args: `--cd="${TARGET_PATH_TOKEN}"`,
  },
]

const DARWIN_CANDIDATES: readonly CandidateSpec[] = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    group: 'editor',
    paths: ['/Applications/Visual Studio Code.app'],
  },
  { id: 'cursor', label: 'Cursor', group: 'editor', paths: ['/Applications/Cursor.app'] },
  { id: 'zed', label: 'Zed', group: 'editor', paths: ['/Applications/Zed.app'] },
  {
    id: 'sublime',
    label: 'Sublime Text',
    group: 'editor',
    paths: ['/Applications/Sublime Text.app'],
  },
  { id: 'terminal', label: 'Terminal', group: 'shell', paths: ['/System/Applications/Utilities/Terminal.app'] },
  { id: 'iterm', label: 'iTerm2', group: 'shell', paths: ['/Applications/iTerm.app'] },
]

const LINUX_CANDIDATES: readonly CandidateSpec[] = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    group: 'editor',
    paths: ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code'],
  },
  { id: 'cursor', label: 'Cursor', group: 'editor', paths: ['/usr/bin/cursor', '/usr/local/bin/cursor'] },
  { id: 'zed', label: 'Zed', group: 'editor', paths: ['/usr/bin/zed', '%HOME%/.local/bin/zed'] },
  { id: 'gnome-terminal', label: 'GNOME Terminal', group: 'shell', paths: ['/usr/bin/gnome-terminal'], args: `--working-directory="${TARGET_PATH_TOKEN}"` },
]

function candidateTable(): readonly CandidateSpec[] {
  if (process.platform === 'win32') return WIN32_CANDIDATES
  if (process.platform === 'darwin') return DARWIN_CANDIDATES
  return LINUX_CANDIDATES
}

function defaultArgsFor(group: 'editor' | 'shell', spec?: CandidateSpec): string {
  if (spec?.args !== undefined) return spec.args
  return group === 'editor' ? `"${TARGET_PATH_TOKEN}"` : ''
}

// ── JetBrains ───────────────────────────────────────────────────────────────

/**
 * JetBrains IDEs land in too many places to enumerate (Toolbox 1.x, Toolbox
 * 2.x, standalone installers), but they all share the same `bin/<name>64.exe`
 * shape — so scan the known roots for that instead of guessing full paths.
 */
const JETBRAINS_BINARIES: Record<string, string> = {
  'idea64.exe': 'IntelliJ IDEA',
  'webstorm64.exe': 'WebStorm',
  'pycharm64.exe': 'PyCharm',
  'phpstorm64.exe': 'PhpStorm',
  'rider64.exe': 'Rider',
  'clion64.exe': 'CLion',
  'goland64.exe': 'GoLand',
  'rubymine64.exe': 'RubyMine',
  'datagrip64.exe': 'DataGrip',
  'rustrover64.exe': 'RustRover',
}

function scanForJetBrains(root: string, depth: number, found: Map<string, string>): void {
  if (depth < 0) return
  for (const entry of safeReadDir(root)) {
    const full = path.join(root, entry)
    let isDir = false
    try {
      isDir = fs.statSync(full).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    if (entry.toLowerCase() === 'bin') {
      for (const file of safeReadDir(full)) {
        const product = JETBRAINS_BINARIES[file.toLowerCase()]
        // Keep the first hit per product — roots are ordered newest-first.
        if (product && !found.has(product)) {
          found.set(product, path.join(full, file))
        }
      }
      continue
    }
    scanForJetBrains(full, depth - 1, found)
  }
}

function detectJetBrains(): DetectedItem[] {
  if (process.platform !== 'win32') return []

  const roots = [
    expandEnv('%LOCALAPPDATA%/Programs'),
    expandEnv('%LOCALAPPDATA%/JetBrains/Toolbox/apps'),
    expandEnv('%ProgramFiles%/JetBrains'),
    expandEnv('%ProgramFiles(x86)%/JetBrains'),
  ].filter((r): r is string => r !== null && fs.existsSync(r))

  const found = new Map<string, string>()
  for (const root of roots) {
    scanForJetBrains(root, 3, found)
  }

  return [...found].map(([product, exe]) => ({
    id: `jetbrains-${product.toLowerCase().replace(/\s+/g, '-')}`,
    label: product,
    path: exe,
    args: `"${TARGET_PATH_TOKEN}"`,
    group: 'editor' as const,
    console: false,
  }))
}

// ── Visual Studio ───────────────────────────────────────────────────────────

function detectVisualStudio(): DetectedItem[] {
  if (process.platform !== 'win32') return []

  const results: DetectedItem[] = []
  for (const base of ['%ProgramFiles%/Microsoft Visual Studio', '%ProgramFiles(x86)%/Microsoft Visual Studio']) {
    const root = expandEnv(base)
    if (root === null || !fs.existsSync(root)) continue
    for (const year of safeReadDir(root)) {
      for (const edition of safeReadDir(path.join(root, year))) {
        const exe = path.join(root, year, edition, 'Common7', 'IDE', 'devenv.exe')
        if (fs.existsSync(exe)) {
          results.push({
            id: `visual-studio-${year}`,
            label: `Visual Studio ${year}`,
            path: exe,
            args: `"${TARGET_PATH_TOKEN}"`,
            group: 'editor',
            console: false,
          })
        }
      }
    }
  }
  return results
}

// ── WSL distributions ───────────────────────────────────────────────────────

function runCapture(exe: string, args: string[], encoding: BufferEncoding): string {
  try {
    return cp.execFileSync(exe, args, { timeout: 5000, windowsHide: true }).toString(encoding)
  } catch {
    return ''
  }
}

/**
 * One entry per installed distro. `wsl --cd` accepts a Windows path and
 * translates it, so this works for repositories on either side of the divide.
 */
function detectWslDistros(): DetectedItem[] {
  if (process.platform !== 'win32') return []
  const wsl = expandEnv('%WINDIR%/System32/wsl.exe')
  if (wsl === null || !fs.existsSync(wsl)) return []

  // `wsl -l -q` writes UTF-16LE.
  const raw = runCapture(wsl, ['-l', '-q'], 'utf16le')
  const distros = raw
    .split(/\r?\n/)
    .map(line => line.replace(/\0/g, '').trim())
    .filter(line => line.length > 0)

  return distros.map(distro => ({
    id: `wsl-${distro.toLowerCase()}`,
    label: `WSL (${distro})`,
    path: wsl,
    args: `-d ${distro} --cd "${TARGET_PATH_TOKEN}"`,
    group: 'shell' as const,
    console: true,
  }))
}

// ── Detection entry point ───────────────────────────────────────────────────

/** Every launcher we can find on this machine, editors first. */
export function detectOpenWith(): DetectedItem[] {
  const results: DetectedItem[] = []

  for (const spec of candidateTable()) {
    const found = firstExisting(spec.paths)
    if (found === null) continue
    results.push({
      id: spec.id,
      label: spec.label,
      path: found,
      args: defaultArgsFor(spec.group, spec),
      group: spec.group,
      console: spec.console ?? false,
    })
  }

  results.push(...detectJetBrains(), ...detectVisualStudio(), ...detectWslDistros())

  const order = { editor: 0, shell: 1 }
  return results.sort((a, b) => order[a.group] - order[b.group] || a.label.localeCompare(b.label))
}

// ── Launching ───────────────────────────────────────────────────────────────

/** Split a command line on whitespace, honouring double quotes. */
function tokenizeArgs(commandLine: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  let started = false

  for (const ch of commandLine) {
    if (ch === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/.test(ch)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += ch
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

function expandTarget(tokens: readonly string[], targetPath: string): string[] {
  return tokens.map(token => token.split(TARGET_PATH_TOKEN).join(targetPath))
}

/** `.cmd` / `.bat` shims cannot be spawned directly on Windows. */
function needsShell(exe: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)
}

function waitForSpawn(child: cp.ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    // Keep this listener after `spawn` as well. A late child-process error must
    // never become an uncaught error in GitHub Desktop's main process.
    child.once('error', reject)
    child.unref()
  })
}

export async function launchOpenWith(
  item: OpenWithItem,
  targetPath: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!item.path) return { ok: false, reason: 'no_path' }
  if (!targetPath) return { ok: false, reason: 'no_target' }
  if (!fs.existsSync(item.path)) return { ok: false, reason: 'executable_missing' }

  const argsTemplate = item.args && item.args.trim() !== ''
    ? item.args
    : item.group === 'shell' ? '' : `"${TARGET_PATH_TOKEN}"`
  const args = expandTarget(tokenizeArgs(argsTemplate), targetPath)

  try {
    let child: cp.ChildProcess
    if (process.platform === 'win32' && (item.console || needsShell(item.path))) {
      // `start` gives console programs their own window and `/D` sets the
      // working directory without relying on spawn's cwd (which rejects UNC).
      const comspec = process.env.ComSpec || 'cmd.exe'
      const quoted = args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
      const line = `start "" /D "${targetPath}" "${item.path}" ${quoted}`.trim()
      child = cp.spawn(comspec, ['/d', '/s', '/c', line], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
        windowsHide: true,
      })
    } else if (process.platform === 'darwin' && item.path.endsWith('.app')) {
      child = cp.spawn('open', ['-a', item.path, ...args], {
        detached: true,
        stdio: 'ignore',
      })
    } else {
      // This mirrors GitHub Desktop's official editor launcher: detached,
      // ignored stdio, and unref after attaching the spawn/error listeners.
      child = cp.spawn(item.path, args, {
        detached: true,
        stdio: 'ignore',
        ...(item.group === 'shell' ? { cwd: targetPath } : {}),
      })
    }
    await waitForSpawn(child)
    gdpLog(`open-with: launched "${item.label}" for ${targetPath}`, 'info', 'system')
    return { ok: true }
  } catch (e) {
    gdpLog(`open-with: launching "${item.label}" failed: ${e}`, 'error', 'system')
    return { ok: false, reason: String(e) }
  }
}

/** Normalize a stored config entry, filling in anything the user left out. */
export function normalizeItem(raw: unknown, index: number): OpenWithItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const exePath = typeof r.path === 'string' ? r.path : ''
  if (exePath === '') return null

  const group = r.group === 'shell' ? 'shell' : 'editor'
  return {
    id: typeof r.id === 'string' && r.id !== '' ? r.id : `item-${index}`,
    label: typeof r.label === 'string' && r.label !== ''
      ? r.label
      : path.basename(exePath, path.extname(exePath)),
    path: exePath,
    args: typeof r.args === 'string' ? r.args : defaultArgsFor(group),
    group,
    console: r.console === true,
    enabled: r.enabled !== false,
  }
}

/** Suggest a display name for a manually picked executable. */
export function labelForExecutable(exePath: string): string {
  const base = path.basename(exePath, path.extname(exePath))
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** Where a "browse for an executable" dialog should start. */
export function defaultBrowseDir(): string {
  if (process.platform === 'win32') {
    return process.env['ProgramFiles'] ?? os.homedir()
  }
  if (process.platform === 'darwin') return '/Applications'
  return '/usr/bin'
}
