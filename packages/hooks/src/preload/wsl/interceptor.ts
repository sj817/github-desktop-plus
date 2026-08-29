import type {
  ChildProcess,
  ExecFileException,
  ExecFileOptions,
  SpawnOptions,
} from 'node:child_process'

import { WslAgentClient } from './agent-client'
import { isGitExecutable, parseWslRepositoryPath } from './path'

const childProcess = process.getBuiltinModule('node:child_process')

interface WslHookConfig {
  dataDir?: string
}

interface WslWindow extends Window {
  __GDP_CONFIG__?: WslHookConfig
}

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void

interface MutableChildProcessModule {
  spawn: (...args: unknown[]) => ChildProcess
  execFile: (...args: unknown[]) => ChildProcess
}

const INSTALL_MARK = Symbol.for('github-desktop-plus.wsl-git-interceptor')

function routedCwd(file: unknown, options: SpawnOptions | ExecFileOptions | undefined) {
  if (typeof file !== 'string' || !isGitExecutable(file) || typeof options?.cwd !== 'string') {
    return null
  }
  return parseWslRepositoryPath(options.cwd)
}

function normalizeSpawnCall(raw: unknown[]): {
  file: string
  args: string[]
  options: SpawnOptions
} | null {
  const file = raw[0]
  if (typeof file !== 'string') return null

  const second = raw[1]
  const third = raw[2]
  const args = Array.isArray(second) ? second : []
  if (!args.every(arg => typeof arg === 'string')) return null
  const options = (
    Array.isArray(second)
      ? (third && typeof third === 'object' ? third : {})
      : (second && typeof second === 'object' ? second : {})
  ) as SpawnOptions
  return { file, args, options }
}

function normalizeExecFileCall(raw: unknown[]): {
  file: string
  args: string[]
  options: ExecFileOptions
  callback: ExecFileCallback | undefined
} | null {
  const file = raw[0]
  if (typeof file !== 'string') return null

  let args: string[] = []
  let options: ExecFileOptions = {}
  let callback: ExecFileCallback | undefined
  for (const value of raw.slice(1)) {
    if (Array.isArray(value)) {
      if (!value.every(arg => typeof arg === 'string')) return null
      args = value
    } else if (typeof value === 'function') {
      callback = value as ExecFileCallback
    } else if (value && typeof value === 'object') {
      options = value as ExecFileOptions
    }
  }
  return { file, args, options, callback }
}

function outputValue(buffer: Buffer, encoding: BufferEncoding | 'buffer' | null | undefined) {
  return encoding === 'buffer' || encoding === null
    ? buffer
    : buffer.toString(encoding ?? 'utf8')
}

function commandError(
  file: string,
  args: readonly string[],
  code: number | null,
  signal: NodeJS.Signals | null,
  killed: boolean,
  stderr: Buffer,
): ExecFileException {
  const cmd = [file, ...args].join(' ')
  const detail = stderr.toString('utf8')
  const error = new Error(`Command failed: ${cmd}${detail ? `\n${detail}` : ''}`) as ExecFileException
  error.code = code ?? 'UNKNOWN'
  error.killed = killed
  if (signal !== null) error.signal = signal
  error.cmd = cmd
  return error
}

export function execFileWithAgent(
  client: WslAgentClient,
  file: string,
  args: readonly string[],
  linuxCwd: string,
  options: ExecFileOptions,
  callback: ExecFileCallback | undefined,
): ChildProcess {
  const child = client.spawn(file, args, linuxCwd, options)
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let stdoutLength = 0
  let stderrLength = 0
  let completed = false
  let overflowError: ExecFileException | undefined
  const maxBuffer = options.maxBuffer ?? 1024 * 1024

  const append = (chunks: Buffer[], chunk: Buffer, stream: 'stdout' | 'stderr') => {
    chunks.push(chunk)
    if (stream === 'stdout') stdoutLength += chunk.length
    else stderrLength += chunk.length
    if (!overflowError && Number.isFinite(maxBuffer) && Math.max(stdoutLength, stderrLength) > maxBuffer) {
      overflowError = Object.assign(
        new RangeError(`${stream} maxBuffer length exceeded`) as ExecFileException,
        { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, cmd: [file, ...args].join(' ') },
      )
      child.kill(options.killSignal ?? 'SIGTERM')
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => append(stdoutChunks, chunk, 'stdout'))
  child.stderr?.on('data', (chunk: Buffer) => append(stderrChunks, chunk, 'stderr'))

  let timeout: NodeJS.Timeout | undefined
  if (options.timeout && options.timeout > 0) {
    timeout = setTimeout(() => child.kill(options.killSignal ?? 'SIGTERM'), options.timeout)
    timeout.unref()
  }

  const abort = () => child.kill(options.killSignal ?? 'SIGTERM')
  options.signal?.addEventListener('abort', abort, { once: true })

  const finish = (error: ExecFileException | null) => {
    if (completed) return
    completed = true
    if (timeout) clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
    const stdout = Buffer.concat(stdoutChunks)
    const stderr = Buffer.concat(stderrChunks)
    callback?.(
      overflowError ?? error,
      outputValue(stdout, options.encoding as BufferEncoding | 'buffer' | null | undefined),
      outputValue(stderr, options.encoding as BufferEncoding | 'buffer' | null | undefined),
    )
  }

  child.once('error', error => finish(error as ExecFileException))
  child.once('close', (code, signal) => {
    const stderr = Buffer.concat(stderrChunks)
    finish(code === 0
      ? null
      : commandError(file, args, code, signal as NodeJS.Signals | null, child.killed, stderr))
  })
  return child
}

export function installWslGitInterceptor(): boolean {
  if (process.platform !== 'win32') return false

  const config = (window as WslWindow).__GDP_CONFIG__
  if (!config?.dataDir) return false

  const mutable = childProcess as unknown as MutableChildProcessModule & Record<PropertyKey, unknown>
  if (mutable[INSTALL_MARK]) return true

  const originalSpawn = mutable.spawn
  const originalExecFile = mutable.execFile
  const clients = new Map<string, WslAgentClient>()
  const getClient = (distro: string) => {
    const key = distro.toLowerCase()
    let client = clients.get(key)
    if (!client) {
      client = new WslAgentClient(distro, config.dataDir ?? '')
      clients.set(key, client)
    }
    return client
  }

  const patchedSpawn = (...raw: unknown[]): ChildProcess => {
    const call = normalizeSpawnCall(raw)
    const route = call ? routedCwd(call.file, call.options) : null
    const unsupportedStdio = call?.options.stdio !== undefined && call.options.stdio !== 'pipe'
    if (!call || !route || call.options.shell || call.options.detached || unsupportedStdio) {
      return Reflect.apply(originalSpawn, childProcess, raw) as ChildProcess
    }
    return getClient(route.distro).spawn(call.file, call.args, route.linuxPath, call.options)
  }

  const patchedExecFile = (...raw: unknown[]): ChildProcess => {
    const call = normalizeExecFileCall(raw)
    const route = call ? routedCwd(call.file, call.options) : null
    if (!call || !route || call.options.shell) {
      return Reflect.apply(originalExecFile, childProcess, raw) as ChildProcess
    }
    return execFileWithAgent(
      getClient(route.distro),
      call.file,
      call.args,
      route.linuxPath,
      call.options,
      call.callback,
    )
  }

  try {
    // Attempt direct property assignment first (works when properties are writable)
    mutable.spawn = patchedSpawn
    mutable.execFile = patchedExecFile
    mutable[INSTALL_MARK] = true
  } catch {
    try {
      // Fall back to defineProperties if assignments fail
      const spawnDesc = Object.getOwnPropertyDescriptor(mutable, 'spawn')
      const execDesc = Object.getOwnPropertyDescriptor(mutable, 'execFile')
      Object.defineProperties(mutable, {
        spawn: { configurable: spawnDesc?.configurable ?? true, enumerable: true, writable: true, value: patchedSpawn },
        execFile: { configurable: execDesc?.configurable ?? true, enumerable: true, writable: true, value: patchedExecFile },
        [INSTALL_MARK]: { configurable: false, enumerable: false, value: true },
      })
    } catch (e) {
      console.warn('[GDP WSL] Could not patch childProcess:', e)
      return false
    }
  }
  console.info('[GDP WSL] Native Git routing installed for WSL UNC repositories')
  return true
}

