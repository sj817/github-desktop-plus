/**
 * Translation lookup shared by the main-process menu translator
 * (`index.ts`) and the renderer's DOM translator (`preload/index.ts`).
 *
 * GitHub Desktop words the same string differently in more places than is
 * comfortable — `__DARWIN__ ? 'Date Format' : 'Date format'` is the common
 * shape, and renamed labels across versions are the other. Both would
 * otherwise force the same Chinese text to be written out twice (and kept in
 * sync forever), so this module gives one translation several source strings:
 *
 *   - `_aliases` in a locale category lists extra source strings explicitly,
 *     which covers genuinely different wording (old key vs new key).
 *   - A case-insensitive fallback covers the `__DARWIN__` title-case pairs
 *     with no configuration at all. Exact matches always win, so the handful
 *     of strings that legitimately need different translations per casing
 *     keep working.
 */

/** Keys inside a locale category that carry metadata, not translations. */
export const RESERVED_LOCALE_KEYS: ReadonlySet<string> = new Set([
  '_meta',
  '_overrides',
  '_aliases',
])

/** `{ canonicalSourceString: [otherSourceString, …] }` */
export type AliasMap = Record<string, string[]>

/**
 * Read a category's `_aliases` block into `(source, canonical)` pairs.
 * Applied in a second pass (see `applyAliases`) so an alias can point at a
 * translation defined in a different category.
 */
export function collectAliases(
  entries: Record<string, unknown>,
  into: Array<[source: string, canonical: string]>
): void {
  const raw = entries._aliases
  if (!raw || typeof raw !== 'object') {
    return
  }
  for (const [canonical, sources] of Object.entries(raw as AliasMap)) {
    if (!Array.isArray(sources)) {
      continue
    }
    for (const source of sources) {
      if (typeof source === 'string' && source !== '') {
        into.push([source, canonical])
      }
    }
  }
}

/**
 * Give every aliased source string the canonical key's translation. A source
 * string that already has a translation of its own is left alone — an explicit
 * entry always beats an alias.
 */
export function applyAliases(
  translations: Record<string, string>,
  pairs: ReadonlyArray<[source: string, canonical: string]>
): number {
  let applied = 0
  for (const [source, canonical] of pairs) {
    if (translations[source] !== undefined) {
      continue
    }
    const value = translations[canonical]
    if (value !== undefined) {
      translations[source] = value
      applied++
    }
  }
  return applied
}

// Lowercase index, rebuilt whenever the translation object identity changes.
// Both call sites replace the object wholesale on hot-reload rather than
// mutating it, so identity is a safe cache key.
const caseIndexCache = new WeakMap<object, Map<string, string>>()

function caseIndex(translations: Record<string, string>): Map<string, string> {
  const cached = caseIndexCache.get(translations)
  if (cached !== undefined) {
    return cached
  }
  const index = new Map<string, string>()
  for (const key of Object.keys(translations)) {
    const lower = key.toLowerCase()
    // First key wins so the result is stable regardless of insertion order.
    if (!index.has(lower)) {
      index.set(lower, key)
    }
  }
  caseIndexCache.set(translations, index)
  return index
}

/**
 * Look `key` up, falling back to a case-insensitive match.
 *
 * Returns the matched key as well as its value: callers use the key to resolve
 * anchor-based `_overrides`, which are recorded against the canonical spelling.
 */
export function lookupTranslation(
  translations: Record<string, string>,
  key: string
): { key: string; value: string } | undefined {
  const exact = translations[key]
  if (exact !== undefined) {
    return { key, value: exact }
  }

  const canonical = caseIndex(translations).get(key.toLowerCase())
  if (canonical === undefined) {
    return undefined
  }
  const value = translations[canonical]
  return value === undefined ? undefined : { key: canonical, value }
}
