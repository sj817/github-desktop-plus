import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { test } from 'node:test'
import { WINDOWS_SETUP_NAME, type UpdateState } from '@github-desktop-plus/shared'
import { GdpUpdater, isNewerVersion, parseRelease, updateRoutes, type UpdateTransport } from '../src/updater'

const binary = Buffer.from('MZ-public-GDP-test-installer')
const digest = createHash('sha256').update(binary).digest('hex')
const assetUrl = `https://github.com/sj817/github-desktop-plus/releases/download/v0.2.9/${WINDOWS_SETUP_NAME}`
const metadata = () => ({
  tag_name: 'v0.2.9', draft: false, prerelease: false, body: 'Release notes',
  assets: [{ name: WINDOWS_SETUP_NAME, browser_download_url: assetUrl, size: binary.length, digest: `sha256:${digest}` }],
})
const jsonStream = () => Readable.from([JSON.stringify(metadata())])

test('compares complete stable version components, without lexicographic or numeric-overflow errors', () => {
  assert.equal(isNewerVersion('v0.2.10', '0.2.9'), true)
  assert.equal(isNewerVersion('0.2.9', '0.2.9'), false)
  assert.equal(isNewerVersion('0.2.9', '0.3.0'), false)
  assert.equal(isNewerVersion('100000000000000000001.0.0', '100000000000000000000.0.0'), true)
  assert.throws(() => isNewerVersion('v0.2.9-beta', '0.2.8'))
})

test('only accepts the stable GDP installer and a bounded size with GitHub SHA-256', () => {
  assert.equal(parseRelease(metadata()).sha256, digest)
  for (const field of [
    { browser_download_url: 'https://example.org/evil.exe' }, { digest: null }, { size: 0 },
    { size: 256 * 1024 * 1024 + 1 }, { size: 1.5 }, { digest: 'sha256:nope' },
  ]) {
    const data = metadata()
    Object.assign(data.assets[0]!, field)
    assert.throws(() => parseRelease(data))
  }
  assert.throws(() => parseRelease({ ...metadata(), tag_name: '../../bad' }))
  assert.throws(() => parseRelease({ ...metadata(), prerelease: true }))
})

test('direct stays on GitHub and explicit mirrors are preferred only for downloads', () => {
  assert.deepEqual(updateRoutes('direct'), [{ label: 'GitHub 直连', prefix: '' }])
  assert.equal(updateRoutes('ghfast.top')[0]!.label, 'ghfast.top')
  assert.equal(updateRoutes('auto')[0]!.label, 'gh.dpik.top')
  assert.equal(updateRoutes('auto', true)[0]!.prefix, '')
  assert.ok(updateRoutes('auto', true).every(route => !route.prefix.includes('ghfast.top')))
})

test('rejects bad metadata, falls back, streams and validates bytes, keeps one cache, rechecks before execution', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gdp-updater-test-'))
  const calls: string[] = []
  const events: UpdateState[] = []
  let checks = 0
  let downloads = 0
  let executed = 0
  const transport: UpdateTransport = {
    async open(url) {
      calls.push(url)
      if (url.includes('/releases/latest')) return ++checks === 1 ? Readable.from(['<html>not metadata</html>']) : jsonStream()
      return Readable.from([++downloads === 1 ? Buffer.alloc(binary.length) : binary])
    },
  }
  try {
    await writeFile(path.join(directory, '0.2.7-Setup.exe'), 'old')
    await writeFile(path.join(directory, 'keep.txt'), 'unrelated')
    const updater = new GdpUpdater({ version: '0.2.8', directory, transport, publish: state => events.push(state), openInstaller: async () => { executed++ } })
    assert.equal((await updater.check('auto')).phase, 'available')
    assert.equal((await updater.download('auto')).phase, 'ready')
    assert.deepEqual(await readFile(path.join(directory, '0.2.9-Setup.exe')), binary)
    assert.deepEqual((await readdir(directory)).sort(), ['0.2.9-Setup.exe', 'keep.txt'])
    assert.equal(checks, 2)
    assert.equal(downloads, 2)
    assert.equal(events.at(-1)!.received, binary.length)
    assert.ok(events.every((state, index) => index === 0 || state.revision > events[index - 1]!.revision))
    assert.ok(calls.every(url => !url.includes('Authorization')))
    assert.equal((await updater.install()).ok, true)
    assert.equal(executed, 1)
    await writeFile(path.join(directory, '0.2.9-Setup.exe'), 'tampered')
    assert.equal((await updater.install()).ok, false)
    assert.equal(executed, 1)
    assert.equal(updater.snapshot().phase, 'available')
    assert.deepEqual(await readdir(directory), ['keep.txt'])
    assert.equal((await updater.download('direct')).phase, 'ready')
    await rm(path.join(directory, '0.2.9-Setup.exe'))
    assert.equal((await updater.install()).ok, false)
    assert.equal(updater.snapshot().phase, 'available', 'missing cache can be downloaded again')
    assert.equal(executed, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('cancel aborts a stream and removes partial data; duplicate downloads share one operation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gdp-updater-cancel-'))
  let downloadStarted!: () => void
  const started = new Promise<void>(resolve => { downloadStarted = resolve })
  const stream = new PassThrough()
  const updater = new GdpUpdater({ version: '0.2.8', directory, publish() {}, openInstaller: async () => {}, transport: {
    async open(url) {
      if (url.includes('/releases/latest')) return jsonStream()
      downloadStarted()
      return stream
    },
  } })
  try {
    await updater.check('direct')
    const downloading = updater.download('direct')
    await started
    assert.equal((await updater.download('direct')).phase, 'downloading')
    updater.cancel()
    assert.equal((await downloading).phase, 'available')
    assert.equal(stream.destroyed, true)
    assert.deepEqual(await readdir(directory), [])
    assert.equal((await updater.install()).ok, false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('current versions never download, direct errors do not silently contact a mirror', async () => {
  const calls: string[] = []
  const updater = new GdpUpdater({ version: '0.3.0', directory: os.tmpdir(), publish() {}, openInstaller: async () => {}, transport: {
    async open(url) { calls.push(url); return jsonStream() },
  } })
  assert.equal((await updater.check('direct')).phase, 'current')
  await updater.download('auto')
  assert.equal(calls.length, 1)
  const failing = new GdpUpdater({ version: '0.2.8', directory: os.tmpdir(), publish() {}, openInstaller: async () => {}, transport: {
    async open(url) { calls.push(url); throw new Error('offline') },
  } })
  assert.equal((await failing.check('direct')).phase, 'error')
  assert.equal(calls.length, 2)
})
