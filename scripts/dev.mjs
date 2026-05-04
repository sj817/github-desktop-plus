import { spawn } from 'node:child_process'
import { watch } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const controlOrigin = process.env.GDP_CONTROL_ORIGIN ?? 'http://127.0.0.1:5173'

const children = new Set()
let gdpProcess = null
let restarting = false
let restartTimer

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
  try {
    await run('cargo', ['run', '-p', 'gdp', '--', 'stop'])
  } catch {
    // Best effort: dev restarts should keep moving even if nothing is running.
  }

  if (gdpProcess && !gdpProcess.killed) {
    gdpProcess.kill()
  }
  gdpProcess = null
}

async function startGdp() {
  await run('pnpm', ['run', 'build:hooks'])
  await run('node', ['scripts/locales.mjs', 'prepare', 'zh-CN'])
  gdpProcess = command('cargo', ['run', '-p', 'gdp', '--', 'dev'], {
    env: {
      GDP_DEV: '1',
      GDP_CONTROL_ORIGIN: controlOrigin,
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
  const vite = command('pnpm', ['--dir', 'webui', 'run', 'dev', '--host', '127.0.0.1'])
  const locales = command('node', ['scripts/locales.mjs', 'watch', 'zh-CN'], {
    env: { GDP_NOTIFY_RUNTIME: '1' },
  })

  process.once('exit', () => {
    for (const child of children) child.kill()
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await stopGdp()
      vite.kill()
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
