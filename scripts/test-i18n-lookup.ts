/**
 * Unit tests for the shared translation lookup: `_aliases` expansion and the
 * case-insensitive fallback that lets one Chinese string cover GitHub
 * Desktop's `__DARWIN__ ? 'Foo Bar' : 'Foo bar'` pairs.
 *
 * Run with: pnpm run test:i18n
 */
import assert from 'node:assert/strict'
import {
  RESERVED_LOCALE_KEYS,
  collectAliases,
  applyAliases,
  lookupTranslation,
} from '../src/hooks/i18n-lookup'

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

test('exact match wins', () => {
  const t = { 'Date format': '日期格式', 'Date Format': '日期格式（macOS）' }
  assert.deepEqual(lookupTranslation(t, 'Date Format'), {
    key: 'Date Format',
    value: '日期格式（macOS）',
  })
})

test('falls back to a case-insensitive match', () => {
  const t = { 'Date format': '日期格式' }
  assert.deepEqual(lookupTranslation(t, 'Date Format'), {
    key: 'Date format',
    value: '日期格式',
  })
})

test('returns the canonical key so overrides still resolve', () => {
  const t = { 'Open in shell': '在命令行中打开' }
  const hit = lookupTranslation(t, 'OPEN IN SHELL')
  // Anchor overrides are recorded against the spelling in the locale file.
  assert.equal(hit?.key, 'Open in shell')
})

test('misses stay misses', () => {
  assert.equal(lookupTranslation({ Foo: '福' }, 'Bar'), undefined)
})

test('collects aliases from a category', () => {
  const pairs: Array<[string, string]> = []
  collectAliases(
    {
      'Date format': '日期格式',
      _aliases: { 'Date format': ['Date display format', 'Formatting: date'] },
    },
    pairs
  )
  assert.deepEqual(pairs, [
    ['Date display format', 'Date format'],
    ['Formatting: date', 'Date format'],
  ])
})

test('ignores a malformed _aliases block', () => {
  const pairs: Array<[string, string]> = []
  collectAliases({ _aliases: { 'A key': 'not an array' } as never }, pairs)
  collectAliases({ _aliases: null as never }, pairs)
  assert.deepEqual(pairs, [])
})

test('applies aliases across categories', () => {
  const translations: Record<string, string> = { 'Date format': '日期格式' }
  const applied = applyAliases(translations, [['Date display format', 'Date format']])
  assert.equal(applied, 1)
  assert.equal(translations['Date display format'], '日期格式')
})

test('an explicit translation beats an alias', () => {
  const translations: Record<string, string> = {
    'Date format': '日期格式',
    'Date display format': '日期显示格式',
  }
  applyAliases(translations, [['Date display format', 'Date format']])
  assert.equal(translations['Date display format'], '日期显示格式')
})

test('an alias pointing at nothing is skipped', () => {
  const translations: Record<string, string> = {}
  assert.equal(applyAliases(translations, [['Some string', 'Missing key']]), 0)
  assert.deepEqual(translations, {})
})

test('metadata keys are reserved', () => {
  for (const key of ['_meta', '_overrides', '_aliases']) {
    assert.ok(RESERVED_LOCALE_KEYS.has(key), `${key} should be reserved`)
  }
})

console.log(failures === 0 ? '\nall i18n-lookup tests passed' : `\n${failures} test(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
