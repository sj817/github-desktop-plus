import assert from 'node:assert/strict'
import type { LogEntry } from '@github-desktop-plus/shared'
import { MAX_LOG_ENTRIES, mergeLogEntries } from '../src/lib/log-buffer'

const entry = (n: number): LogEntry => ({ ts: '2026-10-15T00:00:' + n, level: 'info', category: 'test', message: 'message ' + n })
const a = entry(1)
const b = entry(2)
const c = entry(3)
const history = [a, b]
const live = [b, c]
assert.deepEqual(mergeLogEntries(history, live), [a, b, c], 'tail/live overlap must not duplicate rows')
assert.deepEqual(history, [a, b])
assert.deepEqual(live, [b, c])
const sameTime = { ...a, message: 'another message' }
assert.equal(mergeLogEntries([a], [sameTime]).length, 2, 'distinct messages sharing a timestamp must survive')
const overflow = Array.from({ length: 900 }, (_, n) => entry(n))
const retained = mergeLogEntries([], overflow)
assert.equal(retained.length, MAX_LOG_ENTRIES)
assert.equal(retained[0]?.message, 'message 400')
assert.equal(retained.at(-1)?.message, 'message 899')
assert.deepEqual(mergeLogEntries([], []), [])
console.log('log buffer: bounded retention, overlapping history and distinct records passed')
