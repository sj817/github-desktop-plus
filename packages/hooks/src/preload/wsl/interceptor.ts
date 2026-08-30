import type {
  ChildProcess,
  ExecFileException,
  ExecFileOptions,
  SpawnOptions,
} from 'node:child_process'

import {
  getWslAgentClient,
  type WslAgentClient,
  type WslAgentSpawnOptions,
} from './agent-client'
import { isGitExecutable, parseWslRepositoryPath } from './path'

const childProcess = process.getBuiltinModule('node:child_process')
const timers = process.getBuiltinModule('node:timers')

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

type ExecFileFunction = (...args: unknown[]) => ChildProcess

const CUSTOM_PROMISIFY = Symbol.for('nodejs.util.promisify.custom')

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
  // Node's execFile defaults to UTF-8 and applies that encoding to the live
  // stdout/stderr streams before returning the ChildProcess. GitHub Desktop's
  // progress callbacks rely on that behavior when piping stderr through byline.
  const outputEncoding = (
    options.encoding === undefined ? 'utf8' : options.encoding
  ) as Exclude<WslAgentSpawnOptions['encoding'], undefined>
  const child = client.spawn(file, args, linuxCwd, {
    ...options,
    encoding: outputEncoding,
  } as WslAgentSpawnOptions)
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let stdoutLength = 0
  let stderrLength = 0
  let completed = false
  let overflowError: ExecFileException | undefined
  const maxBuffer = options.maxBuffer ?? 1024 * 1024

  const append = (chunks: Buffer[], chunk: Buffer | string, stream: 'stdout' | 'stderr') => {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, outputEncoding === 'buffer' || outputEncoding === null
        ? 'utf8'
        : outputEncoding)
    chunks.push(bytes)
    if (stream === 'stdout') stdoutLength += bytes.length
    else stderrLength += bytes.length
    if (!overflowError && Number.isFinite(maxBuffer) && Math.max(stdoutLength, stderrLength) > maxBuffer) {
      overflowError = Object.assign(
        new RangeError(`${stream} maxBuffer length exceeded`) as ExecFileException,
        { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, cmd: [file, ...args].join(' ') },
      )
      child.kill(options.killSignal ?? 'SIGTERM')
    }
  }

  child.stdout?.on('data', (chunk: Buffer | string) => append(stdoutChunks, chunk, 'stdout'))
  child.stderr?.on('data', (chunk: Buffer | string) => append(stderrChunks, chunk, 'stderr'))

  let timeout: NodeJS.Timeout | undefined
  if (options.timeout && options.timeout > 0) {
    timeout = timers.setTimeout(() => child.kill(options.killSignal ?? 'SIGTERM'), options.timeout)
    timeout.unref()
  }

  const abort = () => child.kill(options.killSignal ?? 'SIGTERM')
  options.signal?.addEventListener('abort', abort, { once: true })

  const finish = (error: ExecFileException | null) => {
    if (completed) return
    completed = true
    if (timeout) timers.clearTimeout(timeout)
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

/**
 * Node's native execFile has a custom promisify implementation which resolves
 * to `{ stdout, stderr }`. Replacing the function drops that symbol by default,
 * so consumers such as GitHub Desktop would receive only stdout and then fail
 * while destructuring the expected object.
 */
export function preserveExecFilePromisifyContract(execFile: ExecFileFunction): void {
  const promisified = (...raw: unknown[]) => new Promise<{
    stdout: string | Buffer
    stderr: string | Buffer
  }>((resolve, reject) => {
    const callback: ExecFileCallback = (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
      } else {
        resolve({ stdout, stderr })
      }
    }
    Reflect.apply(execFile, childProcess, [...raw, callback])
  })

  Object.defineProperty(execFile, CUSTOM_PROMISIFY, {
    configurable: true,
    value: promisified,
  })
}

export function installWslGitInterceptor(): boolean {
  if (process.platform !== 'win32') return false

  const config = (window as WslWindow).__GDP_CONFIG__
  if (!config?.dataDir) return false

  const mutable = childProcess as unknown as MutableChildProcessModule & Record<PropertyKey, unknown>
  if (mutable[INSTALL_MARK]) return true

  const originalSpawn = mutable.spawn
  const originalExecFile = mutable.execFile
  const getClient = (distro: string) => getWslAgentClient(distro, config.dataDir ?? '')

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

  preserveExecFilePromisifyContract(patchedExecFile)

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
