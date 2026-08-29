import { frameScheduler, mutationsTouchSelector } from './lib/mutation-filter'

type GDPWindowConfig = {
  recentReposLimit?: number
}

type GDPWindow = Window & {
  __GDP_CONFIG__?: GDPWindowConfig
  __gdpApplyRecentReposLimit?: () => void
  __GDP_RECENT_REPOS_LIMIT?: number
  __gdpRecentRepoIndex?: Record<string, number>
  __gdpPinUiInstalled?: boolean
}

type PatchedStoragePrototype = Storage & {
  __gdpRecentReposStoragePatched?: boolean
}

type PatchedArrayPrototype = unknown[] & {
  __gdpRecentReposSlicePatched?: boolean
  __gdpRecentReposSortPatched?: boolean
}

type PatchedArrayConstructor = ArrayConstructor & {
  __gdpRecentReposOrderPatched?: boolean
}

type RepositoryLike = {
  id?: unknown
  name?: unknown
}

// One row of GHD's repository list, as produced by createRepositoryListItems.
type RepositoryListItem = {
  id?: unknown
  text?: unknown
  repository?: RepositoryLike
}

// Handoff between the two halves of the ordering fix: the grouping patch
// records which repositories form the "Recent" group and in what order, and
// the sort patch consumes it when that group's rows are about to be sorted.
type PendingRecentOrder = {
  ranks: Map<number, number>
  ids: Set<number>
}

// One entry of GHD's repository grouping map: `{ group: { kind }, repos: [] }`.
type RepositoryGroupBucket = {
  group?: { kind?: unknown }
  repos?: unknown[]
}

const RECENT_REPOSITORIES_KEY = 'recently-selected-repositories'
const RECENT_REPOSITORIES_BACKUP_KEY = 'gdp-recently-selected-repositories-backup'
const PINNED_REPOSITORIES_KEY = 'gdp-pinned-repositories'
const DEFAULT_RECENT_REPOS_LIMIT = 3
const MAX_BACKUP_REPOSITORIES = 250
const NUMBER_ARRAY_DELIMITER = ','
const RECENT_GROUP_KIND = 'recent'

function getRecentReposLimit(): number {
  const config = (window as unknown as GDPWindow).__GDP_CONFIG__
  const value = Number(config?.recentReposLimit ?? DEFAULT_RECENT_REPOS_LIMIT)
  if (!Number.isFinite(value)) {
    return DEFAULT_RECENT_REPOS_LIMIT
  }
  return Math.max(1, Math.floor(value))
}

function parseRecentRepos(value: string | null): number[] {
  if (value === null || value === '') {
    return []
  }

  try {
    // GitHub Desktop uses comma-separated format, not JSON
    return value
      .split(NUMBER_ARRAY_DELIMITER)
      .map(parseFloat)
      .filter(n => !isNaN(n))
  } catch {
    return []
  }
}

function uniqueRepos(repositories: ReadonlyArray<number>, limit = repositories.length): number[] {
  const seen = new Set<number>()
  const result: number[] = []

  for (const repository of repositories) {
    if (seen.has(repository)) {
      continue
    }
    seen.add(repository)
    result.push(repository)
    if (result.length >= limit) {
      break
    }
  }

  return result
}

function shouldHandle(storage: Storage, key: string): boolean {
  return storage === window.localStorage && key === RECENT_REPOSITORIES_KEY
}

// ── Pinned repositories ────────────────────────────────────────────────────
// Pin order is the order of ids in the localStorage key; pinned repositories
// always sort ahead of the recency ranking and never fall off the list cap.

function getPinnedRepos(): number[] {
  try {
    return parseRecentRepos(window.localStorage.getItem(PINNED_REPOSITORIES_KEY))
  } catch {
    return []
  }
}

function setPinnedRepos(ids: ReadonlyArray<number>): void {
  try {
    window.localStorage.setItem(PINNED_REPOSITORIES_KEY, ids.join(NUMBER_ARRAY_DELIMITER))
  } catch (error) {
    console.warn('[GDP] Failed to persist pinned repositories:', error)
  }
}

/** Toggle a pin; returns the new pinned state of the repository. */
function togglePinnedRepo(id: number): boolean {
  const pinned = getPinnedRepos()
  const index = pinned.indexOf(id)
  if (index >= 0) {
    pinned.splice(index, 1)
    setPinnedRepos(pinned)
    return false
  }
  pinned.push(id)
  setPinnedRepos(pinned)
  // Rewrite the recent key through the patched setItem so the pinned id moves
  // into the retained (pinned-first) region of the stored list immediately.
  try {
    const raw = window.localStorage.getItem(RECENT_REPOSITORIES_KEY) ?? ''
    window.localStorage.setItem(RECENT_REPOSITORIES_KEY, raw)
  } catch { /* best effort */ }
  return true
}

function isRepositoryIdArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => Number.isInteger(item))
}

function isRecentRepositorySliceCall(value: unknown): value is number[] {
  if (!isRepositoryIdArray(value)) {
    return false
  }

  const stack = new Error().stack ?? ''
  if (!stack.includes('updateRecentRepositories')) {
    return false
  }

  const current = parseRecentRepos(window.localStorage.getItem(RECENT_REPOSITORIES_KEY))
  const backup = parseRecentRepos(window.localStorage.getItem(RECENT_REPOSITORIES_BACKUP_KEY))
  const knownRepositories = new Set([...current, ...backup])

  if (knownRepositories.size === 0) {
    return value.length > 0
  }

  const overlap = value.filter(repository => knownRepositories.has(repository)).length
  return overlap >= Math.min(2, value.length)
}

function mergeForStorage(
  incoming: ReadonlyArray<number>,
  existing: ReadonlyArray<number>,
  backup: ReadonlyArray<number>
): number[] {
  // Pinned repositories are kept at the front of the stored key so GHD's own
  // slice(0, limit) can never push them out of the "Recent" set.
  const known = new Set([...incoming, ...existing, ...backup])
  const pinnedKnown = getPinnedRepos().filter(id => known.has(id))
  const limit = Math.max(getRecentReposLimit(), pinnedKnown.length)
  return uniqueRepos([...pinnedKnown, ...incoming, ...existing, ...backup], limit)
}

function updateBackup(
  originalGetItem: Storage['getItem'],
  originalSetItem: Storage['setItem'],
  incoming: ReadonlyArray<number>,
  existing: ReadonlyArray<number>
): void {
  const backup = parseRecentRepos(originalGetItem.call(window.localStorage, RECENT_REPOSITORIES_BACKUP_KEY))
  const merged = uniqueRepos([...incoming, ...existing, ...backup], MAX_BACKUP_REPOSITORIES)
  originalSetItem.call(window.localStorage, RECENT_REPOSITORIES_BACKUP_KEY, merged.join(NUMBER_ARRAY_DELIMITER))
}

function setupRecentRepositoriesStorageGuard(): void {
  const storagePrototype = Storage.prototype as PatchedStoragePrototype

  if (storagePrototype.__gdpRecentReposStoragePatched) {
    return
  }

  const originalGetItem = storagePrototype.getItem
  const originalSetItem = storagePrototype.setItem

  storagePrototype.setItem = function setItem(key: string, value: string): void {
    if (!shouldHandle(this, key)) {
      return originalSetItem.call(this, key, value)
    }

    const incoming = parseRecentRepos(value)
    const existing = parseRecentRepos(originalGetItem.call(this, key))
    const backup = parseRecentRepos(originalGetItem.call(this, RECENT_REPOSITORIES_BACKUP_KEY))
    const repositories = mergeForStorage(incoming, existing, backup)

    updateBackup(originalGetItem, originalSetItem, incoming, existing)
    return originalSetItem.call(this, key, repositories.join(NUMBER_ARRAY_DELIMITER))
  }

  Object.defineProperty(storagePrototype, '__gdpRecentReposStoragePatched', {
    value: true,
    enumerable: false,
    configurable: false,
  })

  try {
    const current = parseRecentRepos(originalGetItem.call(window.localStorage, RECENT_REPOSITORIES_KEY))
    updateBackup(originalGetItem, originalSetItem, current, [])
  } catch (error) {
    console.warn('[GDP] Failed to back up recent repositories:', error)
  }
}

function setupRecentRepositoriesSlicePatch(): void {
  const arrayPrototype = Array.prototype as PatchedArrayPrototype

  if (arrayPrototype.__gdpRecentReposSlicePatched) {
    return
  }

  const originalSlice = Array.prototype.slice

  Array.prototype.slice = function slice<T>(
    this: T[],
    start?: number,
    end?: number
  ): T[] {
    try {
      if (start === 0 && end === DEFAULT_RECENT_REPOS_LIMIT) {
        const shouldIntercept = isRecentRepositorySliceCall(this)
        if (shouldIntercept) {
          const limit = getRecentReposLimit()
          console.log(`[GDP] Intercepted slice(0, ${end}) → slice(0, ${limit})`, {
            arrayLength: this.length,
            original: originalSlice.call(this, start, end),
            modified: originalSlice.call(this, start, limit)
          })
          return originalSlice.call(this, start, limit)
        }
      }
    } catch (e) {
      console.warn('[GDP] slice patch error:', e)
    }
    return originalSlice.call(this, start, end)
  }

  Object.defineProperty(arrayPrototype, '__gdpRecentReposSlicePatched', {
    value: true,
    enumerable: false,
    configurable: false,
  })
}

function isRepositoryGroupBucket(value: unknown): value is RepositoryGroupBucket {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const bucket = value as RepositoryGroupBucket
  return (
    typeof bucket.group === 'object' &&
    bucket.group !== null &&
    typeof (bucket.group as { kind?: unknown }).kind === 'string' &&
    Array.isArray(bucket.repos)
  )
}

// Rank each repository id by how recently it was used — index 0 is the most
// recent.  The patched setItem keeps the localStorage key in that order, and it
// is written before GHD emits the update that re-renders the list.
function buildRecencyRanks(): Map<number, number> {
  const ranks = new Map<number, number>()

  // Pinned repositories outrank everything, in pin order (strongly negative
  // so no recency index can ever beat them).
  const pinned = getPinnedRepos()
  for (const [index, repository] of pinned.entries()) {
    ranks.set(repository, index - 1_000_000)
  }

  const repositories = parseRecentRepos(window.localStorage.getItem(RECENT_REPOSITORIES_KEY))
  for (const [index, repository] of repositories.entries()) {
    if (!ranks.has(repository)) {
      ranks.set(repository, index)
    }
  }

  return ranks
}

let pendingRecentOrder: PendingRecentOrder | null = null

function repositoryIdOf(repository: RepositoryLike | undefined): number {
  return typeof repository?.id === 'number' ? repository.id : NaN
}

// Unranked repositories keep their relative order at the end of the group.
function rankOf(ranks: Map<number, number>, repository: RepositoryLike | undefined): number {
  return ranks.get(repositoryIdOf(repository)) ?? Number.MAX_SAFE_INTEGER
}

// The DOM rows of the "Recent" group only expose the repository NAME
// (via aria-label) — record a name → id index here, where the full
// repository models pass through, so the pin buttons can resolve ids.
function recordRecentRepoIndex(repositories: RepositoryLike[]): void {
  const index: Record<string, number> = {}
  for (const repository of repositories) {
    const id = repositoryIdOf(repository)
    const name = repository.name
    if (typeof name === 'string' && Number.isInteger(id) && !(name in index)) {
      index[name] = id
    }
  }
  ;(window as unknown as GDPWindow).__gdpRecentRepoIndex = index
}

function sortRecentGroupByRecency(bucket: RepositoryGroupBucket): void {
  const repositories = bucket.repos as RepositoryLike[]
  recordRecentRepoIndex(repositories)
  if (repositories.length < 2) {
    return
  }

  const ranks = buildRecencyRanks()
  if (ranks.size === 0) {
    return
  }

  repositories.sort((left, right) => rankOf(ranks, left) - rankOf(ranks, right))

  // createRepositoryListItems() re-sorts every group alphabetically right
  // after this, so hand the recency order over to the sort patch.
  pendingRecentOrder = {
    ranks,
    ids: new Set(repositories.map(repositoryIdOf)),
  }
}

function isRepositoryListItem(value: unknown): value is RepositoryListItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const item = value as RepositoryListItem
  return (
    typeof item.id === 'string' &&
    Array.isArray(item.text) &&
    typeof item.repository === 'object' &&
    item.repository !== null &&
    typeof item.repository.id === 'number'
  )
}

function isRepositoryListItemArray(value: unknown[]): value is RepositoryListItem[] {
  for (const item of value) {
    if (!isRepositoryListItem(item)) {
      return false
    }
  }
  return true
}

function isRecentGroupRows(rows: RepositoryListItem[], pending: PendingRecentOrder): boolean {
  if (rows.length !== pending.ids.size) {
    return false
  }
  for (const row of rows) {
    if (!pending.ids.has(repositoryIdOf(row.repository))) {
      return false
    }
  }
  return true
}

// createRepositoryListItems() finishes with an unconditional
// `.sort((a, b) => caseInsensitiveCompare(name(a), name(b)))`, applied to every
// group — so the "Recent" group is alphabetical no matter what order it was
// assembled in.  That sort is what actually pins a repository to a fixed slot.
// The recent group is built first (its map key sorts as "0:recent"), so the
// first repository-row sort after the grouping patch ran is the one to
// override; the pending order is consumed there either way to bound its life.
function setupRecentRepositoriesSortPatch(): void {
  const arrayPrototype = Array.prototype as PatchedArrayPrototype

  if (arrayPrototype.__gdpRecentReposSortPatched) {
    return
  }

  const originalSort = Array.prototype.sort

  Array.prototype.sort = function sort<T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
    try {
      const pending = pendingRecentOrder
      if (pending !== null && this.length > 1 && isRepositoryListItemArray(this)) {
        pendingRecentOrder = null
        if (isRecentGroupRows(this, pending)) {
          return originalSort.call(
            this as unknown as RepositoryListItem[],
            (left, right) =>
              rankOf(pending.ranks, left.repository) - rankOf(pending.ranks, right.repository)
          ) as unknown as T[]
        }
      }
    } catch (error) {
      pendingRecentOrder = null
      console.warn('[GDP] Failed to sort recent repositories rows:', error)
    }
    return originalSort.call(this, compareFn)
  } as typeof Array.prototype.sort

  Object.defineProperty(arrayPrototype, '__gdpRecentReposSortPatched', {
    value: true,
    enumerable: false,
    configurable: false,
  })
}

function reorderRecentRepositoryGroup(groups: Map<unknown, unknown>): void {
  // Cheap shape probe first — this runs for every Array.from(map) in the app.
  if (!isRepositoryGroupBucket(groups.values().next().value)) {
    return
  }

  for (const bucket of groups.values()) {
    if (isRepositoryGroupBucket(bucket) && bucket.group?.kind === RECENT_GROUP_KIND) {
      sortRecentGroupByRecency(bucket)
      return
    }
  }
}

// GHD builds the "Recent" group by walking the (alphabetically sorted)
// repository list and testing membership in a Set of recent ids, so the group
// is assembled in repository order and ignores recency entirely.  With the
// stock limit of 3 that is hard to notice; with a larger limit the list looks
// frozen — a repository stays at the same slot no matter how often you switch
// to it.  The grouping map is materialised with Array.from(map) right before
// the row items are built, so that is where the recent bucket gets re-sorted;
// setupRecentRepositoriesSortPatch() then handles the alphabetical re-sort
// that createRepositoryListItems() applies to the rows afterwards.
function setupRecentRepositoriesOrderPatch(): void {
  const arrayConstructor = Array as PatchedArrayConstructor

  if (arrayConstructor.__gdpRecentReposOrderPatched) {
    return
  }

  const originalFrom = Array.from as (...args: unknown[]) => unknown[]

  // Forward through `arguments` so the common (non-Map) call costs nothing
  // extra — Array.from is a hot global inside the app.
  const from = function from(this: unknown): unknown[] {
    const source: unknown = arguments[0]
    try {
      if (source instanceof Map && source.size > 0) {
        reorderRecentRepositoryGroup(source)
      }
    } catch (error) {
      console.warn('[GDP] Failed to reorder recent repositories group:', error)
    }
    return originalFrom.apply(this, arguments as unknown as unknown[])
  }

  Array.from = from as unknown as ArrayConstructor['from']

  Object.defineProperty(arrayConstructor, '__gdpRecentReposOrderPatched', {
    value: true,
    enumerable: false,
    configurable: false,
  })
}

// Official GHD truncates the localStorage key to 3 entries on every repo
// switch (and on boot).  When the app runs WITHOUT hooks in between, entries
// beyond 3 are lost from the real key — but our backup key survives.  Merge
// the backup back into the real key so the restored list (capped at the
// configured limit) is what the app reads at boot.  Relies on the patched
// setItem, which re-merges with the backup and refreshes it.
function restoreRecentRepositoriesFromBackup(): void {
  try {
    const current = parseRecentRepos(window.localStorage.getItem(RECENT_REPOSITORIES_KEY))
    const backup = parseRecentRepos(window.localStorage.getItem(RECENT_REPOSITORIES_BACKUP_KEY))
    if (backup.length === 0) {
      return
    }
    const restored = uniqueRepos([...current, ...backup], getRecentReposLimit())
    if (restored.length > current.length) {
      window.localStorage.setItem(RECENT_REPOSITORIES_KEY, restored.join(NUMBER_ARRAY_DELIMITER))
      console.log(`[GDP] Restored recent repositories from backup: ${current.length} → ${restored.length}`)
    }
  } catch (error) {
    console.warn('[GDP] Failed to restore recent repositories from backup:', error)
  }
}

// ── Pin UI ─────────────────────────────────────────────────────────────────
// Injects a pin toggle into each row of the "Recent" group in the repository
// dropdown. Rows are React-Virtualized and recycled constantly, so a
// MutationObserver re-decorates them idempotently. Reordering itself applies
// on the next list rebuild (i.e. the next time the dropdown opens).

const PIN_SVG =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">' +
  '<path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.08 3.08 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.75.75 0 1 1-1.061 1.06L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.08 3.08 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 1-.504-2.826z"/>' +
  '</svg>'

const PIN_STYLE_ID = 'gdp-recent-pin-styles'

function injectPinStyles(): void {
  if (document.getElementById(PIN_STYLE_ID)) {
    return
  }
  const style = document.createElement('style')
  style.id = PIN_STYLE_ID
  style.textContent = `
    #foldout-container .repository-list .list-item .repository-list-item { position: relative; }
    .gdp-pin-btn {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 22px; height: 22px; padding: 0;
      display: none; align-items: center; justify-content: center;
      border: none; border-radius: 5px; background: transparent;
      color: var(--text-secondary-color, #768390); cursor: pointer;
      opacity: 0.75;
    }
    #foldout-container .list-item:hover .gdp-pin-btn { display: inline-flex; }
    .gdp-pin-btn:hover { background: rgba(128, 128, 128, 0.22); opacity: 1; }
    .gdp-pin-btn.gdp-pinned {
      display: inline-flex;
      color: var(--link-button-color, var(--button-background, #0969da));
      opacity: 1;
    }
  `
  document.head.appendChild(style)
}

function decorateRecentRows(): void {
  const rows = document.querySelectorAll<HTMLElement>('#foldout-container .repository-list .list-item')
  if (rows.length === 0) {
    return
  }
  const repoIndex = (window as unknown as GDPWindow).__gdpRecentRepoIndex ?? {}
  const pinned = new Set(getPinnedRepos())

  for (const row of rows) {
    const aria = row.getAttribute('aria-label') ?? ''
    const match = aria.match(/^(.*), (Recent|最近)$/)
    if (!match) {
      continue
    }
    const item = row.querySelector<HTMLElement>('.repository-list-item')
    if (!item || item.querySelector('.gdp-pin-btn')) {
      continue
    }
    const repositoryName = match[1]
    if (!repositoryName) {
      continue
    }
    const id = repoIndex[repositoryName]
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      continue
    }

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'gdp-pin-btn' + (pinned.has(id) ? ' gdp-pinned' : '')
    btn.title = pinned.has(id) ? '取消置顶' : '置顶'
    btn.innerHTML = PIN_SVG
    // Keep the row's own selection handlers out of the pin interaction.
    for (const type of ['mousedown', 'mouseup', 'dblclick'] as const) {
      btn.addEventListener(type, ev => ev.stopPropagation())
    }
    btn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const nowPinned = togglePinnedRepo(id)
      btn.classList.toggle('gdp-pinned', nowPinned)
      btn.title = nowPinned ? '取消置顶' : '置顶'
      console.log(`[GDP] Repository ${match[1]} (${id}) ${nowPinned ? 'pinned' : 'unpinned'}`)
    })
    item.appendChild(btn)
  }
}

function setupRecentPinUi(): void {
  const gdpWindow = window as unknown as GDPWindow
  if (gdpWindow.__gdpPinUiInstalled) {
    return
  }
  gdpWindow.__gdpPinUiInstalled = true

  const install = () => {
    injectPinStyles()
    const decorate = frameScheduler(() => {
      try {
        decorateRecentRows()
      } catch (error) {
        console.warn('[GDP] Pin UI decoration failed:', error)
      }
    })
    decorate()
    const observer = new MutationObserver(mutations => {
      if (mutationsTouchSelector(mutations, '#foldout-container .repository-list')) decorate()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.body) {
    install()
  } else {
    window.addEventListener('DOMContentLoaded', install, { once: true })
  }
}

export function setupRecentRepositoriesLimit(): void {
  setupRecentRepositoriesSlicePatch()
  setupRecentRepositoriesOrderPatch()
  setupRecentRepositoriesSortPatch()
  setupRecentRepositoriesStorageGuard()
  restoreRecentRepositoriesFromBackup()
  setupRecentPinUi()

  // Store the limit in window for other parts to access
  try {
    const limit = getRecentReposLimit()
    console.log(`[GDP] Recent repositories limit active: ${limit}`)
    ;(window as unknown as GDPWindow).__GDP_RECENT_REPOS_LIMIT = limit
  } catch (e) {
    console.warn('[GDP] Failed to set recent repos limit:', e)
  }
}

(window as unknown as GDPWindow).__gdpApplyRecentReposLimit = setupRecentRepositoriesLimit
setupRecentRepositoriesLimit()
