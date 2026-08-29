import { spawn, spawnSync } from 'node:child_process'
import { watch } from 'node:fs/promises'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const isWin = process.platform === 'win32'
const gdpExe = path.join(rootDir, 'target', 'debug', isWin ? 'gdp.exe' : 'gdp')

const children = new Set()
let gdpProcess = null
let restarting = false
let restartTimer

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Mirror of gdp_core::platform::config_dir() so we can find the daemon PID
// files without invoking the (lockable) gdp binary.
function gdpConfigDir() {
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
// the recurring "access denied" deadlock. Killing by PID needs no build.
function killByPidFile(file) {
  const dir = gdpConfigDir()
  if (!dir) return
  const pidPath = path.join(dir, file)
  let pid
  try {
    pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
  } catch {
    return
  }
  if (!Number.isFinite(pid) || pid <= 0) return
  try {
    if (isWin) {
      // /T also kills GitHub Desktop if it is a child of the daemon.
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
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
async function waitUntilUnlocked(file, timeoutMs = 8000) {
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
 * Vite dev server for the settings UI. Must match `server.port` in
 * src/settings-ui/vite.config.ts.
 */
const SETTINGS_DEV_URL = 'http://127.0.0.1:5273/'

/**
 * Kill a child and everything it spawned. On Windows the children are started
 * through a shell, so `child.kill()` would only take out cmd.exe and leave the
 * Vite server holding port 5273 — the next `pnpm dev` would then fail on
 * strictPort.
 */
function killTree(child) {
  if (!child || child.killed) return
  if (isWin && child.pid) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
    return
  }
  child.kill()
}

/** Poll until Vite answers, so the first dialog open never races the server. */
async function waitForDevServer(url, timeoutMs = 30000) {
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

function command(name, args, options = {}) {
  const child = spawn(name, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...options.env,
    },
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

function run(name, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = command(name, args, options)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${name} ${args.join(' ')} exited with ${code}`))
    })
  })
}

async function stopGdp() {
  // Stop the daemon + its GitHub Desktop directly via the PID files, then wait
  // for the OS to release the lock on gdp.exe so the next `cargo build` can
  // overwrite it. No manual close/reopen required.
  killByPidFile('gdp.pid')
  killByPidFile('gdp-daemon.pid')

  if (gdpProcess && !gdpProcess.killed) {
    gdpProcess.kill()
  }
  gdpProcess = null

  const unlocked = await waitUntilUnlocked(gdpExe)
  if (!unlocked) {
    console.warn(`[dev] ${gdpExe} still locked after timeout — build may fail`)
  }
}

async function startGdp() {
  await run('pnpm', ['run', 'build:hooks'])
  await run('node', ['scripts/locales.mjs', 'prepare', 'zh-CN'])
  gdpProcess = command('cargo', ['run', '-p', 'gdp', '--', 'dev'], {
    env: {
      GDP_DEV: '1',
      // Tells the injected hook to load the settings dialog's UI from Vite in
      // an iframe instead of injecting the built bundle, so React/CSS edits
      // hot-reload without restarting anything.
      GDP_SETTINGS_DEV_URL: SETTINGS_DEV_URL,
    },
  })
}

async function restartGdp(reason) {
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

function scheduleRestart(reason) {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartGdp(reason).catch(error => {
      console.error('[dev] restart failed')
      console.error(error)
    })
  }, 250)
}

async function watchForRestart(dir, label) {
  const full = path.join(rootDir, dir)
  for await (const event of watch(full, { recursive: true })) {
    const file = String(event.filename ?? '')
    if (!file) continue
    if (file.endsWith('.ts') || file.endsWith('.rs') || file.endsWith('.toml')) {
      scheduleRestart(`${label}: ${file}`)
    }
  }
}

async function main() {
  const locales = command('node', ['scripts/locales.mjs', 'watch', 'zh-CN'], {
    env: { GDP_NOTIFY_RUNTIME: '1' },
  })

  // Long-lived: the settings UI is never a reason to restart GDP, so Vite keeps
  // running across GDP restarts and src/settings-ui is not watched below.
  const settingsUi = command('pnpm', ['--filter', 'gdp-settings-ui', 'dev'])
  await waitForDevServer(SETTINGS_DEV_URL)

  process.once('exit', () => {
    for (const child of children) killTree(child)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await stopGdp()
      killTree(locales)
      killTree(settingsUi)
      process.exit(0)
    })
  }

  void watchForRestart('src/hooks', 'hook')
  // The IPC contract is shared with the settings UI, but the hook bundles it —
  // a change there still needs a GDP restart.
  void watchForRestart('src/shared', 'shared')
  void watchForRestart('src/gdp', 'gdp')
  void watchForRestart('src/core', 'core')

  await startGdp()
}

main().catch(error => {
  console.error('[dev] failed')
  console.error(error)
  process.exitCode = 1
})
