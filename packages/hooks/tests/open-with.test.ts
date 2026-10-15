/**
 * Unit tests for the "open with" context-menu rewriting.
 *
 * These cover the two things that must not break: the entries land in the
 * right slots, and the index path the main process replies with is mapped
 * back onto GitHub Desktop's own numbering (otherwise clicking "Remove"
 * would run some other menu item's action).
 *
 * Run with: pnpm --filter @github-desktop-plus/hooks test
 */
import assert from 'node:assert/strict'
import {
  planInjection,
  resolveReply,
  type OpenWithSettings,
  type SerializedMenuItem,
} from '../src/preload/open-with'

// Exactly what GD's `generateRepositoryListContextMenu` produces on Windows
// for a GitHub-backed repository with no alias and no worktree support.
function repoMenu(): SerializedMenuItem[] {
  return [
    { label: 'Create alias' },
    { label: 'Copy repo name' },
    { label: 'Copy repo path' },
    { type: 'separator' },
    { label: 'View on GitHub', enabled: true },
    { label: 'Open in Command Prompt', enabled: true },
    { label: 'Show in Explorer', enabled: true },
    { label: 'Open in Visual Studio Code', enabled: true },
    { type: 'separator' },
    { label: 'Remove' },
  ]
}

const REMOVE_INDEX = 9

function settings(overrides: Partial<OpenWithSettings> = {}): OpenWithSettings {
  return {
    submenu: false,
    items: [
      { id: 'vscode', label: 'VS Code', group: 'editor', enabled: true },
      { id: 'zed', label: 'Zed', group: 'editor', enabled: true },
      { id: 'wsl', label: 'WSL (Ubuntu)', group: 'shell', enabled: true },
    ],
    ...overrides,
  }
}

const labels = (items: readonly SerializedMenuItem[]) => items.map(item => item.label ?? '—')

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

test("appends our entries and never touches GD's own", () => {
  const plan = planInjection(repoMenu(), settings())
  assert.ok(plan)
  assert.deepEqual(labels(plan.items), [
    'Create alias',
    'Copy repo name',
    'Copy repo path',
    '—',
    'View on GitHub',
    'Open in Command Prompt',
    'Open in WSL (Ubuntu)',
    'Show in Explorer',
    'Open in Visual Studio Code',
    'Open in VS Code',
    'Open in Zed',
    '—',
    'Remove',
  ])
})

test('adds nothing next to a group with no configured entries', () => {
  const onlyShell = settings({
    items: [{ id: 'wsl', label: 'WSL (Ubuntu)', group: 'shell', enabled: true }],
  })
  const plan = planInjection(repoMenu(), onlyShell)
  assert.ok(plan)
  assert.deepEqual(labels(plan.items).filter(l => l.startsWith('Open in ')), [
    'Open in Command Prompt',
    'Open in WSL (Ubuntu)',
    'Open in Visual Studio Code',
  ])
})

test('mirrors the disabled state of a missing repository', () => {
  const menu = repoMenu().map(item =>
    typeof item.label === 'string' && item.label.startsWith('Open in ')
      ? { ...item, enabled: false }
      : item,
  )
  const plan = planInjection(menu, settings())
  assert.ok(plan)
  for (const item of plan.items) {
    if (typeof item.label === 'string' && item.label.startsWith('Open in ')) {
      assert.equal(item.enabled, false, `${item.label} should be disabled`)
    }
  }
})

test('maps a native click back onto GD\'s own numbering', () => {
  const plan = planInjection(repoMenu(), settings())
  assert.ok(plan)
  const removeSlot = plan.items.findIndex(item => item.label === 'Remove')
  // Injection shifted "Remove" by three; GD must still be told index 9.
  assert.equal(removeSlot, REMOVE_INDEX + 3)
  assert.deepEqual(resolveReply(plan, [removeSlot]), {
    kind: 'native',
    indices: [REMOVE_INDEX],
  })
})

test('preserves the tail of a native submenu index path', () => {
  const plan = planInjection(repoMenu(), settings())
  assert.ok(plan)
  const aliasSlot = plan.items.findIndex(item => item.label === 'Create alias')
  assert.deepEqual(resolveReply(plan, [aliasSlot, 2]), { kind: 'native', indices: [0, 2] })
})

test('resolves a click on one of our entries to its id', () => {
  const plan = planInjection(repoMenu(), settings())
  assert.ok(plan)
  const zedSlot = plan.items.findIndex(item => item.label === 'Open in Zed')
  assert.deepEqual(resolveReply(plan, [zedSlot]), { kind: 'gdp', id: 'zed' })
})

test('collapses into a single submenu when asked', () => {
  const plan = planInjection(repoMenu(), settings({ submenu: true }))
  assert.ok(plan)
  const submenuSlot = plan.items.findIndex(item => item.label === 'Open with')
  assert.equal(submenuSlot, plan.submenuSlot)
  assert.deepEqual(labels(plan.items[submenuSlot]?.submenu ?? []), [
    'Open in VS Code',
    'Open in Zed',
    'Open in WSL (Ubuntu)',
  ])
  assert.deepEqual(resolveReply(plan, [submenuSlot, 2]), { kind: 'gdp', id: 'wsl' })
  // Both of GD's own launchers stay where they were.
  assert.deepEqual(labels(plan.items).filter(l => l.startsWith('Open in ')), [
    'Open in Command Prompt',
    'Open in Visual Studio Code',
  ])
})

function fileMenu(): SerializedMenuItem[] {
  return [
    { label: 'Discard changes' },
    { type: 'separator' },
    { label: 'Ignore folder (add to .gitignore)', submenu: [{ label: '/docs' }] },
    { label: 'Copy file path' },
    { label: 'Copy relative file path' },
    { label: 'Show in Explorer' },
    { label: 'Open in Zed' },
    { label: 'Open with default program' },
  ]
}

test('file menus get shells before reveal and editors after the native editor', () => {
  const plan = planInjection(fileMenu(), settings())
  assert.ok(plan)
  assert.deepEqual(labels(plan.items).slice(4), [
    'Copy relative file path', 'Open in WSL (Ubuntu)', 'Show in Explorer',
    'Open in Zed', 'Open in VS Code', 'Open in Zed', 'Open with default program',
  ])
  const ignore = plan.items.findIndex(item => item.label?.startsWith('Ignore folder'))
  assert.deepEqual(resolveReply(plan, [ignore, 0]), { kind: 'native', indices: [2, 0] })
  const defaultProgram = plan.items.findIndex(item => item.label === 'Open with default program')
  assert.deepEqual(resolveReply(plan, [defaultProgram]), { kind: 'native', indices: [7] })
  assert.deepEqual(resolveReply(plan, [5]), { kind: 'gdp', id: 'wsl' })
})

test('multi-selected file menus keep the same launch entries and native indices', () => {
  const menu = fileMenu().map(item => item.label === 'Copy file path' ? { label: 'Copy paths' } : item)
  const plan = planInjection(menu, settings({ submenu: true }))
  assert.ok(plan)
  assert.deepEqual(resolveReply(plan, [plan.submenuSlot, 0]), { kind: 'gdp', id: 'vscode' })
  assert.deepEqual(resolveReply(plan, [plan.items.findIndex(item => item.label === 'Copy paths')]), { kind: 'native', indices: [3] })
})

test('deleted files disable editors while their directory can still open in a terminal', () => {
  const menu = fileMenu().map(item => item.label === 'Open in Zed' || item.label === 'Show in Explorer' ? { ...item, enabled: false } : item)
  for (const submenu of [false, true]) {
    const plan = planInjection(menu, settings({ submenu }))
    assert.ok(plan)
    const injected = submenu ? plan.items[plan.submenuSlot]!.submenu! : plan.items.filter((_item, index) => plan.slots[index]?.kind === 'gdp')
    assert.equal(injected.find(item => item.label === 'Open in VS Code')?.enabled, false)
    assert.equal(injected.find(item => item.label === 'Open in WSL (Ubuntu)')?.enabled, true)
  }
})

test('file menus without an editor anchor still support configured editors', () => {
  const plan = planInjection(fileMenu().filter(item => item.label !== 'Open in Zed'), settings())
  assert.ok(plan)
  assert.ok(plan.items.some(item => item.label === 'Open in VS Code'))
})

test('ignores branch, commit and text menus', () => {
  assert.equal(planInjection([{ label: 'Copy SHA' }, { label: 'Open in Visual Studio Code' }], settings()), null)
  assert.equal(planInjection([{ label: 'Copy' }, { label: 'Select All' }], settings()), null)
})

test('ignores the menu when nothing is configured', () => {
  assert.equal(planInjection(repoMenu(), settings({ items: [] })), null)
})

console.log(failures === 0 ? '\nall open-with tests passed' : `\n${failures} test(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
