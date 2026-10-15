/**
 * Isolated V8 retention check, not a measurement of the Desktop application.
 * node --expose-gc --import tsx scripts/checks/memory-retention.ts
 */
import assert from 'node:assert/strict'
import { releaseInactiveWorkingDiffs } from '../../packages/hooks/src/renderer-memory'

if (!globalThis.gc) throw new Error('Run this check with node --expose-gc --import tsx')

type FixtureDiff = { text: string; hunks: Array<{ lines: Array<{ content: string; lineNumber: number }> }> }
const states = new Map<string, {
  changesState: { selection: { kind: string; diff: FixtureDiff | null }; commitMessage: string }
}>()
const references: Array<WeakRef<FixtureDiff>> = []

globalThis.gc()
const baseline = process.memoryUsage().heapUsed
for (let repository = 0; repository < 40; repository++) {
  const lines = Array.from({ length: 10_000 }, (_, index) => ({
    content: `repository ${repository}, source line ${index}: const value = ${index};`,
    lineNumber: index,
  }))
  const diff = { text: lines.map(line => line.content).join('\n'), hunks: [{ lines }] }
  references.push(new WeakRef(diff))
  states.set(String(repository), {
    changesState: { selection: { kind: 'WorkingDirectory', diff }, commitMessage: `draft ${repository}` },
  })
}
globalThis.gc()
const populated = process.memoryUsage().heapUsed
assert.equal(releaseInactiveWorkingDiffs(states, '39'), 39)

// WeakRefs keep newly created targets alive through their creation job. Cross
// task boundaries before checking collection, without dereferencing them early.
for (let turn = 0; turn < 4; turn++) {
  await new Promise(resolve => setTimeout(resolve, 0))
  globalThis.gc()
}
const released = process.memoryUsage().heapUsed
assert.equal(references.slice(0, -1).filter(reference => reference.deref() !== undefined).length, 0)
assert.ok(references.at(-1)?.deref(), 'current diff remains live')
assert.equal(states.size, 40)
assert.equal(states.get('0')?.changesState.commitMessage, 'draft 0')

const mib = (bytes: number) => +(bytes / 1024 / 1024).toFixed(2)
console.log(JSON.stringify({
  environment: 'isolated Node/V8 fixture, explicit GC',
  repositories: states.size,
  linesPerDiff: 10_000,
  beforeMiB: mib(populated - baseline),
  afterMiB: mib(released - baseline),
  collectedInactiveDiffs: 39,
  retainedWorkingDiffs: 1,
}, null, 2))
