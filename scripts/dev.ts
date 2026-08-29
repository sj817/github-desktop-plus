import { stat } from 'node:fs/promises'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { watch, type FSWatcher } from 'chokidar'
import { execa, execaSync, type ResultPromise } from 'execa'
import { SETTINGS_DEV_URL } from '../apps/settings-ui/dev-config'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const isWin = process.platform === 'win32'
const gdpExe = path.join(rootDir, 'target', 'debug', isWin ? 'gdp.exe' : 'gdp')
const hookBundles = [
  'dist/main/index.cjs',
  'dist/preload/early.js',
  'dist/preload/renderer.js',
].map(file => path.join(rootDir, 'packages', 'hooks', file))

const children = new Set<ResultPromise>()
const watchers: FSWatcher[] = []
let gdpProcess: ResultPromise | null = null
let restarting = false
let restartTimer: ReturnType<typeof setTimeout> | undefined

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// Mirror of gdp_core::platform::config_dir() so we can find the daemon PID
// files without invoking the (lockable) gdp binary.
function gdpConfigDir(): string | null {
  if (isWin) {
    return process.env.APPDATA
      ? path.join(process.env.APPDATA, 'github-desktop-plus')
      : null
  }
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'github-desktop-plus')
  }
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'github-desktop-plus')
    : path.join(homedir(), '.config', 'github-desktop-plus')
}

// Kill a process recorded in one of GDP's PID files, directly — no `cargo run`.
// This is the crux of the HMR fix: `cargo run -- stop` would first rebuild
// gdp.exe, which is locked by the running daemon we're trying to stop, causing
// the recurring "access denied" deadlock. Do not add taskkill /T here: editors
// and terminals launched from Desktop are detached user processes and must
// survive a GDP hot restart.
function killByPidFile(file: string): void {
  const dir = gdpConfigDir()
  if (!dir) return
  const pidPath = path.join(dir, file)
  let pid: number
  try {
    pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
  } catch {
    return
  }
  if (!Number.isFinite(pid) || pid <= 0) return
  try {
    if (isWin) {
      execaSync('taskkill', ['/F', '/PID', String(pid)], {
        stdio: 'ignore',
        reject: false,
      })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // Already gone.
  }
  try {
    rmSync(pidPath)
  } catch {
    // noop
  }
}

// Poll until the gdp binary can be replaced (Windows holds an exclusive lock
// while the process runs). A rename to/from a temp name fails with EPERM/EBUSY
// while locked and succeeds once the handle is released. On unix a running
// binary can be replaced freely, so this returns immediately.
async function waitUntilUnlocked(file: string, timeoutMs = 8000): Promise<boolean> {
  if (!existsSync(file)) return true
  const tmp = `${file}.lockcheck`
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      renameSync(file, tmp)
      renameSync(tmp, file)
      return true
    } catch {
      await delay(150)
    }
  }
  return false
}

/**
 * Kill a child and everything it spawned. On Windows the children are started
 * through a shell, so `child.kill()` would only take out cmd.exe and leave the
 * Vite server holding port 5273 — the next `pnpm dev` would then fail on
 * strictPort.
 */
function killTree(child: ResultPromise | null): void {
  if (!child || child.nodeChildProcess.killed) return
  child.kill()
}

/** Poll until Vite answers, so the first dialog open never races the server. */
async function waitForDevServer(url: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) {
        console.log(`[dev] settings UI ready at ${url}`)
        return true
      }
    } catch {
      // Not listening yet.
    }
    await delay(200)
  }
  console.warn(`[dev] settings UI did not come up at ${url} — the dialog will show a blank frame`)
  return false
}

/** Wait for this tsdown watch process's initial build, not a stale dist tree. */
async function waitForHookBuild(startedAt: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ready = await Promise.all(
      hookBundles.map(async file => {
        try {
          return (await stat(file)).mtimeMs >= startedAt
        } catch {
          return false
        }
      })
    )
    if (ready.every(Boolean)) {
      console.log(`[dev] tsdown ready with ${hookBundles.length} hook bundles`)
      return
    }
    await delay(100)
  }
  throw new Error('tsdown did not finish the initial hook build before timeout')
}

interface CommandOptions {
  env?: NodeJS.ProcessEnv
  /** GDP manages Desktop/daemon PIDs itself; never sweep its external apps. */
  killDescendants?: boolean
}

function command(name: string, args: readonly string[], options: CommandOptions = {}): ResultPromise {
  const child = execa(name, args, {
    cwd: rootDir,
    stdio: 'inherit',
    cleanup: true,
    killDescendants: options.killDescendants ?? true,
    reject: false,
    env: {
      ...process.env,
      ...options.env,
    },
  })
  children.add(child)
  void child.finally(() => children.delete(child))
  return child
}

function pnpm(args: readonly string[]): ResultPromise {
  const execPath = process.env.npm_execpath
  return execPath && path.basename(execPath).startsWith('pnpm')
    ? command(process.execPath, [execPath, ...args])
    : command('pnpm', args)
}

async function stopGdp(): Promise<void> {
  // Stop the daemon + its GitHub Desktop directly via the PID files, then wait
  // for the OS to release the lock on gdp.exe so the next `cargo build` can
  // overwrite it. No manual close/reopen required.
  killByPidFile('gdp.pid')
  killByPidFile('gdp-daemon.pid')

  if (gdpProcess && !gdpProcess.nodeChildProcess.killed) {
    gdpProcess.kill()
  }
  gdpProcess = null

  const unlocked = await waitUntilUnlocked(gdpExe)
  if (!unlocked) {
    console.warn(`[dev] ${gdpExe} still locked after timeout — build may fail`)
  }
}

async function startGdp(): Promise<void> {
  gdpProcess = command('cargo', ['run', '-p', 'gdp', '--', 'dev'], {
    // stopGdp handles the two managed PID files explicitly. A descendant sweep
    // here would also catch IDEs and terminals opened by GitHub Desktop.
    killDescendants: false,
    env: {
      GDP_DEV: '1',
      // Tells the injected hook to load the settings dialog's UI from Vite in
      // an iframe instead of injecting the built bundle, so React/CSS edits
      // hot-reload without restarting anything.
      GDP_SETTINGS_DEV_URL: SETTINGS_DEV_URL,
    },
  })
}

async function restartGdp(reason: string): Promise<void> {
  if (restarting) return
  restarting = true
  console.log(`[dev] restarting GDP: ${reason}`)
  try {
    await stopGdp()
    await startGdp()
  } finally {
    restarting = false
  }
}

function scheduleRestart(reason: string): void {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartGdp(reason).catch(error => {
      console.error('[dev] restart failed')
      console.error(error)
    })
  }, 250)
}

function watchForRestart(
  dir: string,
  label: string,
  extensions: readonly string[] = ['.ts', '.rs', '.toml']
): FSWatcher {
  const full = path.join(rootDir, dir)
  const watcher = watch(full, {
    ignoreInitial: true,
    atomic: 200,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 },
  })
  watcher.on('all', (event, file) => {
    if (!['add', 'change', 'unlink'].includes(event)) return
    if (extensions.some(extension => file.endsWith(extension))) {
      scheduleRestart(`${label}: ${path.relative(full, file)}`)
    }
  })
  return watcher
}

async function main(): Promise<void> {
  const locales = command('tsx', ['scripts/locales.ts', 'watch', 'zh-CN'])

  // Long-lived: the settings UI is never a reason to restart GDP, so Vite keeps
  // running across GDP restarts and apps/settings-ui is not watched below.
  const settingsUi = pnpm(['--filter', '@github-desktop-plus/settings-ui', 'dev'])
  const hookBuildStartedAt = Date.now()
  const hooks = pnpm(['--filter', '@github-desktop-plus/hooks', 'dev'])
  await Promise.all([
    waitForDevServer(SETTINGS_DEV_URL),
    waitForHookBuild(hookBuildStartedAt),
  ])

  process.once('exit', () => {
    for (const child of children) killTree(child)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await stopGdp()
      killTree(locales)
      killTree(settingsUi)
      killTree(hooks)
      await Promise.all(watchers.map(watcher => watcher.close()))
      process.exit(0)
    })
  }

  // tsdown watches hook + shared sources; GDP restarts only after a complete
  // output bundle lands, never halfway through a source edit.
  watchers.push(
    watchForRestart('packages/hooks/dist', 'hook bundle', ['.js', '.cjs']),
    watchForRestart('apps/gdp', 'gdp'),
    watchForRestart('crates/gdp-core', 'core')
  )

  await startGdp()
}

main().catch(error => {
  console.error('[dev] failed')
  console.error(error)
  process.exitCode = 1
})
