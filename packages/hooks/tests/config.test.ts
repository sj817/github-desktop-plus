import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseConfig } from '../src/config'

test('consumes GDP_CONFIG instead of leaking it to child processes', () => {
  process.env.GDP_CONFIG = JSON.stringify({
    locale: 'test-locale',
    recentReposLimit: 12,
  })

  const config = parseConfig()

  assert.equal(config.locale, 'test-locale')
  assert.equal(config.recentReposLimit, 12)
  assert.equal(process.env.GDP_CONFIG, undefined)
})

test('removes malformed GDP_CONFIG while falling back to defaults', () => {
  process.env.GDP_CONFIG = '{invalid'

  const config = parseConfig()

  assert.equal(config.locale, 'zh-CN')
  assert.equal(process.env.GDP_CONFIG, undefined)
})
