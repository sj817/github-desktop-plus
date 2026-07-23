type GDPWindowConfig = {
  recentReposLimit?: number
}

type GDPWindow = Window & {
  __GDP_CONFIG__?: GDPWindowConfig
  __gdpApplyRecentReposLimit?: () => void
  __GDP_RECENT_REPOS_LIMIT?: number
}

type PatchedStoragePrototype = Storage & {
  __gdpRecentReposStoragePatched?: boolean
}

type PatchedArrayPrototype = unknown[] & {
  __gdpRecentReposSlicePatched?: boolean
}

const RECENT_REPOSITORIES_KEY = 'recently-selected-repositories'
const RECENT_REPOSITORIES_BACKUP_KEY = 'gdp-recently-selected-repositories-backup'
const DEFAULT_RECENT_REPOS_LIMIT = 3
const MAX_BACKUP_REPOSITORIES = 250
const NUMBER_ARRAY_DELIMITER = ','

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
  const stored = uniqueRepos([...incoming, ...existing, ...backup], getRecentReposLimit())
  return stored
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
            original: this.slice(0, end),
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

export function setupRecentRepositoriesLimit(): void {
  setupRecentRepositoriesSlicePatch()
  setupRecentRepositoriesStorageGuard()
  restoreRecentRepositoriesFromBackup()

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
