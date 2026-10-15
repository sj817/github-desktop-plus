import assert from 'node:assert/strict'
import {
  findModifiedRowsFunction,
  patchRendererPerformance,
} from '../src/renderer-performance'
import { diffFixture, repositoryFixture } from './fixtures/renderer-performance'

interface Line {
  type: 'add' | 'delete'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
  originalLineNumber: number
  noTrailingNewLine: boolean
}
interface ModifiedLine { line: Line; diffLineNumber: number }

let shifts = 0
class TrackedArray<T> extends Array<T> {
  override shift(): T | undefined {
    shifts++
    return super.shift()
  }
}

function compileRows(source: string) {
  const fn = findModifiedRowsFunction(source)
  assert.ok(fn)
  return new Function('Array', 'Yd', 'CS', 'ht', 'ES', 'nU', `${fn.source};return ${fn.name}`)(
    TrackedArray,
    { Add: 'add', Delete: 'delete' },
    { Modified: 'Modified', Deleted: 'Deleted', Added: 'Added' },
    (message: string, value: unknown) => {
      assert.notEqual(value, undefined, message)
      return value
    },
    (before: string, after: string) => ({ before: { text: before }, after: { text: after } }),
    ({ line }: ModifiedLine, side: 'oldLineNumber' | 'newLineNumber', token: unknown) => ({
      content: line.content,
      lineNumber: line[side],
      diffLineNumber: line.originalLineNumber,
      noNewLineIndicator: line.noTrailingNewLine,
      tokens: token === undefined ? [] : [token],
    }),
  ) as (lines: readonly ModifiedLine[], sideBySide: boolean) => unknown
}

function lines(deleted: number, added: number, sparse = false): ModifiedLine[] {
  let originalLineNumber = 41
  return (['delete', 'add'] as const).flatMap(type => Array.from(
    { length: type === 'delete' ? deleted : added },
    (_, i) => ({
      diffLineNumber: originalLineNumber,
      line: {
        type,
        content: sparse && i % 3 !== 1 ? 'x'.repeat(1100) : `${type} line ${i}`,
        oldLineNumber: type === 'delete' ? i + 10 : null,
        newLineNumber: type === 'add' ? i + 20 : null,
        originalLineNumber: originalLineNumber++,
        noTrailingNewLine: i === 2,
      },
    }),
  ))
}

const patched = patchRendererPerformance(diffFixture)
assert.equal(patched.applied, 1)
assert.deepEqual(patched.patches, ['linear-diff-token-consumption'])
const originalRows = compileRows(diffFixture)
const optimizedRows = compileRows(patched.code)

// Equality covers every output token, source line, original diff line (partial
// staging/discard selection), hunk anchor, newline marker, and row ordering.
for (const [deleted, added] of [[0, 0], [0, 8], [7, 0], [4, 4], [5, 8], [9, 3], [3000, 3000]]) {
  for (const sparse of [false, true]) {
    for (const sideBySide of [false, true]) {
      const input = lines(deleted!, added!, sparse)
      const snapshot = structuredClone(input)
      const expected = originalRows(input, sideBySide)
      shifts = 0
      const actual = optimizedRows(input, sideBySide)
      assert.deepEqual(actual, expected)
      assert.equal(shifts, 0, 'row assembly must not move the remaining token array per row')
      assert.deepEqual(input, snapshot, 'input diff model must remain unchanged')
    }
  }
}
console.log('  ok  full row and token parity for unified, side-by-side, unequal and sparse large diffs')

// Versions with unknown shapes must run their original renderer untouched.
for (const source of [
  'function unrelated(){return 1}',
  diffFixture + diffFixture,
  diffFixture.replace('o.shift()', 'o.pop()'),
  diffFixture.replace('return r}', 'r.push(o.length);return r}'),
  diffFixture.replace('let l=0;', 'let __gdpDiffTokenBefore=0;let l=0;'),
]) {
  const result = patchRendererPerformance(source)
  assert.equal(result.code, source)
  assert.equal(result.applied, 0)
}
assert.equal(patchRendererPerformance(patched.code).code, patched.code)
assert.equal(patchRendererPerformance(patched.code).applied, 0)
console.log('  ok  unknown, ambiguous, already-patched and unsafe token-array shapes fail open')

const repositoryPatch = patchRendererPerformance(repositoryFixture)
assert.deepEqual(repositoryPatch.patches, ['skip-stale-repository-selection'])
const RepositoryRefresh = new Function('ur', 'fr', `return class {${repositoryPatch.code}}`)(
  () => true,
  (repository: unknown) => repository,
) as new () => Record<string, unknown> & {
  selectedRepository: unknown
  _selectRepositoryRefreshTasks(repo: unknown, previous: unknown): Promise<unknown>
}
const selected = { id: 1 }
const other = { id: 2 }
const calls: string[] = []
const instance = new RepositoryRefresh()
for (const method of [
  '_refreshRepository', '_refreshIssues', 'refreshMentionables', 'onPullRequestChanged',
  'stopBackgroundFetching', 'stopPullRequestUpdater', 'stopBackgroundPruner',
  'startBackgroundFetching', 'startPullRequestUpdater', 'startBackgroundPruner',
  'addUpstreamRemoteIfNeeded',
]) {
  instance[method] = () => calls.push(method)
}
instance.pullRequestCoordinator = {
  getAllPullRequests: async () => { calls.push('getAllPullRequests'); return [] },
}
instance.repositoryWithRefreshedGitHubRepository = (repository: unknown) => repository
instance.selectedRepository = other
assert.equal(await instance._selectRepositoryRefreshTasks(selected, other), null)
assert.equal(calls.length, 0, 'stale repository must not start Git/network work')
instance.selectedRepository = selected
assert.equal(await instance._selectRepositoryRefreshTasks(selected, other), selected)
assert.ok(calls.includes('_refreshRepository'))
assert.ok(calls.includes('getAllPullRequests'))
assert.ok(calls.includes('startBackgroundFetching'))
calls.length = 0
instance.selectedRepository = { id: selected.id }
assert.equal(await instance._selectRepositoryRefreshTasks(selected, other), null)
assert.ok(calls.includes('_refreshRepository'), 'recovered model with the same ID still requires its refresh')
assert.ok(!calls.includes('startBackgroundFetching'), 'upstream identity guard remains unchanged')
calls.length = 0
instance.selectedRepository = selected
instance._refreshRepository = () => { instance.selectedRepository = other }
assert.equal(await instance._selectRepositoryRefreshTasks(selected, other), null)
assert.ok(!calls.includes('startBackgroundFetching'), 'upstream late guard must remain active')
assert.equal(patchRendererPerformance(repositoryPatch.code).code, repositoryPatch.code)
for (const source of [
  repositoryFixture + repositoryFixture,
  repositoryFixture.replace('this.selectedRepository!==e', 'this.selectedRepository===e'),
]) {
  assert.equal(patchRendererPerformance(source).code, source)
}
console.log('  ok  stale selections skip work; current selections and upstream late guard remain intact')
