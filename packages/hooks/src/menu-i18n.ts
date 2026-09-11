/**
 * Application-menu translation for the main-process hook.
 *
 * Electron builds the menu from a template in the main process, and GitHub
 * Desktop rebuilds that template on every repository refresh and on every
 * file selection in the Changes view. `Menu.buildFromTemplate` is patched to
 * run `translateMenuItem` over the template first, synchronously on the
 * browser UI thread — so everything here is memoised and does no I/O.
 */
import { gdpLog } from './logger'
import { lookupTranslation } from './i18n-lookup'

export interface MenuItem {
  id?: string
  label?: string
  submenu?: MenuItem[]
  role?: string
  type?: string
  enabled?: boolean
  accelerator?: string
  click?: () => void
}

function buildTranslationPattern(pattern: string): {
  readonly regex: RegExp
  readonly names: ReadonlyArray<string>
} | null {
  const token = /(\{\{(\w+)\}\}|\{(\w+)\})/g
  const names = new Array<string>()
  let cursor = 0
  let regexSource = ''

  for (const match of pattern.matchAll(token)) {
    const raw = match[0]
    const name = match[2] ?? match[3]
    const index = match.index ?? -1
    if (!raw || !name || index < 0) {
      continue
    }

    regexSource += pattern
      .slice(cursor, index)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    regexSource += '(.+)'
    names.push(name)
    cursor = index + raw.length
  }

  if (names.length === 0) {
    return null
  }

  regexSource += pattern.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
    regex: new RegExp(`^${regexSource}$`),
    names,
  }
}

interface MenuPattern {
  readonly replacement: string
  readonly regex: RegExp
  readonly names: ReadonlyArray<string>
}

// GitHub Desktop rebuilds its whole application menu on every repository
// refresh and on every file selection in the Changes view, and this patch runs
// synchronously on the main thread for each rebuild. Both caches are keyed on
// the translations object: a locale switch swaps the object, which drops them.
const menuPatternCache = new WeakMap<object, ReadonlyArray<MenuPattern>>()
const menuLabelCache = new WeakMap<object, Map<string, string | null>>()

function menuPatterns(translations: Record<string, string>): ReadonlyArray<MenuPattern> {
  const cached = menuPatternCache.get(translations)
  if (cached !== undefined) {
    return cached
  }
  const patterns: MenuPattern[] = []
  for (const [pattern, replacement] of Object.entries(translations).sort((a, b) => b[0].length - a[0].length)) {
    const compiled = buildTranslationPattern(pattern)
    if (compiled !== null) {
      patterns.push({ replacement, ...compiled })
    }
  }
  menuPatternCache.set(translations, patterns)
  return patterns
}

function translateLabelUncached(
  label: string,
  translations: Record<string, string>
): string | null {
  const direct = lookupTranslation(translations, label)
  if (direct !== undefined) {
    return direct.value
  }

  for (const { replacement, regex, names } of menuPatterns(translations)) {
    const match = label.match(regex)
    if (match === null) {
      continue
    }

    let translated = replacement
    names.forEach((name, index) => {
      const value = match[index + 1] ?? ''
      translated = translated.replace(`{{${name}}}`, value)
      translated = translated.replace(`{${name}}`, value)
    })
    return translated
  }

  return null
}

export function translateLabel(
  label: string,
  translations: Record<string, string>
): string | null {
  let cache = menuLabelCache.get(translations)
  if (cache === undefined) {
    cache = new Map()
    menuLabelCache.set(translations, cache)
  }
  const hit = cache.get(label)
  if (hit !== undefined) {
    return hit
  }
  const translated = translateLabelUncached(label, translations)
  cache.set(label, translated)
  return translated
}

// Labels with no translation are reported once per label, so the log stays
// useful to translators without costing a write per menu item per rebuild.
const reportedUntranslatedLabels = new Set<string>()

export function translateMenuItem(item: MenuItem, translations: Record<string, string>): void {
  if (item.label) {
    const translated = translateLabel(item.label, translations)
    if (translated) {
      item.label = translated
    } else if (!reportedUntranslatedLabels.has(item.label)) {
      reportedUntranslatedLabels.add(item.label)
      gdpLog(`Menu: no translation for "${item.label}"`, 'info', 'menu')
    }
  }
  if (item.submenu && Array.isArray(item.submenu)) {
    for (const sub of item.submenu) {
      translateMenuItem(sub, translations)
    }
  }
}

