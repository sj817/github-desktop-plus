import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WslAgentClient } from '../src/preload/wsl/agent-client'
import { execFileWithAgent } from '../src/preload/wsl/interceptor'
import {
  encodeWslFrame,
  encodeWslJsonFrame,
  WslFrameKind,
  WslFrameParser,
} from '../src/preload/wsl/protocol'

test('parses fragmented and coalesced WSL frames without changing binary output', () => {
  const first = encodeWslFrame(WslFrameKind.Stdout, 7, Buffer.from([0, 1, 254, 255]))
  const second = encodeWslJsonFrame(WslFrameKind.Exit, 7, { code: 0, signal: null })
  const bytes = Buffer.concat([first, second])
  const parser = new WslFrameParser()

  assert.deepEqual(parser.push(bytes.subarray(0, 3)), [])
  assert.deepEqual(parser.push(bytes.subarray(3, first.length - 1)), [])
  const frames = parser.push(bytes.subarray(first.length - 1))
  assert.equal(frames.length, 2)
  assert.equal(frames[0]?.kind, WslFrameKind.Stdout)
  assert.equal(frames[0]?.requestId, 7)
  assert.deepEqual(frames[0]?.payload, Buffer.from([0, 1, 254, 255]))
  assert.deepEqual(JSON.parse(frames[1]?.payload.toString('utf8') ?? ''), { code: 0, signal: null })
  parser.finish()
})

test('rejects malformed and incomplete WSL frames', () => {
  const invalid = Buffer.alloc(4)
  invalid.writeUInt32BE(8)
  assert.throws(() => new WslFrameParser().push(invalid), /Invalid WSL frame length/)

  const parser = new WslFrameParser()
  parser.push(encodeWslFrame(WslFrameKind.Ping, 1).subarray(0, 5))
  assert.throws(() => parser.finish(), /incomplete protocol bytes/)

  const unknownKind = encodeWslFrame(WslFrameKind.Ping, 1)
  unknownKind.writeUInt8(255, 4)
  assert.throws(() => new WslFrameParser().push(unknownKind), /Unknown WSL frame kind/)
})

const integrationDistro = process.env.GDP_WSL_INTEGRATION_DISTRO
const integrationDataDir = process.env.GDP_WSL_INTEGRATION_DATA_DIR

test('multiplexes real Git processes through the persistent WSL agent', {
  skip: !integrationDistro || !integrationDataDir,
  timeout: 30_000,
}, async () => {
  const client = new WslAgentClient(integrationDistro ?? '', integrationDataDir ?? '')

  const run = (args: string[], stdin?: string) => new Promise<{
    code: number | null
    stdout: string
    stderr: string
    pid: number | undefined
  }>((resolve, reject) => {
    const child = client.spawn('git', args, '/tmp', {})
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', code => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      pid: child.pid,
    }))
    child.stdin?.end(stdin)
  })

  const exec = (args: string[]) => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFileWithAgent(
      client,
      'git',
      args,
      '/tmp',
      { encoding: 'utf8', maxBuffer: Infinity },
      (error, stdout, stderr) => error
        ? reject(error)
        : resolve({ stdout: String(stdout), stderr: String(stderr) }),
    )
  })

  try {
    const [version, hash, failure] = await Promise.all([
      exec(['--version']),
      run(['hash-object', '--stdin'], 'hello from GDP\n'),
      run(['rev-parse', '--verify', 'refs/does-not-exist']),
    ])

    assert.match(version.stdout, /^git version /)
    assert.equal(version.stderr, '')
    assert.equal(hash.code, 0)
    assert.ok((hash.pid ?? 0) > 0)
    assert.match(hash.stdout.trim(), /^[0-9a-f]{40}$/)
    assert.notEqual(failure.code, 0)
    assert.match(failure.stderr, /unknown revision|Needed a single revision|not a git repository/)
  } finally {
    await client.shutdown()
  }
})
