/**
 * Compare the actual installed GitHub Desktop row builder before/after GDP's
 * patch, without launching Desktop or executing the rest of its bundle.
 *
 * pnpm exec tsx scripts/checks/diff-performance.ts <path/to/renderer.js>
 *
 * The token generator and row-data helper are deterministic substitutes: this
 * measures row/token assembly, not Git, word diffing, layout or end-to-end UI.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, Script } from 'node:vm'
import {
  findModifiedRowsFunction,
  patchRendererPerformance,
} from '../../packages/hooks/src/renderer-performance'

const file = process.argv[2]
if (!file) {
  throw new Error('Usage: pnpm exec tsx scripts/checks/diff-performance.ts <renderer.js>')
}

const original = await readFile(resolve(file), 'utf8')
const result = patchRendererPerformance(original)
// Parse the complete transformed bundle, but never run the application here.
new Script(result.code, { filename: file })
const before = findModifiedRowsFunction(original)
const after = findModifiedRowsFunction(result.code)
assert.ok(before && after, 'Expected one supported getModifiedRows function')
assert.notEqual(before.source, after.source, 'Row-builder performance patch did not apply')

function identifier(pattern: RegExp): string {
  const value = pattern.exec(before!.source)?.[1]
  assert.ok(value, `Unsupported row-builder dependency: ${pattern}`)
  return value
}

interface Line {
  line: {
    type: string
    content: string
    oldLineNumber?: number
    newLineNumber?: number
    originalLineNumber: number
  }
  diffLineNumber: number
}

const context = createContext({
  [identifier(/\.line\.type===([\w$]+)\.Add/)]: { Add: 'add', Delete: 'delete' },
  [identifier(/type:([\w$]+)\.Modified/)]: {
    Added: 'added', Deleted: 'deleted', Modified: 'modified',
  },
  [identifier(/([\w$]+)\("Unexpected null line",/)]: (_: string, value: unknown) => value,
  [identifier(/\{before:[\w$]+,after:[\w$]+\}=([\w$]+)\(/)]: (oldText: string, newText: string) => ({
    before: { 0: { length: oldText.length, token: 'diff-deleted' } },
    after: { 0: { length: newText.length, token: 'diff-added' } },
  }),
  [identifier(/beforeData:([\w$]+)\(/)]: (line: Line, side: 'oldLineNumber' | 'newLineNumber', tokens: unknown) => ({
    content: line.line.content,
    lineNumber: line.line[side],
    diffLineNumber: line.line.originalLineNumber,
    tokens: tokens === undefined ? [] : [tokens],
  }),
})
type RowBuilder = (lines: Line[], sideBySide: boolean) => unknown[]
const originalBuilder = new Script(`(${before.source})`).runInContext(context) as RowBuilder
const patchedBuilder = new Script(`(${after.source})`).runInContext(context) as RowBuilder

function lines(count: number, sparse: boolean): Line[] {
  const result: Line[] = []
  for (const type of ['delete', 'add']) {
    for (let index = 0; index < count; index++) {
      result.push({
        line: {
          type,
          // Long lines intentionally leave holes in the upstream token array.
          content: sparse && index % 3 === 0 ? 'x'.repeat(1025) : `${type} line ${index}`,
          oldLineNumber: type === 'delete' ? index + 1 : undefined,
          newLineNumber: type === 'add' ? index + 1 : undefined,
          originalLineNumber: result.length + 1,
        },
        diffLineNumber: result.length + 1,
      })
    }
  }
  return result
}

function medianTime(build: RowBuilder, input: Line[]): number {
  const samples: number[] = []
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now()
    const rows = build(input, true)
    samples.push(performance.now() - start)
    assert.equal(rows.length, input.length / 2)
  }
  return samples.sort((a, b) => a - b)[2]!
}

const warmup = lines(500, false)
for (let run = 0; run < 10; run++) {
  originalBuilder(warmup, true)
  patchedBuilder(warmup, true)
}

console.log(`Bundle: ${resolve(file)}`)
console.log(`Applied patches: ${result.applied}; complete bundle syntax: valid`)
console.log('Row/token assembly only; median of 5 runs; complete row output equality checked.')
for (const sparse of [false, true]) {
  for (const count of [1_000, 10_000, 50_000]) {
    const input = lines(count, sparse)
    for (const sideBySide of [true, false]) {
      assert.deepEqual(patchedBuilder(input, sideBySide), originalBuilder(input, sideBySide))
    }
    const baseline = medianTime(originalBuilder, input)
    const optimized = medianTime(patchedBuilder, input)
    console.log(JSON.stringify({
      rows: count,
      tokens: sparse ? 'sparse' : 'dense',
      beforeMs: +baseline.toFixed(2),
      afterMs: +optimized.toFixed(2),
      speedup: +(baseline / optimized).toFixed(2),
    }))
  }
}
