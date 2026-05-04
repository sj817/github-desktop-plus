type GDPWindowConfig = {
  recentReposLimit?: number
}

type GDPWindow = Window & {
  __GDP_CONFIG__?: GDPWindowConfig
  __gdpApplyRecentReposLimit?: () => void
}

const RECENT_REPOSITORIES_KEY = 'recently-selected-repositories'

function getRecentReposLimit(): number {
  const config = (window as unknown as GDPWindow).__GDP_CONFIG__
  const value = Number(config?.recentReposLimit ?? 3)
  if (!Number.isFinite(value)) {
    return 3
  }
  return Math.max(1, Math.floor(value))
}

function parseRecentRepos(value: string | null): number[] {
  if (value === null) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is number => Number.isInteger(item))
  } catch {
    return []
  }
}

function uniqueRepos(repositories: ReadonlyArray<number>, limit: number): number[] {
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

function normalizeRecentRepositories(): void {
  const limit = getRecentReposLimit()
  const current = parseRecentRepos(window.localStorage.getItem(RECENT_REPOSITORIES_KEY))
  window.localStorage.setItem(RECENT_REPOSITORIES_KEY, JSON.stringify(uniqueRepos(current, limit)))
}

export function setupRecentRepositoriesLimit(): void {
  const storagePrototype = Storage.prototype as Storage & {
    __gdpRecentReposPatched?: boolean
  }

  if (storagePrototype.__gdpRecentReposPatched) {
    normalizeRecentRepositories()
    return
  }

  const originalGetItem = storagePrototype.getItem
  const originalSetItem = storagePrototype.setItem

  storagePrototype.getItem = function getItem(key: string): string | null {
    const raw = originalGetItem.call(this, key)
    if (!shouldHandle(this, key)) {
      return raw
    }

    const limit = getRecentReposLimit()
    const repositories = uniqueRepos(parseRecentRepos(raw), limit)
    return JSON.stringify(repositories)
  }

  storagePrototype.setItem = function setItem(key: string, value: string): void {
    if (!shouldHandle(this, key)) {
      return originalSetItem.call(this, key, value)
    }

    const limit = getRecentReposLimit()
    const incoming = parseRecentRepos(value)
    const existing = parseRecentRepos(originalGetItem.call(this, key))
    const repositories = uniqueRepos([...incoming, ...existing], limit)
    return originalSetItem.call(this, key, JSON.stringify(repositories))
  }

  Object.defineProperty(storagePrototype, '__gdpRecentReposPatched', {
    value: true,
    enumerable: false,
    configurable: false,
  })

  try {
    normalizeRecentRepositories()
    console.log(`[GDP] Recent repositories limit active: ${getRecentReposLimit()}`)
  } catch (error) {
    console.warn('[GDP] Failed to normalize recent repositories:', error)
  }
}

(window as unknown as GDPWindow).__gdpApplyRecentReposLimit = setupRecentRepositoriesLimit
setupRecentRepositoriesLimit()
