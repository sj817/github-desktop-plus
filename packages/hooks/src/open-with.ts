/**
 * "Open with" targets — detection and launching, main process side.
 *
 * GitHub Desktop only ever exposes ONE external editor and ONE shell in its
 * repository context menu (whichever pair is selected in its own settings).
 * GDP lets the user configure any number of them; this module finds the
 * installed candidates and launches the one the user picked.
 *
 * The renderer half (preload/open-with.ts) injects the menu entries and calls
 * `gdp:open-with-launch` with the item id and repository or file target.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as cp from 'child_process'
import { gdpLog } from './logger'
import type { OpenWithLaunchRequest } from '@github-desktop-plus/shared'
import { parseWslRepositoryPath } from './preload/wsl/path'

/** Placeholder replaced with the editor's file/folder or shell's directory. */
export const TARGET_PATH_TOKEN = '%TARGET_PATH%'

export interface OpenWithItem {
  id: string
  label: string
  path: string
  /** `%TARGET_PATH%` is the selected file for editors, its directory for shells. */
  args: string
  /** 'editor' | 'shell' — decides which native entry the item sits next to. */
  group: string
  /** Give console programs their own visible window on Windows. */
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

/** `fs.existsSync` stats the target, which fails for app execution aliases
 * such as WindowsApps\pwsh.exe; access() only needs the reparse point. */
function pathExists(file: string): boolean {
  try {
    fs.accessSync(file)
    return true
  } catch {
    return false
  }
}

function firstExisting(templates: readonly string[]): string | null {
  for (const template of templates) {
    const candidate = expandEnv(template)
    if (candidate !== null && pathExists(candidate)) {
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
      // Microsoft Store install; the alias survives version updates.
      '%LOCALAPPDATA%/Microsoft/WindowsApps/pwsh.exe',
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
  { id: 'warp', label: 'Warp', group: 'shell', paths: ['/Applications/Warp.app'] },
  { id: 'ghostty', label: 'Ghostty', group: 'shell', paths: ['/Applications/Ghostty.app'] },
  ...[
    ['idea', 'IntelliJ IDEA', 'IntelliJ IDEA'],
    ['webstorm', 'WebStorm', 'WebStorm'],
    ['pycharm', 'PyCharm', 'PyCharm'],
    ['phpstorm', 'PhpStorm', 'PhpStorm'],
    ['rider', 'Rider', 'Rider'],
    ['clion', 'CLion', 'CLion'],
    ['goland', 'GoLand', 'GoLand'],
    ['rubymine', 'RubyMine', 'RubyMine'],
    ['datagrip', 'DataGrip', 'DataGrip'],
    ['rustrover', 'RustRover', 'RustRover'],
  ].map(([id, label, name]): CandidateSpec => ({
    id: `jetbrains-${id}`,
    label: label!,
    group: 'editor',
    paths: [`/Applications/${name}.app`],
  })),
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
  if (process.platform === 'darwin') {
    return DARWIN_CANDIDATES.map(spec => ({
      ...spec,
      paths: spec.paths.flatMap(candidate => candidate.startsWith('/Applications/')
        ? [candidate, path.join(os.homedir(), 'Applications', path.basename(candidate))]
        : [candidate]),
    }))
  }
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

/** Visual Studio 2026 installs under its major version rather than its year. */
const VISUAL_STUDIO_FOLDER_YEARS: Record<string, string> = { '18': '2026' }

function detectVisualStudio(): DetectedItem[] {
  if (process.platform !== 'win32') return []

  const results: DetectedItem[] = []
  for (const base of ['%ProgramFiles%/Microsoft Visual Studio', '%ProgramFiles(x86)%/Microsoft Visual Studio']) {
    const root = expandEnv(base)
    if (root === null || !fs.existsSync(root)) continue
    for (const year of safeReadDir(root)) {
      for (const edition of safeReadDir(path.join(root, year))) {
        const exe = path.join(root, year, edition, 'Common7', 'IDE', 'devenv.exe')
        if (pathExists(exe)) {
          results.push({
            id: `visual-studio-${year}`,
            label: `Visual Studio ${VISUAL_STUDIO_FOLDER_YEARS[year] ?? year}`,
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
  if (wsl === null || !pathExists(wsl)) return []

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
    args: `-d "${distro}" --cd "${TARGET_PATH_TOKEN}"`,
    group: 'shell' as const,
    console: true,
  }))
}

// ── Installed applications (Windows) ────────────────────────────────────────

/**
 * One record from an installer entry, App Paths or a Start menu / desktop
 * shortcut. Editors installed outside the path templates above (another
 * drive, a portable folder) are only findable through these.
 */
export interface InstalledApp {
  name?: string
  /** Executable or DisplayIcon value, possibly quoted and with an icon index. */
  exe?: string
  /** InstallLocation, for installers that record no executable. */
  dir?: string
}

const INSTALLED_APPS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$apps = [Collections.Generic.List[object]]::new()
foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall') {
  foreach ($key in Get-ChildItem $root) {
    $name = $key.GetValue('DisplayName')
    if ($name) { $apps.Add(@{ name = [string]$name; exe = [string]$key.GetValue('DisplayIcon'); dir = [string]$key.GetValue('InstallLocation') }) }
  }
}
foreach ($root in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths') {
  foreach ($key in Get-ChildItem $root) { $apps.Add(@{ exe = [string]$key.GetValue('') }) }
}
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in 'StartMenu', 'CommonStartMenu', 'Desktop', 'CommonDesktopDirectory') {
  $dir = [Environment]::GetFolderPath($folder)
  if ($dir) {
    foreach ($link in Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse) {
      $apps.Add(@{ name = $link.BaseName; exe = $shell.CreateShortcut($link.FullName).TargetPath })
    }
  }
}
ConvertTo-Json -InputObject $apps.ToArray() -Compress
`

/** Registry and shortcut data, read in one PowerShell run so non-ASCII paths
 * arrive intact (reg.exe prints in the OEM code page). */
export async function readInstalledApps(): Promise<InstalledApp[]> {
  const powershell = expandEnv('%SystemRoot%/System32/WindowsPowerShell/v1.0/powershell.exe')
  if (powershell === null) return []
  const encoded = Buffer.from(INSTALLED_APPS_SCRIPT, 'utf16le').toString('base64')
  const stdout = await new Promise<string>((resolve, reject) => {
    cp.execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      (error, out) => error ? reject(error) : resolve(out),
    )
  })
  const parsed: unknown = JSON.parse(stdout.trim() || '[]')
  return Array.isArray(parsed) ? parsed.filter((app): app is InstalledApp => !!app && typeof app === 'object') : []
}

/** Editors recognised by executable name beyond those in the path table;
 * VS Code forks and JetBrains IDEs are recognised from their product files. */
const KNOWN_EDITOR_EXES: Record<string, { id: string; label: string }> = {
  'typora.exe': { id: 'typora', label: 'Typora' },
  'marktext.exe': { id: 'marktext', label: 'MarkText' },
  'devenv.exe': { id: 'visual-studio', label: 'Visual Studio' },
}

let knownExes: Map<string, DetectedItem> | undefined

/** Executable name → launcher template, from the path table plus extras. */
function knownExecutables(): Map<string, DetectedItem> {
  if (knownExes) return knownExes
  knownExes = new Map()
  for (const spec of WIN32_CANDIDATES) {
    for (const template of spec.paths) {
      const name = path.win32.basename(template).toLowerCase()
      if (!knownExes.has(name)) {
        knownExes.set(name, { id: spec.id, label: spec.label, path: '', args: defaultArgsFor(spec.group, spec), group: spec.group, console: spec.console ?? false })
      }
    }
  }
  for (const [name, editor] of Object.entries(KNOWN_EDITOR_EXES)) {
    knownExes.set(name, { ...editor, path: '', args: defaultArgsFor('editor'), group: 'editor', console: false })
  }
  return knownExes
}

function exists(file: string): Promise<boolean> {
  return fs.promises.access(file).then(() => true, () => false)
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** VS Code and its forks keep resources\app\product.json next to the exe, or
 * in a per-commit folder such as `7cc5e7382b\` in newer builds. */
async function vscodeProduct(dir: string): Promise<Record<string, unknown> | null> {
  const direct = await readJsonObject(path.join(dir, 'resources', 'app', 'product.json'))
  if (direct) return direct
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f]{10}$/i.test(entry.name)) continue
    const nested = await readJsonObject(path.join(dir, entry.name, 'resources', 'app', 'product.json'))
    if (nested) return nested
  }
  return null
}

/** JetBrains IDEs describe their launchers in product-info.json at the root. */
function jetbrainsLaunchers(info: Record<string, unknown> | null): string[] {
  const launch: unknown = info?.launch
  if (!Array.isArray(launch)) return []
  return launch.map(entry => (entry as Record<string, unknown> | null)?.launcherPath).filter((p): p is string => typeof p === 'string' && /\.exe$/i.test(p))
}

/** `"C:\a b\x.exe",0` → `C:\a b\x.exe`; anything other than an absolute .exe is dropped. */
export function executableFromValue(value: string): string | null {
  const unquoted = value.trim().replace(/,\s*-?\d+$/, '').trim().replace(/^"(.*)"$/, '$1').trim()
  if (!/\.exe$/i.test(unquoted) || !targetPathApi(unquoted).isAbsolute(unquoted)) return null
  return path.normalize(unquoted)
}

/** Executables worth classifying inside an InstallLocation. */
async function executablesInInstallDir(dir: string): Promise<string[]> {
  const product = await vscodeProduct(dir)
  if (typeof product?.nameShort === 'string') return [path.join(dir, `${product.nameShort}.exe`)]
  const launchers = jetbrainsLaunchers(await readJsonObject(path.join(dir, 'product-info.json')))
  if (launchers.length > 0) return launchers.map(launcher => path.join(dir, launcher))
  const known = knownExecutables()
  const entries = await fs.promises.readdir(dir).catch(() => [] as string[])
  return entries.filter(name => known.has(name.toLowerCase())).map(name => path.join(dir, name))
}

async function classifyExecutable(exe: string): Promise<DetectedItem | null> {
  // Store packages live in versioned folders, and their WindowsApps alias is
  // what keeps working after an update. SysWOW64 only holds 32-bit duplicates.
  if (/[\\/](?:Program Files[\\/]WindowsApps|SysWOW64)[\\/]/i.test(exe) || !await exists(exe)) return null
  const name = path.basename(exe).toLowerCase()
  const known = knownExecutables().get(name)
  if (known) return { ...known, path: exe }

  const editor = { path: exe, args: defaultArgsFor('editor'), group: 'editor' as const, console: false }
  const jetbrains = JETBRAINS_BINARIES[name]
  if (jetbrains) {
    const info = await readJsonObject(path.join(path.dirname(path.dirname(exe)), 'product-info.json'))
    const product = typeof info?.name === 'string' ? info.name : jetbrains
    return { ...editor, id: `jetbrains-${product.toLowerCase().replace(/\s+/g, '-')}`, label: product }
  }

  // The exe must be the product's own, not an uninstaller sitting beside it.
  const product = await vscodeProduct(path.dirname(exe))
  const stem = path.basename(exe, path.extname(exe)).toLowerCase()
  const names = [product?.nameShort, product?.win32ExeBasename, product?.nameLong].filter((n): n is string => typeof n === 'string')
  if (!product || !names.some(n => n.toLowerCase() === stem)) return null
  const label = typeof product.nameLong === 'string' ? product.nameLong : names[0]!
  const id = typeof product.applicationName === 'string' ? product.applicationName : stem.replace(/\s+/g, '-')
  return { ...editor, id, label }
}

/** Keep the installed applications that are recognisably editors or shells. */
export async function classifyInstalledApps(apps: readonly InstalledApp[]): Promise<DetectedItem[]> {
  const executables = new Map<string, string>()
  const add = (exe: string) => {
    const key = exe.toLowerCase()
    if (!executables.has(key)) executables.set(key, exe)
  }
  for (const app of apps) {
    const exe = typeof app.exe === 'string' ? executableFromValue(app.exe) : null
    if (exe) add(exe)
  }
  const fromDirs = await Promise.all(apps.map(app => {
    const dir = typeof app.dir === 'string' ? app.dir.trim().replace(/^"(.*)"$/, '$1') : ''
    return dir && path.isAbsolute(dir) ? executablesInInstallDir(dir) : []
  }))
  for (const found of fromDirs.flat()) add(found)
  const classified = await Promise.all([...executables.values()].map(classifyExecutable))
  return classified.filter((item): item is DetectedItem => item !== null)
}

// ── Detection entry point ───────────────────────────────────────────────────

/** Every launcher we can find on this machine, editors first. */
export async function detectOpenWith(): Promise<DetectedItem[]> {
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

  if (process.platform === 'win32') {
    // WSL distros share wsl.exe, so only installed apps are deduplicated by path.
    const seen = new Set(results.map(item => item.path.toLowerCase()))
    try {
      for (const item of await classifyInstalledApps(await readInstalledApps())) {
        const key = item.path.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        results.push(item)
      }
    } catch (e) {
      gdpLog(`open-with: scanning installed applications failed: ${e}`, 'warn', 'system')
    }
  }

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

function targetPathApi(value: string): typeof path.win32 {
  return /^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(value) ? path.win32 : path.posix
}

/** File targets must remain inside the model's repository, including UNC roots. */
export function resolveOpenWithTarget(request: OpenWithLaunchRequest): { path: string; kind: 'file' | 'repository' } | null {
  if (typeof request.path !== 'string' || !request.path || request.path.includes('\0')) return null
  if (request.kind !== undefined && request.kind !== 'repository' && request.kind !== 'file') return null
  if (request.kind !== 'file') {
    return targetPathApi(request.path).isAbsolute(request.path) ? { path: request.path, kind: 'repository' } : null
  }
  const root = request.repositoryPath
  if (typeof root !== 'string' || !root || root.includes('\0')) return null
  const api = targetPathApi(root)
  if (!api.isAbsolute(root) || api.isAbsolute(request.path)) return null
  const fullPath = api.resolve(root, request.path)
  const relative = api.relative(root, fullPath)
  if (!relative || relative === '..' || relative.startsWith('..' + api.sep) || api.isAbsolute(relative)) return null
  return { path: fullPath, kind: 'file' }
}

export interface OpenWithCommand {
  command: string
  args: string[]
  options: cp.SpawnOptions
}

const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3

/** The PE header's Subsystem field, or null when the file is not a readable PE image. */
function peSubsystem(exe: string): number | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(exe, 'r')
    const header = Buffer.alloc(1024)
    const read = fs.readSync(fd, header, 0, header.length, 0)
    if (read < 0x40 || header.readUInt16LE(0) !== 0x5a4d) return null
    // Signature (4) + COFF header (20) put the optional header at pe + 24;
    // Subsystem sits at offset 68 of it for both PE32 and PE32+.
    const pe = header.readUInt32LE(0x3c)
    if (pe + 24 + 70 > read || header.readUInt32LE(pe) !== 0x00004550) return null
    return header.readUInt16LE(pe + 24 + 68)
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Separate argv from display paths. This also keeps file names with shell
 * metacharacters out of cmd.exe when launching ordinary .exe applications. */
export function buildOpenWithCommand(
  item: OpenWithItem,
  targetPath: string,
  kind: 'repository' | 'file' = 'repository',
  platform: NodeJS.Platform = process.platform,
): OpenWithCommand {
  const api = targetPathApi(targetPath)
  const directory = kind === 'file' ? api.dirname(targetPath) : targetPath
  let expandedTarget = item.group === 'shell' ? directory : targetPath
  const argsTemplate = item.args && item.args.trim() !== ''
    ? item.args : item.group === 'shell' ? '' : `"${TARGET_PATH_TOKEN}"`
  let tokens = tokenizeArgs(argsTemplate)
  const wsl = platform === 'win32' && path.win32.basename(item.path).toLowerCase() === 'wsl.exe'
  const wslPath = wsl ? parseWslRepositoryPath(expandedTarget) : null
  if (wslPath) {
    const distroIndex = tokens.findIndex(token => token === '-d' || token === '--distribution')
    const distro = distroIndex >= 0 ? tokens[distroIndex + 1] : tokens.find(token => token.startsWith('--distribution='))?.slice('--distribution='.length)
    if (distro && distro.toLowerCase() !== wslPath.distro.toLowerCase()) throw new Error(`文件位于 ${wslPath.distro}，请选择对应的 WSL 终端`)
    if (!distro) tokens = ['-d', wslPath.distro, ...tokens]
    expandedTarget = wslPath.linuxPath
    if (!tokens.some(token => token === '--cd' || token.startsWith('--cd='))) tokens = ['--cd', expandedTarget, ...tokens]
  }
  const args = expandTarget(tokens, expandedTarget)
  const options: cp.SpawnOptions = { detached: true, stdio: 'ignore' }
  // windowsHide also puts SW_HIDE into STARTUPINFO, and GUI programs apply it
  // to their first window: VS Code then opens with its window hidden. Only
  // console programs the user did not ask to see get hidden.
  if (platform === 'win32') options.windowsHide = !item.console && peSubsystem(item.path) === IMAGE_SUBSYSTEM_WINDOWS_CUI

  if (platform === 'win32' && /\.(cmd|bat)$/i.test(item.path)) {
    // Batch shims require cmd.exe; reject path characters which cmd expands
    // even inside quotes, rather than letting a file name become shell syntax.
    if (/["%\r\n]/.test(targetPath)) throw new Error('此文件路径不能通过批处理启动器打开，请选择程序的 .exe')
    const quoted = args.map(arg => `"${arg.replaceAll('"', '\\"')}"`).join(' ')
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `start "" /D "${directory}" "${item.path}" ${quoted}`.trim()],
      options: { ...options, windowsVerbatimArguments: true, windowsHide: true },
    }
  }
  if (platform === 'darwin' && item.path.endsWith('.app')) {
    // Native terminals open directories through Apple events; a child's cwd
    // does not change an already-running terminal's working directory.
    const nativeTarget = args.length === 0 || (args.length === 1 && args[0] === expandedTarget)
    return {
      command: '/usr/bin/open',
      args: ['-a', item.path, ...(nativeTarget ? [expandedTarget] : ['--args', ...args])],
      options,
    }
  }
  // On Windows detached console programs receive their own window. WSL's
  // --cd handles Windows drive paths; UNC paths use the Linux path above.
  if (item.group === 'shell') options.cwd = wslPath ? os.homedir() : directory
  return { command: item.path, args, options }
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
  kind: 'repository' | 'file' = 'repository',
): Promise<{ ok: boolean; reason?: string }> {
  if (!item.path) return { ok: false, reason: 'no_path' }
  if (!targetPath) return { ok: false, reason: 'no_target' }
  if (!await fs.promises.access(item.path).then(() => true, () => false)) {
    gdpLog(`open-with: "${item.label}" not found at ${item.path}`, 'warn', 'system')
    return { ok: false, reason: 'executable_missing' }
  }

  try {
    const launch = buildOpenWithCommand(item, targetPath, kind)
    const child = cp.spawn(launch.command, launch.args, launch.options)
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
