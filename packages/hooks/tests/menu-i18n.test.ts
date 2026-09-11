/**
 * Application-menu translation is on the main-process hot path (GitHub
 * Desktop rebuilds its menu on every refresh), so beyond correctness these
 * tests pin down that repeated rebuilds are served from cache and that a
 * swapped translations object is not.
 *
 * Run with: pnpm --filter @github-desktop-plus/hooks test
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItem } from '../src/menu-i18n'

// Keep the logger's background writes out of the real per-user log files.
const dir = mkdtempSync(join(tmpdir(), 'gdp-menu-i18n-test-'))
process.env.GDP_LOG_DIR = dir

const { translateLabel, translateMenuItem } = await import('../src/menu-i18n')
const { flushLogsSync } = await import('../src/logger')

let failures = 0
function test(name: string, run: () => void): void {
  try {
    run()
    console.log(`  ok  ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}`)
    console.log(`      ${e instanceof Error ? e.message : String(e)}`)
  }
}

const translations = {
  '&File': '文件(&F)',
  'O&pen in {shell}': '在 {shell} 中打开(&P)',
  '&Open in {{editor}}': '在 {{editor}} 中打开(&O)',
  'Show logs': '显示日志',
}

test('exact labels translate', () => {
  assert.equal(translateLabel('&File', translations), '文件(&F)')
})

test('case-insensitive fallback still applies to menu labels', () => {
  assert.equal(translateLabel('Show Logs', translations), '显示日志')
})

test('placeholder patterns keep the dynamic part', () => {
  assert.equal(translateLabel('O&pen in Windows Terminal', translations), '在 Windows Terminal 中打开(&P)')
  assert.equal(translateLabel('&Open in Visual Studio Code', translations), '在 Visual Studio Code 中打开(&O)')
})

test('misses return null', () => {
  assert.equal(translateLabel('Nothing like this', translations), null)
})

test('the same translations object serves repeated labels from cache', () => {
  let reads = 0
  const tracked = new Proxy(
    { ...translations },
    {
      get(target, key, receiver) {
        if (typeof key === 'string') reads++
        return Reflect.get(target, key, receiver)
      },
      ownKeys(target) {
        reads++
        return Reflect.ownKeys(target)
      },
    }
  ) as Record<string, string>
  translateLabel('O&pen in Windows Terminal', tracked)
  const afterFirst = reads
  assert.ok(afterFirst > 0)
  for (let i = 0; i < 50; i++) translateLabel('O&pen in Windows Terminal', tracked)
  assert.equal(reads, afterFirst, 'cached lookups must not touch the translations object again')
})

test('a swapped translations object is not served from the old cache', () => {
  const first = { '&File': '文件(&F)' }
  const second = { '&File': '檔案(&F)' }
  assert.equal(translateLabel('&File', first), '文件(&F)')
  assert.equal(translateLabel('&File', second), '檔案(&F)')
})

test('translateMenuItem walks submenus in place', () => {
  const template: MenuItem = {
    label: '&File',
    submenu: [{ label: 'Show logs' }, { label: 'Untranslated item' }, { type: 'separator' }],
  }
  translateMenuItem(template, translations)
  assert.equal(template.label, '文件(&F)')
  assert.equal(template.submenu?.[0]?.label, '显示日志')
  assert.equal(template.submenu?.[1]?.label, 'Untranslated item')
})

flushLogsSync()
rmSync(dir, { recursive: true, force: true })

if (failures > 0) {
  console.log(`${failures} menu-i18n test(s) failed`)
  process.exit(1)
}
console.log('all menu-i18n tests passed')
