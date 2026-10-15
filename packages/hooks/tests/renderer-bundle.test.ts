import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { diffFixture } from './fixtures/renderer-performance'
import { memoryFixture } from './fixtures/renderer-memory'

const directory = await fs.mkdtemp(join(tmpdir(), 'gdp-renderer-bundle-'))
process.env.GDP_LOG_DIR = directory
const { setupRendererBundle } = await import('../src/renderer-bundle')
const { patchRendererSource } = await import('../src/copilot-unlock')
const { patchRendererPerformance } = await import('../src/renderer-performance')
const { patchRendererMemory } = await import('../src/renderer-memory')
const { flushLogsSync } = await import('../src/logger')

const copilotFixture = '(a.features??[]).includes("desktop_copilot_generate_commit_message")&&a.isCopilotDesktopEnabled'
const source = `${diffFixture}function bundleFixture(){return ${copilotFixture}}`

after(async () => {
  flushLogsSync()
  await fs.rm(directory, { recursive: true, force: true })
})

async function bundlePath(name: string, contents = source): Promise<string> {
  const folder = join(directory, name)
  await fs.mkdir(folder, { recursive: true })
  const file = join(folder, 'renderer.js')
  await fs.writeFile(file, contents)
  return file
}

function harness(isEnabled = () => false) {
  let handler: ((request: Request) => Promise<Response> | Response) | undefined
  const forwarded: Request[] = []
  setupRendererBundle({ defaultSession: { protocol: {
    handle(scheme, value) {
      assert.equal(scheme, 'file')
      handler = value
    },
  } } }, {
    async fetch(request, options) {
      assert.deepEqual(options, { bypassCustomProtocolHandlers: true })
      forwarded.push(request)
      return new Response('native file response', { status: 202 })
    },
  }, isEnabled)
  assert.ok(handler)
  const run = handler
  return {
    forwarded,
    request: (url: string, init?: RequestInit) => Promise.resolve(run(new Request(url, init))),
  }
}

test('Copilot transforms report unsupported patterns without side effects', () => {
  const unsupported = patchRendererSource('new upstream renderer')
  assert.equal(unsupported.code, 'new upstream renderer')
  assert.equal(unsupported.applied, 0)
  assert.equal(unsupported.skipped.length, 3)
  const partial = patchRendererSource(copilotFixture)
  assert.equal(partial.code, '!0')
  assert.equal(partial.applied, 1)
  assert.equal(partial.skipped.length, 2)
})

test('performance patches apply with Copilot disabled and encoded file paths', async () => {
  const path = await bundlePath('space # 汉字')
  const app = harness()
  const performance = patchRendererPerformance(source)
  assert.ok(performance.applied > 0, 'fixture must match a real performance patch')
  const response = await app.request(`${pathToFileURL(path).href}?cache=1`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8')
  const code = await response.text()
  assert.equal(code, performance.code)
  assert.ok(code.includes(copilotFixture))
  assert.equal(app.forwarded.length, 0)
})

test('memory bounds are served alongside diff optimizations with Copilot disabled', async () => {
  const combined = `${memoryFixture};${source}`
  const path = await bundlePath('memory', combined)
  const app = harness()
  const expected = patchRendererMemory(patchRendererPerformance(combined).code)
  assert.equal(expected.applied, 2)
  assert.deepEqual(expected.skipped, [])
  const code = await (await app.request(pathToFileURL(path).href)).text()
  assert.equal(code, expected.code)
  assert.ok(code.includes('__gdpReleaseWorkingDiffs'))
  assert.ok(code.includes('__gdpHighlightPool'))
  assert.ok(code.includes(copilotFixture))
})

test('cache separates Copilot settings and reuses both variants', async t => {
  const path = await bundlePath('config')
  const reads = t.mock.method(fs, 'readFile')
  let enabled = false
  const app = harness(() => enabled)
  const url = pathToFileURL(path).href
  const disabled = await (await app.request(url)).text()
  enabled = true
  const enabledCode = await (await app.request(url)).text()
  assert.equal(enabledCode, patchRendererSource(disabled).code)
  assert.notEqual(enabledCode, disabled)
  enabled = false
  assert.equal(await (await app.request(url)).text(), disabled)
  assert.equal(reads.mock.calls.length, 2)
})

test('concurrent loads share asynchronous stat, read, and source transforms', async t => {
  const path = await bundlePath('concurrent')
  const reads = t.mock.method(fs, 'readFile')
  const stats = t.mock.method(fs, 'stat')
  const app = harness()
  const responses = await Promise.all(Array.from({ length: 6 }, () =>
    app.request(pathToFileURL(path).href).then(response => response.text())
  ))
  assert.equal(new Set(responses).size, 1)
  assert.equal(reads.mock.calls.length, 1)
  assert.equal(stats.mock.calls.length, 1)
})

test('in-flight loads preserve the setting captured by each request', async () => {
  const path = await bundlePath('concurrent-config')
  let enabled = false
  const app = harness(() => enabled)
  const url = pathToFileURL(path).href
  const disabledLoad = app.request(url)
  enabled = true
  const enabledLoad = app.request(url)
  const [disabled, enabledCode] = await Promise.all([
    disabledLoad.then(response => response.text()),
    enabledLoad.then(response => response.text()),
  ])
  assert.ok(disabled.includes(copilotFixture))
  assert.equal(enabledCode, patchRendererSource(disabled).code)
})

test('file size and modification time each invalidate the cache', async t => {
  const path = await bundlePath('metadata')
  const initialTime = new Date(1_700_000_000_000)
  await fs.utimes(path, initialTime, initialTime)
  const reads = t.mock.method(fs, 'readFile')
  const app = harness()
  const url = pathToFileURL(path).href
  const initial = await (await app.request(url)).text()
  const original = await fs.stat(path)
  await fs.writeFile(path, `${source};/* one */`)
  await fs.utimes(path, original.atime, original.mtime)
  assert.equal((await fs.stat(path)).mtimeMs, original.mtimeMs)
  const resized = await (await app.request(url)).text()
  assert.equal(resized, `${initial};/* one */`)
  await fs.writeFile(path, `${source};/* two */`)
  await fs.utimes(path, original.atime, new Date(original.mtimeMs + 2_000))
  assert.equal(await (await app.request(url)).text(), `${initial};/* two */`)
  assert.equal(reads.mock.calls.length, 3)
})

test('only two transformed bundles are retained', async t => {
  const paths = await Promise.all(['cache-a', 'cache-b', 'cache-c'].map(name => bundlePath(name)))
  const reads = t.mock.method(fs, 'readFile')
  const app = harness()
  for (const path of [...paths, paths[0]!]) {
    assert.equal((await app.request(pathToFileURL(path).href)).status, 200)
  }
  assert.equal(reads.mock.calls.length, 4)
})

test('unsupported bundles fall back and are not repeatedly scanned', async t => {
  const path = await bundlePath('unsupported', 'console.log("new upstream shape")')
  const reads = t.mock.method(fs, 'readFile')
  const app = harness()
  for (let index = 0; index < 2; index++) {
    const response = await app.request(pathToFileURL(path).href)
    assert.equal(response.status, 202)
    assert.equal(await response.text(), 'native file response')
  }
  assert.equal(reads.mock.calls.length, 1)
  assert.equal(app.forwarded.length, 2)
})

test('other resources, methods, ranges and invalid file URLs pass through', async t => {
  const path = await bundlePath('passthrough')
  const reads = t.mock.method(fs, 'readFile')
  const app = harness()
  const url = pathToFileURL(path).href
  const requests: Array<[string, RequestInit?]> = [
    [url.replace('renderer.js', 'other.js')],
    ['https://example.test/renderer.js'],
    [url, { method: 'HEAD' }],
    [url, { headers: { range: 'bytes=0-99' } }],
    ['file:///invalid%ZZ/renderer.js'],
  ]
  for (const [requestUrl, init] of requests) {
    assert.equal((await app.request(requestUrl, init)).status, 202)
  }
  assert.equal(reads.mock.calls.length, 0)
  assert.equal(app.forwarded.length, requests.length)
})

test('stat and read errors fall back, and failed reads can be retried', async () => {
  const folder = join(directory, 'retry')
  await fs.mkdir(folder)
  const path = join(folder, 'renderer.js')
  const app = harness()
  const url = pathToFileURL(path).href
  assert.equal((await app.request(url)).status, 202)
  await fs.mkdir(path)
  assert.equal((await app.request(url)).status, 202)
  await fs.rmdir(path)
  await fs.writeFile(path, source)
  assert.equal((await app.request(url)).status, 200)
  assert.equal(app.forwarded.length, 2)
})

test('unavailable or occupied protocol handlers do not break startup', () => {
  const net = { fetch: async () => new Response() }
  assert.doesNotThrow(() => setupRendererBundle({}, net, () => false))
  assert.doesNotThrow(() => setupRendererBundle({ defaultSession: { protocol: {
    handle() { throw new Error('already registered') },
  } } }, net, () => false))
})
