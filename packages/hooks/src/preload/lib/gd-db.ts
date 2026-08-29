/**
 * Shared helpers to read GitHub Desktop's own state from inside the renderer.
 *
 * GD stores its repositories in an IndexedDB database named "Database"
 * (Dexie — see GD `app/src/ui/index.tsx`: `new RepositoriesDatabase('Database')`,
 * and `BaseDatabase` calls `super(name)` with no prefix), and the currently
 * selected repository id in localStorage under "last-selected-repository-id"
 * (GD `app-store.ts` `LastSelectedRepositoryIDKey`, written via `setNumber`).
 *
 * We open our OWN read-only connection so closing it never affects GD's.
 */

const GD_DB_NAME = 'Database'
const LAST_SELECTED_REPO_KEY = 'last-selected-repository-id'

export interface GdRepository {
  id: number
  path: string
  /** alias → GitHub repo name → basename(path) */
  name: string
  owner: string | null
  gitHubRepositoryID: number | null
  missing: boolean
}

interface RawRepo {
  id?: number
  path?: string
  gitHubRepositoryID?: number | null
  alias?: string | null
  missing?: boolean
}
interface RawGhRepo {
  id?: number
  ownerID?: number
  name?: string
}
interface RawOwner {
  id?: number
  login?: string
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      // Open WITHOUT a version so we attach to GD's existing DB as-is.
      const req = indexedDB.open(GD_DB_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
      req.onupgradeneeded = () => {
        // Fires only if the DB did not exist — abort so we never create or
        // mutate GD's database.
        try {
          req.transaction?.abort()
        } catch {
          /* noop */
        }
        resolve(null)
      }
    } catch {
      resolve(null)
    }
  })
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise(resolve => {
    if (!db.objectStoreNames.contains(store)) {
      resolve([])
      return
    }
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll()
      req.onsuccess = () => resolve((req.result as T[]) ?? [])
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Read GD's full repository list (joined with GitHub repo + owner metadata). */
export async function readGdRepositories(): Promise<GdRepository[]> {
  const db = await openDb()
  if (!db) return []
  try {
    const [repos, ghRepos, owners] = await Promise.all([
      getAll<RawRepo>(db, 'repositories'),
      getAll<RawGhRepo>(db, 'gitHubRepositories'),
      getAll<RawOwner>(db, 'owners'),
    ])
    const ghById = new Map(ghRepos.map(r => [r.id, r]))
    const ownerById = new Map(owners.map(o => [o.id, o]))
    return repos
      .filter(r => typeof r.id === 'number' && typeof r.path === 'string')
      .map(r => {
        const gh =
          r.gitHubRepositoryID != null ? ghById.get(r.gitHubRepositoryID) : undefined
        const owner = gh?.ownerID != null ? ownerById.get(gh.ownerID) : undefined
        return {
          id: r.id as number,
          path: r.path as string,
          name: r.alias || gh?.name || basename(r.path as string),
          owner: owner?.login ?? null,
          gitHubRepositoryID: r.gitHubRepositoryID ?? null,
          missing: r.missing ?? false,
        }
      })
  } finally {
    db.close()
  }
}

/** The id of the repository GD currently has selected, or null. */
function getSelectedRepositoryId(): number | null {
  const raw = localStorage.getItem(LAST_SELECTED_REPO_KEY)
  if (!raw) return null
  const id = parseInt(raw, 10)
  return Number.isFinite(id) && id > 0 ? id : null
}

/** The filesystem path of the currently selected repository, or '' if unknown. */
export async function getSelectedRepositoryPath(): Promise<string> {
  const id = getSelectedRepositoryId()
  if (id == null) return ''
  const db = await openDb()
  if (!db) return ''
  try {
    return await new Promise<string>(resolve => {
      try {
        const req = db
          .transaction('repositories', 'readonly')
          .objectStore('repositories')
          .get(id)
        req.onsuccess = () => resolve((req.result as RawRepo | undefined)?.path ?? '')
        req.onerror = () => resolve('')
      } catch {
        resolve('')
      }
    })
  } finally {
    db.close()
  }
}
