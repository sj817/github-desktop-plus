import assert from 'node:assert/strict'
import { applyDraft, createEntry, draftFromConfig, uniqueId } from '../src/lib/settings'

const current = {
  unrelated: { keep: true },
  i18n: { enabled: true, locale: 'zh-CN' },
  ui: { recent_repos_limit: 5 },
  ai: { enabled: true, base_url: 'https://example.test/v1', api_key: 'test-key', model: 'test-model', timeout_secs: 45 },
  open_with: { items: [{ id: 'editor', path: 'C:/Editor.exe', label: 'Editor', args: '"%TARGET_PATH%"', enabled: true }] },
}
const before = JSON.stringify(current)
const draft = draftFromConfig(current)
draft.locale = 'ja-JP'
draft.i18nEnabled = false
draft.recentReposLimit = 12
draft.blockUpdates = false
draft.blockTelemetry = false
draft.downloadMirror = 'ghfast.top'
draft.unlockCopilot = false
draft.logLevel = 'debug'
draft.ai = { ...draft.ai, baseUrl: ' https://new.test/v1 ', apiKey: ' next-key ', model: ' next-model ', timeoutSecs: 60, systemPrompt: '提交格式', fallbackToCopilot: false }
draft.openWith.submenu = true
draft.openWith.items.push(createEntry({ id: 'shell', path: ' C:/Shell.exe ', group: 'shell', console: true, enabled: false }))
draft.openWith.items.push(createEntry({ id: 'empty', path: ' ' }))
const saved = applyDraft(current, draft)
assert.equal(JSON.stringify(current), before, 'saving must not mutate the disk snapshot')
assert.deepEqual(saved.unrelated, { keep: true }, 'unmanaged configuration must survive')
assert.deepEqual(saved.i18n, { enabled: false, locale: 'ja-JP' })
assert.deepEqual(saved.ui, { recent_repos_limit: 12 })
assert.deepEqual(saved.updates, { disabled: false, block_manual_check: false })
assert.deepEqual(saved.telemetry, { disabled: false })
assert.deepEqual(saved.downloads, { mirror: 'ghfast.top' })
assert.equal(draftFromConfig(saved).downloadMirror, 'ghfast.top')
assert.equal(draftFromConfig({ downloads: { mirror: 'unknown' as never } }).downloadMirror, 'auto')
assert.equal(saved.copilot?.unlock, false)
assert.equal(saved.logging?.level, 'debug')
assert.equal(saved.ai?.base_url, 'https://new.test/v1')
assert.equal(saved.ai?.api_key, 'next-key')
assert.equal(saved.ai?.model, 'next-model')
assert.equal(saved.ai?.timeout_secs, 60)
assert.equal(saved.ai?.system_prompt, '提交格式')
assert.equal(saved.ai?.fallback_to_copilot, false)
assert.equal(saved.open_with?.submenu, true)
assert.equal(saved.open_with?.items?.length, 2)
assert.equal(saved.open_with?.items?.[1]?.path, 'C:/Shell.exe')
assert.equal(saved.open_with?.items?.[1]?.console, true)
assert.equal(saved.open_with?.items?.[1]?.enabled, false)
assert.ok(saved.open_with?.items?.every(item => !('key' in item)), 'React identities must never leak to disk')
assert.equal(uniqueId(draft.openWith.items, 'editor'), 'editor-2')
assert.equal(draftFromConfig(saved).ai.apiKey, 'next-key', 'saved settings must round-trip')
const migrated = applyDraft({ block_updates: true, other: 7 }, draftFromConfig({}))
assert.equal(migrated.other, 7)
assert.ok(!('block_updates' in migrated))
console.log('settings: cross-tab persistence, unknown keys, launcher identity and schema round-trip passed')
