/**
 * The hook logger runs on Electron's main thread (= the browser UI thread), so
 * a log call must never block on file I/O: writes are queued and appended in
 * the background, with a synchronous flush reserved for process exit.
 *
 * Run with: pnpm --filter @github-desktop-plus/hooks test
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'gdp-logger-test-'))
process.env.GDP_LOG_DIR = dir

const { gdpLog, flushLogsSync, resetLogStream, LOG_FILE, LOG_JSON_FILE, setLogBroadcast } =
  await import('../src/logger')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const lines = (file: string) =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []

let failures = 0
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run()
    console.log(`  ok  ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}`)
    console.log(`      ${e instanceof Error ? e.message : String(e)}`)
  }
}

await test('log files live in GDP_LOG_DIR', () => {
  assert.equal(LOG_FILE, join(dir, 'gdp-hooks.log'))
  assert.equal(LOG_JSON_FILE, join(dir, 'gdp-hooks-stream.jsonl'))
})

await test('gdpLog does not touch the disk synchronously', () => {
  resetLogStream()
  gdpLog('first entry', 'info', 'system')
  // Nothing may have been written yet — the call must return before any I/O.
  assert.deepEqual(lines(LOG_JSON_FILE), [])
  assert.deepEqual(lines(LOG_FILE), [])
})

await test('queued entries reach both files shortly after, in order', async () => {
  gdpLog('second entry', 'warn', 'menu')
  await sleep(400)
  const json = lines(LOG_JSON_FILE).map(line => JSON.parse(line) as { message: string; level: string })
  assert.deepEqual(json.map(e => e.message), ['first entry', 'second entry'])
  assert.deepEqual(json.map(e => e.level), ['info', 'warn'])
  const text = lines(LOG_FILE)
  assert.equal(text.length, 2)
  assert.match(text[0]!, /\[INFO\]\[system\] first entry$/)
  assert.match(text[1]!, /\[WARN\]\[menu\] second entry$/)
})

await test('a burst of entries all land', async () => {
  const before = lines(LOG_JSON_FILE).length
  for (let i = 0; i < 300; i++) gdpLog(`burst ${i}`, 'info', 'system')
  await sleep(400)
  assert.equal(lines(LOG_JSON_FILE).length, before + 300)
})

await test('flushLogsSync writes whatever is still queued', () => {
  gdpLog('pending at exit', 'error', 'system')
  flushLogsSync()
  assert.ok(lines(LOG_JSON_FILE).some(line => line.includes('pending at exit')))
  assert.ok(lines(LOG_FILE).some(line => line.includes('pending at exit')))
})

await test('the broadcast hook still fires synchronously', () => {
  const seen: string[] = []
  setLogBroadcast(entry => {
    seen.push(entry.message)
  })
  gdpLog('broadcast me', 'info', 'system')
  assert.deepEqual(seen, ['broadcast me'])
  setLogBroadcast(() => {})
})

await test('resetLogStream truncates the stream and rotates an oversized text log', () => {
  flushLogsSync()
  writeFileSync(LOG_FILE, 'x'.repeat(5 * 1024 * 1024))
  resetLogStream()
  assert.equal(readFileSync(LOG_JSON_FILE, 'utf8'), '')
  assert.ok(existsSync(`${LOG_FILE}.1`), 'previous generation is kept')
  assert.ok(!existsSync(LOG_FILE) || statSync(LOG_FILE).size === 0)
})

flushLogsSync()
rmSync(dir, { recursive: true, force: true })

if (failures > 0) {
  console.log(`${failures} logger test(s) failed`)
  process.exit(1)
}
console.log('all logger tests passed')
