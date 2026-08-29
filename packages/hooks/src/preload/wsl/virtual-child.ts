import type { ChildProcess, Serializable } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'

export interface VirtualChildTransport {
  writeStdin(payload: Buffer): Promise<void>
  endStdin(): Promise<void>
  kill(signal: NodeJS.Signals | number): Promise<void>
}

export interface AgentErrorPayload {
  code: string
  message: string
}

export interface AgentExitPayload {
  code: number | null
  signal: NodeJS.Signals | null
}

export type VirtualChildOutputEncoding = BufferEncoding | 'buffer' | null

function asError(payload: AgentErrorPayload): Error & { code: string } {
  const error = new Error(payload.message) as Error & { code: string }
  error.code = payload.code
  return error
}

export class VirtualChildProcess extends EventEmitter {
  readonly stdin: Writable
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdio: [Writable, PassThrough, PassThrough, null, null]
  readonly spawnargs: string[]
  readonly spawnfile: string
  readonly connected = false
  readonly channel = null

  pid: number | undefined
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false

  private finalized = false

  constructor(
    file: string,
    args: readonly string[],
    private readonly transport: VirtualChildTransport,
    outputEncoding?: VirtualChildOutputEncoding,
  ) {
    super()
    this.spawnfile = file
    this.spawnargs = [file, ...args]
    if (outputEncoding !== undefined && outputEncoding !== null && outputEncoding !== 'buffer') {
      this.stdout.setEncoding(outputEncoding)
      this.stderr.setEncoding(outputEncoding)
    }
    this.stdin = new Writable({
      write: (chunk: Buffer | string, encoding, callback) => {
        const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
        this.transport.writeStdin(payload).then(() => callback(), callback)
      },
      final: (callback) => {
        this.transport.endStdin().then(() => callback(), callback)
      },
    })
    this.stdio = [this.stdin, this.stdout, this.stderr, null, null]
  }

  markSpawned(pid: number): void {
    if (this.finalized) return
    this.pid = pid
    this.emit('spawn')
  }

  pushStdout(payload: Buffer): void {
    if (!this.finalized) this.stdout.write(payload)
  }

  pushStderr(payload: Buffer): void {
    if (!this.finalized) this.stderr.write(payload)
  }

  fail(payload: AgentErrorPayload): void {
    if (this.finalized) return
    this.finalized = true
    const error = asError(payload)
    this.stdin.destroy()
    this.stdout.end()
    this.stderr.end()
    this.emit('error', error)
    this.emit('close', null, null)
  }

  finish(payload: AgentExitPayload): void {
    if (this.finalized) return
    this.finalized = true
    this.exitCode = payload.code
    this.signalCode = payload.signal
    this.stdin.destroy()
    this.stdout.end()
    this.stderr.end()
    this.emit('exit', payload.code, payload.signal)
    this.emit('close', payload.code, payload.signal)
  }

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    if (this.finalized) return false
    this.killed = true
    void this.transport.kill(signal).catch((error: unknown) => {
      if (!this.finalized) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)))
      }
    })
    return true
  }

  ref(): this {
    return this
  }

  unref(): this {
    return this
  }

  disconnect(): void {}

  send(
    _message: Serializable,
    _sendHandle?: unknown,
    _options?: unknown,
    callback?: (error: Error | null) => void,
  ): boolean {
    callback?.(new Error('IPC is unavailable for WSL virtual child processes'))
    return false
  }

  [Symbol.dispose](): void {
    this.kill()
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess
  }
}
