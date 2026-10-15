/**
 * "Open with" context-menu entries — renderer side.
 *
 * GitHub Desktop's repository and file context menus are built in the renderer and shipped
 * to the main process over the `show-contextual-menu` IPC channel; the reply is
 * the index path of whatever the user clicked, which GD then maps back onto its
 * own (unserialized) item array to run that item's `action`.
 *
 * So we can add entries purely by wrapping that one channel:
 *   1. splice our items into the array on the way out, and
 *   2. on the way back, either handle our own item (and answer `null`, so GD
 *      runs nothing) or rewrite the index into GD's original numbering.
 *
 * This script is injected AFTER the i18n preload, which makes our wrapper the
 * outer one — we therefore see GD's original English labels, and our own labels
 * pass through the translation layer untouched.
 */
import { readGdRepositories } from './lib/gd-db'
import type { OpenWithLaunchRequest } from '@github-desktop-plus/shared'

export interface SerializedMenuItem {
  label?: string
  type?: string
  enabled?: boolean
  submenu?: SerializedMenuItem[]
  [key: string]: unknown
}

export interface ConfiguredItem {
  id: string
  label: string
  group: 'editor' | 'shell'
  enabled: boolean
}

export interface OpenWithSettings {
  submenu: boolean
  items: ConfiguredItem[]
}

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

const CHANNEL = 'show-contextual-menu'

// GD builds these labels in `repository-list-item-context-menu.ts` /
// `ui/lib/context-menu.ts`. `Copy repo path` is the marker that tells us this
// menu belongs to a repository row rather than a file, branch or commit.
const REPO_MENU_MARKERS = new Set(['Copy repo path', 'Copy Repo Path'])
const FILE_MENU_MARKERS = new Set(['Copy file path', 'Copy File Path', 'Copy paths', 'Copy Paths'])
const REVEAL_LABELS = new Set([
  'Show in Explorer',
  'Reveal in Finder',
  'Show in your File Manager',
])
const OPEN_IN_PREFIX = 'Open in '

// English so the existing i18n layer localises it like any other GD label
// (see locales/<locale>/ui-context-menus.json).
const SUBMENU_LABEL = 'Open with'

function log(message: string): void {
  console.log(`[GDP open-with] ${message}`)
}

// ── Config ──────────────────────────────────────────────────────────────────

let settings: OpenWithSettings | null = null
let settingsPromise: Promise<OpenWithSettings> | null = null

function parseSettings(raw: unknown): OpenWithSettings {
  const section = (raw as { open_with?: Record<string, unknown> } | null)?.open_with
  const rawItems = Array.isArray(section?.items) ? (section?.items as Record<string, unknown>[]) : []

  const items: ConfiguredItem[] = []
  rawItems.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    if (typeof entry.path !== 'string' || entry.path === '') return
    if (entry.enabled === false) return
    const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : `item-${index}`
    const label = typeof entry.label === 'string' && entry.label !== '' ? entry.label : id
    items.push({
      id,
      label,
      group: entry.group === 'shell' ? 'shell' : 'editor',
      enabled: true,
    })
  })

  return {
    submenu: section?.submenu === true,
    items,
  }
}

function loadSettings(ipc: IpcRendererLike): Promise<OpenWithSettings> {
  settingsPromise = ipc
    .invoke('gdp:get-config')
    .then(raw => {
      settings = parseSettings(raw)
      return settings
    })
    .catch(() => {
      settings = settings ?? { submenu: false, items: [] }
      return settings
    })
  return settingsPromise
}

// ── Which repository was right-clicked ──────────────────────────────────────

// GD's `app-store.ts` LastSelectedRepositoryIDKey.
const LAST_SELECTED_REPO_KEY = 'last-selected-repository-id'

const ROW_SELECTOR = '.repository-list-item'
// GD's row handler sits on the outer `.list-item` (see `list-row.tsx`).
const ROW_CONTAINER_SELECTOR = '[role="option"], .list-item'

let pendingRepoPath: string | null = null
let pendingFile: { repositoryPath: string; path: string } | null = null

// Warmed up front so a right-click can resolve a repository synchronously —
// the menu is shown before any IndexedDB read could finish.
let repoPathById: Map<number, string> | null = null
let repoPathByName: Map<string, string> | null = null
let warmedAt = 0

async function warmRepoIndex(): Promise<void> {
  const now = Date.now()
  if (repoPathById !== null && now - warmedAt < 5000) return
  warmedAt = now

  const repos = await readGdRepositories()
  const byId = new Map<number, string>()
  const byName = new Map<string, string>()
  for (const repo of repos) {
    byId.set(repo.id, repo.path)
    // First writer wins; duplicate bare names are ambiguous either way, but the
    // qualified `owner/name` form is what GD renders when it disambiguates.
    if (!byName.has(repo.name)) byName.set(repo.name, repo.path)
    if (repo.owner) byName.set(`${repo.owner}/${repo.name}`, repo.path)
  }
  repoPathById = byId
  repoPathByName = byName
}

/**
 * React attaches the fiber for a DOM node under a `__reactFiber$<random>` key.
 * Walking up from the row reaches `RepositoryListItem`, whose props carry the
 * actual `Repository` model — including the path GD would use.
 */
interface Fiber { return?: Fiber | null; memoizedProps?: { repository?: { path?: unknown }; file?: { path?: unknown } } }

function fiberFor(el: Element): Fiber | null {
  const holder = el as unknown as Record<string, unknown>
  const fiberKey = Object.keys(holder).find(key => key.startsWith('__reactFiber$'))
  if (fiberKey === undefined) return null
  return holder[fiberKey] as Fiber | null
}

function repoPathFromFiber(el: Element): string | null {
  let fiber = fiberFor(el)
  for (let depth = 0; fiber && depth < 30; depth++) {
    const path = fiber.memoizedProps?.repository?.path
    if (typeof path === 'string' && path !== '') return path
    fiber = fiber.return ?? null
  }
  return null
}

/** Read the model, never the visually truncated PathLabel or current diff.
 * ChangedFile/CommittedFileItem owns `file`; its ancestors own `repository`.
 * Native editor actions also target the clicked row, even in a multi-selection.
 */
export function fileTargetFromElement(target: Element | null): { repositoryPath: string; path: string } | null {
  if (!target?.closest('.file-list')) return null
  const row = target.closest('.file') ?? target.closest(ROW_CONTAINER_SELECTOR)?.querySelector('.file')
  if (!row) return null
  let filePath: string | null = null
  let repositoryPath: string | null = null
  let fiber = fiberFor(row)
  for (let depth = 0; fiber && depth < 40; depth++) {
    const props = fiber.memoizedProps
    if (filePath === null && typeof props?.file?.path === 'string' && props.file.path !== '') filePath = props.file.path
    if (repositoryPath === null && typeof props?.repository?.path === 'string' && props.repository.path !== '') repositoryPath = props.repository.path
    if (filePath !== null && repositoryPath !== null) return { repositoryPath, path: filePath }
    fiber = fiber.return ?? null
  }
  return null
}

function findRepoRow(event: MouseEvent): Element | null {
  const target = event.target instanceof Element ? event.target : null
  if (target === null) return null

  const direct = target.closest(ROW_SELECTOR)
  if (direct !== null) return direct

  // Rows are a fixed 29px tall but the inner element is only as tall as its
  // text and vertically centred, so the few dead pixels above and below it
  // still open GD's menu. Look inside whatever row we landed on.
  const inside = target.closest(ROW_CONTAINER_SELECTOR)?.querySelector(ROW_SELECTOR)
  if (inside != null) return inside

  // Last resort for anything painted over the row.
  for (const el of document.elementsFromPoint(event.clientX, event.clientY)) {
    const hit = el.closest(ROW_SELECTOR)
    if (hit !== null) return hit
  }
  return null
}

function resolveRepoPath(event: MouseEvent): string | null {
  const row = findRepoRow(event)
  if (row === null) {
    // No row under the cursor — this is the toolbar's "current repository"
    // button, whose `onRepositoryToolbarButtonContextMenu` builds the very
    // same menu for the selected repository.
    const raw = localStorage.getItem(LAST_SELECTED_REPO_KEY)
    const id = raw === null ? NaN : parseInt(raw, 10)
    return Number.isFinite(id) ? repoPathById?.get(id) ?? null : null
  }

  const fromFiber = repoPathFromFiber(row)
  if (fromFiber !== null) return fromFiber

  const name = row.querySelector('.name')?.textContent?.trim()
  return (name ? repoPathByName?.get(name) : null) ?? null
}

function installContextTracker(): void {
  document.addEventListener(
    'contextmenu',
    event => {
      pendingRepoPath = resolveRepoPath(event)
      pendingFile = fileTargetFromElement(event.target instanceof Element ? event.target : null)
      // Keep the index fresh for repositories added since startup.
      void warmRepoIndex()
    },
    true,
  )
}

// ── Menu rewriting ──────────────────────────────────────────────────────────

/** Slot in GD's array that our entries attach to, plus what they replace. */
interface Anchors {
  shellIndex: number
  editorIndex: number
}

function findAnchors(items: readonly SerializedMenuItem[]): Anchors {
  const revealIndex = items.findIndex(
    item => typeof item.label === 'string' && REVEAL_LABELS.has(item.label),
  )
  const openIndices = items
    .map((item, index) => ({ item, index }))
    .filter(entry => typeof entry.item.label === 'string' && entry.item.label.startsWith(OPEN_IN_PREFIX))
    .map(entry => entry.index)

  // GD's order is: … View on GitHub, Open in <shell>, Show in Explorer,
  // Open in <editor> … so the reveal entry separates the two.
  const shellIndex = openIndices.find(index => revealIndex < 0 || index < revealIndex) ?? -1
  const editorIndex = openIndices.find(index => revealIndex >= 0 && index > revealIndex) ?? -1

  return { shellIndex, editorIndex }
}

export interface Plan {
  items: SerializedMenuItem[]
  /** Per top-level slot: GD's original index, or the id of one of our items. */
  slots: Array<{ kind: 'native'; index: number } | { kind: 'gdp'; id: string }>
  /** Set when everything is collapsed into one submenu. */
  submenuSlot: number
  submenuIds: string[]
}

function buildItem(item: ConfiguredItem, enabled: boolean): SerializedMenuItem {
  return { label: `${OPEN_IN_PREFIX}${item.label}`, enabled }
}

/** GD only ever puts "Copy repo path" on a repository's own context menu. */
export function isRepositoryMenu(items: readonly SerializedMenuItem[]): boolean {
  return items.some(item => typeof item.label === 'string' && REPO_MENU_MARKERS.has(item.label))
}

export function isFileMenu(items: readonly SerializedMenuItem[]): boolean {
  return items.some(item => typeof item.label === 'string' && FILE_MENU_MARKERS.has(item.label))
}

export function planInjection(
  items: readonly SerializedMenuItem[],
  config: OpenWithSettings,
): Plan | null {
  const fileMenu = isFileMenu(items)
  if ((!isRepositoryMenu(items) && !fileMenu) || config.items.length === 0) return null

  const revealIndex = items.findIndex(item => typeof item.label === 'string' && REVEAL_LABELS.has(item.label))
  const anchors = findAnchors(items)
  const shellIndex = fileMenu ? -1 : anchors.shellIndex
  const editorIndex = fileMenu ? items.findIndex(item => typeof item.label === 'string' && item.label.startsWith(OPEN_IN_PREFIX)) : anchors.editorIndex
  if (shellIndex < 0 && editorIndex < 0 && (!fileMenu || revealIndex < 0)) return null

  // Missing repositories disable GD's own launch entries; mirror that.
  const anchorIndex = editorIndex >= 0 ? editorIndex : fileMenu ? revealIndex : shellIndex
  const enabled = items[anchorIndex]?.enabled !== false

  const editors = config.items.filter(item => item.group === 'editor' && item.enabled)
  const shells = config.items.filter(item => item.group === 'shell' && item.enabled)
  const itemEnabled = (item: ConfiguredItem) => fileMenu && item.group === 'shell' ? true : enabled
  if (editors.length === 0 && shells.length === 0) return null

  const plan: Plan = { items: [], slots: [], submenuSlot: -1, submenuIds: [] }

  const push = (item: SerializedMenuItem, slot: Plan['slots'][number]) => {
    plan.items.push(item)
    plan.slots.push(slot)
  }

  if (config.submenu) {
    const ordered = [...editors, ...shells]
    items.forEach((item, index) => {
      push(item, { kind: 'native', index })
      if (index === anchorIndex) {
        plan.submenuSlot = plan.items.length
        plan.submenuIds = ordered.map(entry => entry.id)
        plan.items.push({
          label: SUBMENU_LABEL,
          enabled: ordered.some(itemEnabled),
          submenu: ordered.map(entry => buildItem(entry, itemEnabled(entry))),
        })
        plan.slots.push({ kind: 'gdp', id: '' })
      }
    })
    return plan
  }

  items.forEach((item, index) => {
    if (fileMenu && index === (revealIndex >= 0 ? revealIndex : anchorIndex)) {
      for (const entry of shells) push(buildItem(entry, true), { kind: 'gdp', id: entry.id })
    }
    // GD's own entries are always left alone; ours are appended right after
    // the native entry of the same group.
    push(item, { kind: 'native', index })
    const ours = index === (editorIndex >= 0 ? editorIndex : fileMenu ? anchorIndex : -1) ? editors : index === shellIndex ? shells : []
    for (const entry of ours) {
      push(buildItem(entry, enabled), { kind: 'gdp', id: entry.id })
    }
  })

  // Nothing to place next to (e.g. the user only configured shells but GD did
  // not render a shell entry) — leave the menu alone rather than guessing.
  return plan.slots.some(slot => slot.kind === 'gdp') ? plan : null
}

/**
 * Map the index path the main process replied with back onto either GD's own
 * numbering or one of our items.
 */
export function resolveReply(
  plan: Plan,
  reply: readonly number[],
): { kind: 'native'; indices: number[] } | { kind: 'gdp'; id: string } {
  const topLevelIndex = reply[0]
  if (topLevelIndex === undefined) return { kind: 'gdp', id: '' }
  const slot = plan.slots[topLevelIndex]
  if (slot === undefined) return { kind: 'gdp', id: '' }
  if (slot.kind === 'native') {
    return { kind: 'native', indices: [slot.index, ...reply.slice(1)] }
  }
  if (plan.submenuSlot === topLevelIndex) {
    const submenuIndex = reply[1]
    return { kind: 'gdp', id: submenuIndex === undefined ? '' : (plan.submenuIds[submenuIndex] ?? '') }
  }
  return { kind: 'gdp', id: slot.id }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function launch(ipc: IpcRendererLike, request: OpenWithLaunchRequest): void {
  ipc
    .invoke('gdp:open-with-launch', request)
    .then(raw => {
      const result = raw as { ok?: boolean; reason?: string } | null
      if (result?.ok !== true) {
        console.warn(`[GDP open-with] launch failed: ${result?.reason ?? 'unknown'}`)
      }
    })
    .catch(e => console.warn('[GDP open-with] launch failed:', e))
}

type GDPWindow = Window & { __gdpOpenWithInstalled?: boolean }

export function installOpenWith(): void {
  const gdpWindow = window as unknown as GDPWindow
  if (gdpWindow.__gdpOpenWithInstalled) return
  gdpWindow.__gdpOpenWithInstalled = true

  let ipc: IpcRendererLike
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ipc = (require as NodeRequire)('electron').ipcRenderer as IpcRendererLike
  } catch (e) {
    console.warn('[GDP open-with] electron.ipcRenderer unavailable:', e)
    return
  }

  installContextTracker()
  void warmRepoIndex()
  void loadSettings(ipc)

  const originalInvoke = ipc.invoke.bind(ipc)

  ipc.invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel !== CHANNEL || !Array.isArray(args[0])) {
      return originalInvoke(channel, ...args)
    }

    // Snapshot before any await: another right-click must not retarget this menu.
    const repoPath = pendingRepoPath
    const items = args[0] as SerializedMenuItem[]
    const fileMenu = isFileMenu(items)
    const file = fileMenu ? pendingFile ?? fileTargetFromElement(document.activeElement) : null
    pendingRepoPath = null
    pendingFile = null
    // Pick up settings changed since the last menu without blocking on them.
    const config = settings ?? (await (settingsPromise ?? loadSettings(ipc)))
    void loadSettings(ipc)
    const plan = (fileMenu ? file === null : repoPath === null) ? null : planInjection(items, config)
    if (plan === null) {
      if (repoPath === null && isRepositoryMenu(items)) {
        // The one case worth reporting: GD asked for a repository menu but we
        // could not tell which repository it belongs to.
        ipc.invoke('gdp:log', 'open-with: repository menu with no resolved path').catch(() => {})
      }
      return originalInvoke(channel, ...args)
    }

    args[0] = plan.items
    const reply = (await originalInvoke(channel, ...args)) as number[] | null
    if (reply === null || reply.length === 0) return reply

    const resolved = resolveReply(plan, reply)
    if (resolved.kind === 'native') {
      // Re-point at GD's own numbering; native submenus are untouched.
      return resolved.indices
    }
    if (resolved.id !== '') {
      if (fileMenu && file) launch(ipc, { id: resolved.id, ...file, kind: 'file' })
      else if (repoPath !== null) launch(ipc, { id: resolved.id, path: repoPath, kind: 'repository' })
    }
    // GD must not run an action of its own for our entry.
    return null
  }

  log('context-menu interceptor active')
}

// Guarded so the pure helpers above can be imported by tests under Node.
if (typeof window !== 'undefined') {
  installOpenWith()
}
