import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { test } from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import {
  WslAgentClient,
  type WslAgentSpawnOptions,
} from '../src/preload/wsl/agent-client'
import { execFileWithAgent } from '../src/preload/wsl/interceptor'
import {
  encodeWslFrame,
  encodeWslJsonFrame,
  WslFrameKind,
  WslFrameParser,
} from '../src/preload/wsl/protocol'
import { VirtualChildProcess } from '../src/preload/wsl/virtual-child'

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

test('uses Node timers when Electron exposes browser-style numeric timers', () => {
  const child = new VirtualChildProcess('git', ['--version'], {
    writeStdin: async () => {},
    endStdin: async () => {},
    kill: async () => {},
  })
  const client = {
    spawn: () => child.asChildProcess(),
  } as unknown as WslAgentClient
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (() => 1) as unknown as typeof setTimeout
  try {
    assert.doesNotThrow(() => execFileWithAgent(
      client,
      'git',
      ['--version'],
      '/tmp',
      { timeout: 1_000 },
      error => assert.equal(error, null),
    ))
    child.finish({ code: 0, signal: null })
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test('matches execFile live stream encoding for Git progress parsers', () => {
  let virtualChild: VirtualChildProcess | undefined
  const client = {
    spawn: (
      file: string,
      args: readonly string[],
      _cwd: string,
      options: WslAgentSpawnOptions,
    ) => {
      virtualChild = new VirtualChildProcess(file, args, {
        writeStdin: async () => {},
        endStdin: async () => {},
        kill: async () => {},
      }, options.encoding)
      return virtualChild.asChildProcess()
    },
  } as unknown as WslAgentClient

  let callbackStdout: string | Buffer | undefined
  let callbackStderr: string | Buffer | undefined
  const child = execFileWithAgent(
    client,
    'git',
    ['push', '--progress'],
    '/tmp/repository',
    {},
    (error, stdout, stderr) => {
      assert.equal(error, null)
      callbackStdout = stdout
      callbackStderr = stderr
    },
  )

  const progressLines: string[] = []
  child.stderr?.on('data', (line: string | Buffer) => {
    assert.equal(typeof line, 'string')
    progressLines.push(stripVTControlCharacters(line as string))
  })
  virtualChild?.pushStdout(Buffer.from('published\n'))
  virtualChild?.pushStderr(Buffer.from('\u001b[32mWriting objects: 100% (1/1)\u001b[0m\n'))
  virtualChild?.finish({ code: 0, signal: null })

  assert.deepEqual(progressLines, ['Writing objects: 100% (1/1)\n'])
  assert.equal(callbackStdout, 'published\n')
  assert.equal(callbackStderr, '\u001b[32mWriting objects: 100% (1/1)\u001b[0m\n')
})

test('keeps explicit execFile buffer output binary', () => {
  let virtualChild: VirtualChildProcess | undefined
  const client = {
    spawn: (
      file: string,
      args: readonly string[],
      _cwd: string,
      options: WslAgentSpawnOptions,
    ) => {
      virtualChild = new VirtualChildProcess(file, args, {
        writeStdin: async () => {},
        endStdin: async () => {},
        kill: async () => {},
      }, options.encoding)
      return virtualChild.asChildProcess()
    },
  } as unknown as WslAgentClient

  let callbackStdout: string | Buffer | undefined
  const child = execFileWithAgent(
    client,
    'git',
    ['cat-file', 'blob', 'HEAD:binary'],
    '/tmp/repository',
    { encoding: 'buffer' as BufferEncoding },
    (error, stdout) => {
      assert.equal(error, null)
      callbackStdout = stdout
    },
  )

  const chunks: Buffer[] = []
  child.stdout?.on('data', (chunk: Buffer | string) => {
    assert.ok(Buffer.isBuffer(chunk))
    chunks.push(chunk as Buffer)
  })
  const binary = Buffer.from([0, 1, 254, 255])
  virtualChild?.pushStdout(binary)
  virtualChild?.finish({ code: 0, signal: null })

  assert.deepEqual(Buffer.concat(chunks), binary)
  assert.ok(Buffer.isBuffer(callbackStdout))
  assert.deepEqual(callbackStdout, binary)
})

const integrationDistro = process.env.GDP_WSL_INTEGRATION_DISTRO
const integrationDataDir = process.env.GDP_WSL_INTEGRATION_DATA_DIR

test('multiplexes real Git processes through the persistent WSL agent', {
  skip: !integrationDistro || !integrationDataDir,
  timeout: 45_000,
}, async () => {
  const client = new WslAgentClient(integrationDistro ?? '', integrationDataDir ?? '')
  const repositoryName = `gdp-wsl-agent-test-${process.pid}-${Date.now()}`
  const linuxRepository = `/tmp/${repositoryName}`
  const linuxRemote = `/tmp/${repositoryName}-remote.git`
  const uncRepository = `\\\\wsl.localhost\\${integrationDistro}\\tmp\\${repositoryName}`
  const uncRemote = `\\\\wsl.localhost\\${integrationDistro}\\tmp\\${repositoryName}-remote.git`

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
      { encoding: 'utf8', maxBuffer: Infinity, timeout: 20_000 },
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

    await exec(['init', '--quiet', linuxRepository])
    const repository = await exec(['-C', linuxRepository, 'rev-parse', '--show-toplevel'])
    assert.equal(repository.stdout.trim(), linuxRepository)
    await exec(['-C', linuxRepository, 'commit', '--allow-empty', '--message', 'GDP WSL signing verification'])
    await exec(['-C', linuxRepository, 'verify-commit', 'HEAD'])

    await exec(['init', '--bare', '--quiet', linuxRemote])
    const pushProgress = await new Promise<string>((resolve, reject) => {
      const child = client.spawn(
        'git',
        ['-C', linuxRepository, 'push', '--progress', linuxRemote, 'HEAD:refs/heads/main'],
        '/tmp',
        { encoding: 'utf8' },
      )
      const stderr: string[] = []
      child.stderr?.on('data', (chunk: string | Buffer) => {
        assert.equal(typeof chunk, 'string')
        stderr.push(stripVTControlCharacters(chunk as string))
      })
      child.once('error', reject)
      child.once('close', code => code === 0
        ? resolve(stderr.join(''))
        : reject(new Error(`Git push exited with ${code}: ${stderr.join('')}`)))
    })
    assert.match(pushProgress, /To \/tmp\/gdp-wsl-agent-test-.+-remote\.git/)
  } finally {
    await client.shutdown()
    fs.rmSync(uncRepository, { recursive: true, force: true })
    fs.rmSync(uncRemote, { recursive: true, force: true })
  }
})
