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

  process.once('exit', () => {
    for (const child of children) child.kill()
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await stopGdp()
      locales.kill()
      process.exit(0)
    })
  }

  void watchForRestart('src/hooks', 'hook')
  void watchForRestart('src/gdp', 'gdp')
  void watchForRestart('src/core', 'core')

  await startGdp()
}

main().catch(error => {
  console.error('[dev] failed')
  console.error(error)
  process.exitCode = 1
})
