import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  encodeWslFrame,
  encodeWslJsonFrame,
  WSL_PROTOCOL_VERSION,
  WslFrameKind,
  WslFrameParser,
  type WslFrame,
} from './protocol'
import { portableGitEnvironment, translateGitArgument } from './path'
import { syncWindowsGitConfiguration } from './git-config'
import {
  VirtualChildProcess,
  type AgentErrorPayload,
  type AgentExitPayload,
  type VirtualChildTransport,
  type VirtualChildOutputEncoding,
} from './virtual-child'

const childProcess = process.getBuiltinModule('node:child_process')
const timers = process.getBuiltinModule('node:timers')
const IO_CHUNK_SIZE = 64 * 1024
const HEARTBEAT_INTERVAL_MS = 15_000

interface HelloResponse {
  version: number
  agentVersion: string
  os: string
  arch: string
}

interface SpawnResponse {
  pid: number
}

interface SpawnRequest {
  args: string[]
  cwd: string
  env: Record<string, string>
}

export interface WslAgentSpawnOptions extends SpawnOptions {
  encoding?: VirtualChildOutputEncoding
}

interface AgentConnection {
  process: ChildProcess
  input: NodeJS.WritableStream
  hello: HelloResponse
  heartbeat: NodeJS.Timeout
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function parseJson<T>(frame: WslFrame): T {
  return JSON.parse(frame.payload.toString('utf8')) as T
}

function wslExecutable(): string {
  const systemRoot = process.env.SystemRoot
  return systemRoot ? path.join(systemRoot, 'System32', 'wsl.exe') : 'wsl.exe'
}

function execFileText(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      file,
      [...args],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()),
    )
  })
}

function agentAssetPath(dataDir: string): string {
  const target = process.arch === 'arm64'
    ? 'aarch64-unknown-linux-gnu'
    : 'x86_64-unknown-linux-gnu'
  return path.join(dataDir, 'agents', target, 'gdp-wsl-agent')
}

async function deployAgent(distro: string, dataDir: string): Promise<string> {
  const source = agentAssetPath(dataDir)
  const sourceBytes = fs.readFileSync(source)
  if (sourceBytes.length < 4 || sourceBytes.subarray(0, 4).toString('hex') !== '7f454c46') {
    throw Object.assign(new Error(`WSL agent asset is not a Linux ELF binary: ${source}`), {
      code: 'GDP_WSL_AGENT_MISSING',
    })
  }

  const home = await execFileText(wslExecutable(), ['-d', distro, '--exec', 'printenv', 'HOME'])
  if (!home.startsWith('/')) {
    throw new Error(`WSL returned an invalid HOME for ${distro}: ${home}`)
  }

  const digest = createHash('sha256').update(sourceBytes).digest('hex').slice(0, 16)
  const linuxDirectory = `${home}/.local/share/github-desktop-plus/agents/${digest}`
  const linuxPath = `${linuxDirectory}/gdp-wsl-agent`
  const uncDirectory = `\\\\wsl.localhost\\${distro}${linuxDirectory.replaceAll('/', '\\')}`
  const uncPath = path.join(uncDirectory, 'gdp-wsl-agent')

  fs.mkdirSync(uncDirectory, { recursive: true })
  const currentSize = fs.statSync(source).size
  if (!fs.existsSync(uncPath) || fs.statSync(uncPath).size !== currentSize) {
    fs.copyFileSync(source, uncPath)
  }
  await execFileText(wslExecutable(), ['-d', distro, '--exec', 'chmod', '755', linuxPath])
  await syncWindowsGitConfiguration(distro, home)
  return linuxPath
}

function signalName(signal: NodeJS.Signals | number): NodeJS.Signals {
  if (typeof signal === 'string') return signal
  return signal === 9 ? 'SIGKILL' : signal === 2 ? 'SIGINT' : 'SIGTERM'
}

export class WslAgentClient {
  private connectionPromise: Promise<AgentConnection> | undefined
  private nextRequestId = 1
  private readonly children = new Map<number, VirtualChildProcess>()
  private readonly requestStarted = new Map<number, Deferred<void>>()

  constructor(
    readonly distro: string,
    private readonly dataDir: string,
  ) {}

  spawn(
    file: string,
    args: readonly string[],
    cwd: string,
    options: WslAgentSpawnOptions,
  ): ChildProcess {
    const requestId = this.nextRequestId++
    const started = deferred<void>()
    // A command that never writes stdin still needs its rejected startup
    // promise observed when deployment or handshake fails.
    void started.promise.catch(() => {})
    this.requestStarted.set(requestId, started)

    const transport: VirtualChildTransport = {
      writeStdin: async payload => {
        await started.promise
        for (let offset = 0; offset < payload.length; offset += IO_CHUNK_SIZE) {
          await this.writeFrame(encodeWslFrame(
            WslFrameKind.Stdin,
            requestId,
            payload.subarray(offset, offset + IO_CHUNK_SIZE),
          ))
        }
      },
      endStdin: async () => {
        await started.promise
        await this.writeFrame(encodeWslFrame(WslFrameKind.StdinEnd, requestId))
      },
      kill: async signal => {
        await started.promise
        await this.writeFrame(encodeWslJsonFrame(
          WslFrameKind.Kill,
          requestId,
          { signal: signalName(signal) },
        ))
      },
    }

    const child = new VirtualChildProcess(file, args, transport, options.encoding)
    this.children.set(requestId, child)
    const request: SpawnRequest = {
      args: args.map(arg => translateGitArgument(arg, this.distro)),
      cwd,
      env: portableGitEnvironment(options.env, this.distro),
    }

    void this.startRequest(requestId, request, child, started)
    if (options.signal) {
      if (options.signal.aborted) child.kill(options.killSignal ?? 'SIGTERM')
      else options.signal.addEventListener(
        'abort',
        () => child.kill(options.killSignal ?? 'SIGTERM'),
        { once: true },
      )
    }
    return child.asChildProcess()
  }

  async ensureReady(): Promise<void> {
    await this.ensureConnected()
  }

  async shutdown(): Promise<void> {
    const pending = this.connectionPromise
    if (!pending) return

    let connection: AgentConnection
    try {
      connection = await pending
    } catch {
      return
    }

    timers.clearInterval(connection.heartbeat)
    const closed = new Promise<void>(resolve => connection.process.once('close', () => resolve()))
    try {
      await new Promise<void>((resolve, reject) => {
        connection.input.write(
          encodeWslFrame(WslFrameKind.Shutdown, 0),
          error => error ? reject(error) : resolve(),
        )
      })
      connection.input.end()
      await Promise.race([
        closed,
        new Promise<void>(resolve => {
          const timer = timers.setTimeout(resolve, 2_000)
          timer.unref()
        }),
      ])
    } finally {
      if (connection.process.exitCode === null) connection.process.kill()
      this.connectionPromise = undefined
    }
  }

  private async startRequest(
    requestId: number,
    request: SpawnRequest,
    child: VirtualChildProcess,
    started: Deferred<void>,
  ): Promise<void> {
    try {
      await this.ensureConnected()
      await this.writeFrame(encodeWslJsonFrame(WslFrameKind.Spawn, requestId, request))
      started.resolve()
    } catch (error) {
      started.reject(error)
      this.requestStarted.delete(requestId)
      this.children.delete(requestId)
      queueMicrotask(() => child.fail({
        code: (error as NodeJS.ErrnoException)?.code ?? 'GDP_WSL_AGENT_START',
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  private ensureConnected(): Promise<AgentConnection> {
    this.connectionPromise ??= this.connect().catch((error: unknown) => {
      this.connectionPromise = undefined
      throw error
    })
    return this.connectionPromise
  }

  private async connect(): Promise<AgentConnection> {
    const agentPath = await deployAgent(this.distro, this.dataDir)
    const processHandle = childProcess.spawn(
      wslExecutable(),
      ['-d', this.distro, '--exec', agentPath, 'serve', '--stdio'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    const input = processHandle.stdin
    const output = processHandle.stdout
    if (!input || !output) throw new Error('WSL agent stdio is unavailable')

    const handshake = deferred<HelloResponse>()
    const parser = new WslFrameParser()
    let heartbeat: NodeJS.Timeout | undefined
    const timer = timers.setTimeout(() => {
      handshake.reject(new Error(`WSL agent handshake timed out for ${this.distro}`))
      processHandle.kill()
    }, 10_000)
    timer.unref()

    output.on('data', (chunk: Buffer) => {
      try {
        for (const frame of parser.push(chunk)) {
          if (frame.kind === WslFrameKind.HelloAck && frame.requestId === 0) {
            handshake.resolve(parseJson<HelloResponse>(frame))
          } else if (frame.kind === WslFrameKind.Error && frame.requestId === 0) {
            const payload = parseJson<AgentErrorPayload>(frame)
            handshake.reject(Object.assign(new Error(payload.message), {
              code: payload.code,
            }))
          } else {
            this.handleFrame(frame)
          }
        }
      } catch (error) {
        handshake.reject(error)
        this.failConnection(error)
        processHandle.kill()
      }
    })
    output.on('end', () => {
      try { parser.finish() } catch (error) { this.failConnection(error) }
    })
    processHandle.stderr?.on('data', (chunk: Buffer) => {
      console.warn(`[GDP WSL:${this.distro}] ${chunk.toString('utf8').trimEnd()}`)
    })
    processHandle.once('error', error => {
      handshake.reject(error)
      this.failConnection(error)
    })
    processHandle.once('close', (code, signal) => {
      if (heartbeat) timers.clearInterval(heartbeat)
      const error = new Error(`WSL agent for ${this.distro} exited (${code ?? signal ?? 'unknown'})`)
      handshake.reject(error)
      this.failConnection(error)
    })

    await new Promise<void>((resolve, reject) => {
      input.write(
        encodeWslJsonFrame(WslFrameKind.Hello, 0, {
          version: WSL_PROTOCOL_VERSION,
          client: 'github-desktop-plus-hooks',
        }),
        error => error ? reject(error) : resolve(),
      )
    })
    const hello = await handshake.promise.finally(() => timers.clearTimeout(timer))
    if (hello.version !== WSL_PROTOCOL_VERSION || hello.os !== 'linux') {
      processHandle.kill()
      throw new Error(
        `Unsupported WSL agent handshake: protocol=${hello.version}, os=${hello.os}, arch=${hello.arch}`,
      )
    }

    heartbeat = timers.setInterval(() => {
      input.write(encodeWslFrame(WslFrameKind.Ping, 0), error => {
        if (error) processHandle.kill()
      })
    }, HEARTBEAT_INTERVAL_MS)
    heartbeat.unref()

    const connection = { process: processHandle, input, hello, heartbeat }
    return connection
  }

  private async writeFrame(frame: Buffer): Promise<void> {
    const connection = await this.ensureConnected()
    await new Promise<void>((resolve, reject) => {
      connection.input.write(frame, error => error ? reject(error) : resolve())
    })
  }

  private handleFrame(frame: WslFrame): void {
    const child = this.children.get(frame.requestId)
    if (!child) return

    switch (frame.kind) {
      case WslFrameKind.Spawned:
        child.markSpawned(parseJson<SpawnResponse>(frame).pid)
        break
      case WslFrameKind.Stdout:
        child.pushStdout(frame.payload)
        break
      case WslFrameKind.Stderr:
        child.pushStderr(frame.payload)
        break
      case WslFrameKind.Exit:
        child.finish(parseJson<AgentExitPayload>(frame))
        this.finishRequest(frame.requestId)
        break
      case WslFrameKind.Error:
        child.fail(parseJson<AgentErrorPayload>(frame))
        this.finishRequest(frame.requestId)
        break
      default:
        child.fail({
          code: 'EPROTO_DIRECTION',
          message: `Unexpected frame kind ${frame.kind} for request ${frame.requestId}`,
        })
        this.finishRequest(frame.requestId)
    }
  }

  private finishRequest(requestId: number): void {
    this.children.delete(requestId)
    this.requestStarted.delete(requestId)
  }

  private failConnection(reason: unknown): void {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    const payload = {
      code: (error as NodeJS.ErrnoException).code ?? 'GDP_WSL_AGENT_DISCONNECTED',
      message: error.message,
    }
    for (const child of this.children.values()) child.fail(payload)
    for (const started of this.requestStarted.values()) started.reject(error)
    this.children.clear()
    this.requestStarted.clear()
    this.connectionPromise = undefined
  }
}

const sharedClients = new Map<string, WslAgentClient>()

export function getWslAgentClient(distro: string, dataDir: string): WslAgentClient {
  const key = distro.toLowerCase()
  let client = sharedClients.get(key)
  if (!client) {
    client = new WslAgentClient(distro, dataDir)
    sharedClients.set(key, client)
  }
  return client
}
