import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Script } from 'node:vm'
import {
  highlightPoolSource,
  patchRendererMemory,
  releaseInactiveWorkingDiffs,
} from '../src/renderer-memory'
import { memoryFixture } from './fixtures/renderer-memory'

function repositoryState(diff: unknown, kind = 'WorkingDirectory') {
  return {
    changesState: {
      selection: { kind, diff, selectedFileIDs: ['source.ts'] },
      commitMessage: { summary: 'unfinished draft', description: 'details' },
      workingDirectory: { files: [{ selection: new Set([3, 7]) }] },
    },
    commitSelection: { shas: ['abc'], diff: { text: 'history must remain' } },
    isCommitting: true,
  }
}

test('only inactive working diffs are released; drafts and partial selection retain identity', () => {
  const active = repositoryState({ text: 'active' })
  const cold = repositoryState({ text: 'inactive' })
  const stash = repositoryState({ text: 'stash' }, 'Stash')
  const states = new Map([['active', active], ['cold', cold], ['stash', stash]])
  assert.equal(releaseInactiveWorkingDiffs(states, 'active'), 1)
  const next = states.get('cold')!
  assert.equal(next.changesState.selection.diff, null)
  assert.equal(states.get('active'), active)
  assert.equal(states.get('stash'), stash)
  assert.equal(next.changesState.commitMessage, cold.changesState.commitMessage)
  assert.equal(next.changesState.workingDirectory, cold.changesState.workingDirectory)
  assert.equal(next.changesState.selection.selectedFileIDs, cold.changesState.selection.selectedFileIDs)
  assert.equal(next.commitSelection, cold.commitSelection)
  assert.equal(next.isCommitting, true)
  assert.equal(cold.changesState.selection.diff && typeof cold.changesState.selection.diff, 'object')
})

test('visiting many large working diffs retains one current diff, not one per repository', () => {
  const states = new Map<string, ReturnType<typeof repositoryState>>()
  for (let index = 0; index < 100; index++) {
    const key = String(index)
    states.set(key, repositoryState({ text: 'x'.repeat(1024 * 1024), hunks: [] }))
    releaseInactiveWorkingDiffs(states, key)
  }
  const retained = [...states.values()].filter(state => state.changesState.selection.diff !== null)
  assert.equal(retained.length, 1)
  assert.equal(states.size, 100, 'repository metadata and user state are preserved')
  releaseInactiveWorkingDiffs(states, undefined)
  assert.ok([...states.values()].every(state => state.changesState.selection.diff === null))
})

class Clock {
  now = 0
  next = 1
  readonly jobs = new Map<number, { at: number; run: () => void }>()
  setTimeout = (run: () => void, duration: number): number => {
    const id = this.next++
    this.jobs.set(id, { at: this.now + duration, run })
    return id
  }
  clearTimeout = (id: number): void => { this.jobs.delete(id) }
  advance(duration: number): void {
    const end = this.now + duration
    while (true) {
      const next = [...this.jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.now = next[1].at
      this.jobs.delete(next[0])
      next[1].run()
    }
    this.now = end
  }
}

interface Message { data: unknown }
class WorkerDouble {
  static workers: WorkerDouble[] = []
  onmessage: ((event: Message) => void) | null = null
  onerror: ((event: { error: Error }) => void) | null = null
  onmessageerror: (() => void) | null = null
  request: unknown = null
  terminated = false
  constructor(readonly uri: string) { WorkerDouble.workers.push(this) }
  postMessage(request: unknown) { this.request = request }
  terminate() { this.terminated = true; this.request = null }
  reply(data: unknown) {
    this.request = null
    this.onmessage?.({ data })
  }
}

interface Pool {
  enqueue(request: unknown): Promise<unknown>
  active: Set<WorkerDouble>
  idle: Array<{ worker: WorkerDouble }>
  queue: Array<{ request: unknown }>
}

function poolHarness() {
  WorkerDouble.workers = []
  const clock = new Clock()
  const pool = new Function('Worker', 'window', `return new (${highlightPoolSource})('highlighter.js')`)(WorkerDouble, clock) as Pool
  return { pool, clock }
}

test('highlight concurrency and waiting inputs are bounded; all promises settle', async () => {
  const { pool } = poolHarness()
  const pending = Array.from({ length: 12 }, (_, id) => pool.enqueue({ id }))
  assert.equal(WorkerDouble.workers.length, 2)
  assert.equal(pool.active.size, 2)
  assert.equal(pool.queue.length, 4)
  let reply = 0
  while (pool.active.size) {
    assert.ok(pool.active.size <= 2)
    assert.ok(pool.queue.length <= 4)
    const worker = [...pool.active][0]!
    const request = worker.request as { id: number }
    worker.reply({ id: request.id, reply: reply++ })
    // drain may immediately reuse this worker for another request.
    if (!pool.active.has(worker)) {
      assert.equal(worker.onerror, null, 'idle workers must not retain promise/error handlers')
      assert.equal(worker.onmessage, null)
    }
  }
  const results = await Promise.all(pending)
  for (let index = 2; index < 8; index++) assert.deepEqual(results[index], {})
  for (const index of [0, 1, 8, 9, 10, 11]) {
    assert.equal((results[index] as { id: number }).id, index)
  }
  assert.equal(pool.queue.length, 0)
  assert.equal(WorkerDouble.workers.length, 2)
})

test('idle workers release after 30 seconds and can be recreated', async () => {
  const { pool, clock } = poolHarness()
  const first = pool.enqueue({ contentLines: ['text'] })
  const worker = WorkerDouble.workers[0]!
  const tokens = { line: { token: 'keyword' } }
  worker.reply(tokens)
  assert.equal(await first, tokens)
  assert.equal(worker.onmessage, null)
  assert.equal(worker.onerror, null)
  assert.equal(worker.onmessageerror, null)
  clock.advance(29_999)
  assert.equal(worker.terminated, false)
  clock.advance(1)
  assert.equal(worker.terminated, true)
  assert.equal(pool.idle.length, 0)
  const second = pool.enqueue({ contentLines: ['next'] })
  WorkerDouble.workers[1]!.reply({ next: true })
  assert.deepEqual(await second, { next: true })
})

test('timeouts, worker errors and uncloneable inputs release slots and reject', async () => {
  const { pool, clock } = poolHarness()
  const timed = pool.enqueue({ id: 1 })
  const timeout = assert.rejects(timed, /timed out/)
  clock.advance(5_000)
  await timeout
  assert.equal(pool.active.size, 0)
  assert.equal(WorkerDouble.workers[0]!.terminated, true)
  const failed = pool.enqueue({ id: 2 })
  const failure = assert.rejects(failed, /worker failed/)
  WorkerDouble.workers[1]!.onerror?.({ error: new Error('worker failed') })
  await failure
  assert.equal(pool.active.size, 0)
  const originalPost = WorkerDouble.prototype.postMessage
  WorkerDouble.prototype.postMessage = () => { throw new Error('cannot clone') }
  try { await assert.rejects(pool.enqueue({}), /cannot clone/) } finally {
    WorkerDouble.prototype.postMessage = originalPost
  }
  assert.equal(pool.active.size, 0)
  assert.equal(pool.idle.length, 0)
})

test('memory transforms match together, stay idempotent, and reject ambiguous sources', () => {
  const result = patchRendererMemory(memoryFixture)
  assert.equal(result.applied, 2)
  assert.deepEqual(result.skipped, [])
  new Script(result.code)
  assert.equal(patchRendererMemory(result.code).code, result.code)
  for (const source of [
    'new upstream renderer',
    memoryFixture + memoryFixture,
    memoryFixture.replace('this.selectedRepository=e,this.emitUpdate()', 'this.selectedRepository=e'),
    memoryFixture.replace('withSelectableLines(h)', 'newUnknownSelection(h)'),
  ]) {
    const changed = patchRendererMemory(source)
    assert.ok(!changed.patches.includes('release-inactive-working-diffs'))
    if (source !== memoryFixture + memoryFixture && source !== 'new upstream renderer') {
      assert.ok(changed.patches.includes('bounded-highlight-workers'), 'independent supported patch remains available')
    }
  }
})

class Repository {
  missing = false
  constructor(readonly id: number, readonly hash = String(id)) {}
}

function runtimeHarness() {
  const states = new Map<string, any>()
  let getDiff: (repository: Repository, file: unknown) => Promise<unknown> = async () => ({ kind: 'Text', hunks: [] })
  let diffLoads = 0
  let selectionUpdates = 0
  const { Fixture, highlight } = new Function(
    'hr', 'FR', 'ps', 'bT', 'nt', 'iE', 'Pg', 'Kd', 'gp', 'Worker', 'window',
    patchRendererMemory(memoryFixture).code + ';return {Fixture:MemoryFixture,highlight:xH}',
  )(
    Repository, { NotApplicable: 0 }, () => {}, 'repo-id', { WorkingDirectory: 'WorkingDirectory' },
    (repository: Repository, file: unknown) => { diffLoads++; return getDiff(repository, file) },
    (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]),
    { Text: 'Text', LargeText: 'LargeText' },
    { fromFiles: (files: unknown[]) => ({ files, findFileWithID: () => files[0] }) },
    WorkerDouble, new Clock(),
  )
  const app = new Fixture() as Record<string, any>
  app.currentOnboardingTutorialStep = 0
  app.repositoryStateCache = {
    repositoryState: states,
    get: (repository: Repository) => states.get(repository.hash),
    updateChangesState(repository: Repository, update: (state: unknown) => unknown) {
      const previous = states.get(repository.hash)
      states.set(repository.hash, { ...previous, changesState: { ...previous.changesState, ...update(previous.changesState) as object } })
      selectionUpdates++
    },
  }
  for (const name of ['emitUpdate', 'stopBackgroundFetching', 'stopPullRequestUpdater', '_clearBanner', 'stopBackgroundPruner', 'updateBranchProtectionsFromAPI']) app[name] = () => {}
  app.notificationsStore = { selectRepository() {} }
  app.gitStoreCache = { remove() {} }
  app.recoverMissingRepository = async (repository: Repository) => repository
  app._selectRepositoryRefreshTasks = async (repository: Repository) => repository
  return { app, states, highlight, setLoader(value: typeof getDiff) { getDiff = value }, loads: () => diffLoads, updates: () => selectionUpdates }
}

function loadedState() {
  const selection = { withSelectableLines: () => selection }
  const file: any = { id: 'source.ts', selection, withSelection: () => file }
  const state = repositoryState({ text: 'large old diff' })
  return { ...state, changesState: { ...state.changesState, workingDirectory: { files: [file], findFileWithID: () => file } } }
}

test('real upstream methods evict on selection, stop stale loads, and reload on return', async () => {
  const { app, states, setLoader, loads, updates, highlight } = runtimeHarness()
  const first = new Repository(1)
  const second = new Repository(2)
  states.set(first.hash, loadedState())
  states.set(second.hash, loadedState())
  app.selectedRepository = first
  let finish: (diff: unknown) => void = () => { throw new Error('loader was not called') }
  setLoader(() => new Promise(resolve => { finish = resolve }))
  const pending = app.updateChangesWorkingDirectoryDiff(first)
  assert.equal(loads(), 1)
  await app._selectRepository(second)
  assert.equal(states.get(first.hash).changesState.selection.diff, null)
  finish({ kind: 'Text', hunks: [] })
  await pending
  assert.equal(updates(), 0, 'late old result must not rebuild partial-selection sets or restore cold diff')
  await app.updateChangesWorkingDirectoryDiff(first)
  assert.equal(loads(), 1, 'inactive repository must not start view-only diff work')
  await app._selectRepository(first)
  const fresh = { kind: 'Text', hunks: [] }
  setLoader(async () => fresh)
  await app.updateChangesWorkingDirectoryDiff(new Repository(1))
  assert.equal(states.get(first.hash).changesState.selection.diff, fresh)
  assert.equal(updates(), 1)
  assert.deepEqual(await highlight([], '', '', 4, []), {})
})

test('newer refreshes and switching away/back invalidate older results for the same file', async () => {
  const { app, states, setLoader, updates } = runtimeHarness()
  const first = new Repository(1)
  const second = new Repository(2)
  states.set(first.hash, loadedState())
  states.set(second.hash, loadedState())
  app.selectedRepository = first
  const finish: Array<(diff: unknown) => void> = []
  setLoader(() => new Promise(resolve => { finish.push(resolve) }))
  const older = app.updateChangesWorkingDirectoryDiff(first)
  const newer = app.updateChangesWorkingDirectoryDiff(first)
  const fresh = { kind: 'Text', hunks: [] }
  finish[1]!(fresh)
  await newer
  finish[0]!({ kind: 'Text', hunks: [] })
  await older
  assert.equal(updates(), 1)
  assert.equal(states.get(first.hash).changesState.selection.diff, fresh)
  const leaving = app.updateChangesWorkingDirectoryDiff(first)
  await app._selectRepository(second)
  await app._selectRepository(first)
  finish[2]!({ kind: 'Text', hunks: [] })
  await leaving
  assert.equal(updates(), 1)
  assert.equal(states.get(first.hash).changesState.selection.diff, null)
})
