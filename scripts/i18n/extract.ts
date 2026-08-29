#!/usr/bin/env node
/**
 * Source-map-driven i18n string extractor.
 *
 * GitHub Desktop ships a full source map (resources/app/renderer.js.map) whose
 * `sourcesContent` embeds the original, un-minified TSX. We parse those sources
 * with the TypeScript compiler API and collect every user-visible English string
 * (JSX text + string-literal UI attributes), each with its file, line, section
 * and injection target. It replaced an earlier regex scan over a separately
 * checked-out source repo with a precise, version-diffable catalog derived from
 * the app's own build.
 *
 * Usage:
 *   pnpm run locales:extract -- [--map <path>] [--app-dir <dir>]
 *   pnpm run locales:diff -- <oldCatalog.json> <newCatalog.json>
 *
 * Defaults: locale=zh-CN, map auto-discovered from the installed app.
 *
 * Outputs (extract mode):
 *   apps/gdp/resources/string-catalog/<appVersion>.json
 *   apps/gdp/resources/string-catalog/ambiguous-<appVersion>.json
 *   apps/gdp/resources/locales/<locale>/<area>.json
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const resourcesDir = path.join(rootDir, 'apps', 'gdp', 'resources')
const localesDir = path.join(resourcesDir, 'locales')
const stringsOutDir = path.join(resourcesDir, 'string-catalog')

type InjectionTarget = 'renderer' | 'main' | 'renderer-ipc'
type VersionTuple = [number, number, number]

interface ExtractArgs {
  map?: string
  appDir?: string
}

interface Classification {
  section: string
  target: InjectionTarget
}

interface ExtractedHit {
  text: string
  kind: string
  line: number
}

interface StringLocation extends Classification {
  file: string
  kind: string
  line: number
}

interface CatalogEntry {
  text: string
  locations: StringLocation[]
  sections: Set<string>
  areas: Set<string>
}

interface CatalogString {
  text: string
  area: string
  ambiguous: boolean
  locations: StringLocation[]
}

interface CatalogJson {
  appVersion: string
  mapPath: string
  generatedFrom: 'source-map'
  stringCount: number
  strings: CatalogString[]
}

interface SourceMapData {
  sources: string[]
  sourcesContent: Array<string | null>
}

interface ParsedArgs {
  positional: string[]
  args: ExtractArgs
}

interface DiffCatalog {
  appVersion: string
  strings: Array<{ text: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readSourceMap(filePath: string): SourceMapData {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.sources)) {
    throw new Error(`${filePath} is not a source map with a sources array`)
  }
  const rawContents = Array.isArray(parsed.sourcesContent) ? parsed.sourcesContent : []
  return {
    sources: parsed.sources.map(String),
    sourcesContent: rawContents.map(value => (typeof value === 'string' ? value : null)),
  }
}

function readDiffCatalog(filePath: string): DiffCatalog {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  if (!isRecord(parsed) || typeof parsed.appVersion !== 'string' || !Array.isArray(parsed.strings)) {
    throw new Error(`${filePath} is not a GDP string catalog`)
  }

  const strings = parsed.strings.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.text !== 'string') {
      throw new Error(`${filePath}: strings[${index}] has no text field`)
    }
    return { text: entry.text }
  })
  return { appVersion: parsed.appVersion, strings }
}

// ── UI attribute / prop names that carry visible strings ─────────────────────
const STRING_ATTRS = new Set([
  'ariaLabel',
  'aria-label',
  'title',
  'placeholder',
  'tooltip',
  'label',
  'summary',
  'description',
  'buttonContent',
  'okButtonText',
  'cancelButtonText',
  'confirmButtonText',
])

// ── Noise filters ────────────────────────────────────────────────────────────
const SKIP_PATTERNS = [
  /^https?:\/\//,
  /^[a-z][a-z0-9_-]+(\/[a-z0-9_-]+)+$/,
  /^[a-z][a-z0-9-_]*$/,
  /^[A-Z0-9_-]+$/,
  /^&\w+;$/,
  /^[\d\s%px.]+$/,
  // Code-ish punctuation. Parentheses are deliberately NOT here: plenty of
  // real labels use them ("Auto (default)", "Request timeout (seconds)").
  /[={}[\]]/,
  /=>/,
  /^--[a-z-]/,
  /^\d+\.\d+/,
  /^[a-z]+([A-Z][a-z]+)+$/, // camelCase
]

const SKIP_EXACT = new Set([
  'GitHub', 'Git', 'GitHub Desktop', 'Desktop', 'SSH', 'HTTP', 'HTTPS',
  'HEAD', 'SHA', 'PR', 'CI', 'CD', 'OAuth', 'SAML', 'LFS', 'GPG',
  'macOS', 'Linux', 'Windows', 'ARM', 'x64', 'Mac',
  'TypeScript', 'JavaScript', 'React', 'Electron', 'Node',
  'VS Code', 'Visual Studio Code',
  'OK', 'Yes', 'No', 'true', 'false', 'null', 'undefined',
])

const HAS_ALPHA = /[A-Za-z]/
const HAS_CJK = /[一-鿿　-〿]/

function isValidCandidate(text: string): boolean {
  if (!text || text.length < 2) return false
  if (HAS_CJK.test(text)) return false
  if (!HAS_ALPHA.test(text)) return false
  if (SKIP_EXACT.has(text)) return false
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(text)) return false
  }
  const words = text.split(/\s+/)
  if (words.length === 1) {
    const word = words[0] ?? ''
    if (word === word.toLowerCase() && word !== word.toUpperCase()) return false
    if (/^[a-z][a-z0-9_-]+$/.test(word)) return false
  }
  return true
}

// ── Map discovery (local-first) ──────────────────────────────────────────────
// Modelled on the Rust proc.rs::find_main_js / gdp_core detector path logic.
function parseVersion(name: string): VersionTuple {
  const m = /app-(\d+)\.(\d+)\.(\d+)/.exec(name)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

function compareVersion(a: VersionTuple, b: VersionTuple): number {
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

function discoverInstalledMap(): string | null {
  const candidates: string[] = []
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    candidates.push(path.join(localAppData, 'GitHubDesktop'))
  }
  candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'GitHubDesktop'))

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    const appDirs = fs
      .readdirSync(base)
      .filter((n) => n.startsWith('app-'))
      .sort((a, b) => compareVersion(parseVersion(a), parseVersion(b)))
    // Highest version last → walk from newest down.
    for (const dir of appDirs.reverse()) {
      const mapPath = path.join(base, dir, 'resources', 'app', 'renderer.js.map')
      if (fs.existsSync(mapPath)) return mapPath
    }
  }
  return null
}

function resolveMapPath(args: ExtractArgs): string {
  if (args.map) return args.map
  if (args.appDir) {
    const p = path.join(args.appDir, 'resources', 'app', 'renderer.js.map')
    if (fs.existsSync(p)) return p
    const direct = path.join(args.appDir, 'renderer.js.map')
    if (fs.existsSync(direct)) return direct
    throw new Error(`No renderer.js.map under --app-dir ${args.appDir}`)
  }
  const discovered = discoverInstalledMap()
  if (!discovered) {
    throw new Error(
      'Could not auto-discover renderer.js.map. Pass --map <path> or --app-dir <dir>.\n' +
        'Fallback: build desktop/desktop from source (yarn build:prod) and point --map at app/out/renderer.js.map.'
    )
  }
  return discovered
}

function inferAppVersion(mapPath: string): string {
  const m = /app-(\d+\.\d+\.\d+)/.exec(mapPath)
  return m?.[1] ?? 'unknown'
}

// ── Section / target classification ──────────────────────────────────────────
// section = first path segment under app/src/ui, so it lines up with the
// existing ui-<section>.json files.
function classify(relFile: string): Classification {
  // relFile like "app/src/ui/changes/commit-message.tsx" or "app/src/lib/..."
  const norm = relFile.replace(/\\/g, '/')
  const uiIdx = norm.indexOf('app/src/ui/')
  let section = 'root'
  if (uiIdx >= 0) {
    const rest = norm.slice(uiIdx + 'app/src/ui/'.length)
    const parts = rest.split('/')
    section = parts.length > 1 ? (parts[0] ?? 'root') : 'root'
  }

  let target: InjectionTarget = 'renderer'
  if (/app\/src\/ui\/main-process\//.test(norm) || /menu/.test(norm)) {
    target = 'main'
  }
  if (/context-menu/.test(norm)) {
    target = 'renderer-ipc'
  }
  return { section, target }
}

// The project consolidated several GD source areas into differently-named
// hand-curated locale files. Alias those source sections onto the existing file
// so new strings land alongside their siblings instead of fragmenting into a
// parallel ui-<section>.json. Unlisted sections get their own ui-<section>.json.
const SECTION_ALIASES: Record<string, string> = {
  preferences: 'ui-settings',
  tutorial: 'ui-welcome-tutorial',
  welcome: 'ui-welcome-tutorial',
  'open-pull-request': 'ui-pull-request',
  'clone-repository': 'ui-clone-add',
  'add-repository': 'ui-clone-add',
}

// Which source-locale file a string is routed into.
function areaFileFor(section: string, target: InjectionTarget): string {
  if (target === 'main') return 'menu'
  if (target === 'renderer-ipc') return 'ui-context-menus'
  if (section === 'root') return 'ui'
  return SECTION_ALIASES[section] ?? `ui-${section}`
}

// ── AST extraction ───────────────────────────────────────────────────────────
function getAttrName(node: ts.JsxAttribute): string | null {
  const name = node.name
  if (ts.isIdentifier(name)) return name.text
  // Namespaced (aria-label etc.) — TS represents as JsxNamespacedName
  return `${name.namespace.text}-${name.name.text}`
}

// One attribute can carry several user-visible strings: GitHub Desktop writes
// `label={__DARWIN__ ? 'Date Format' : 'Date format'}` all over the place, and
// both branches ship. Collect every literal branch rather than only the plain
// string form.
function literalTextsFromExpr(expr: ts.Expression | undefined): string[] {
  if (!expr) return []
  if (ts.isStringLiteral(expr)) return [expr.text]
  if (ts.isParenthesizedExpression(expr)) return literalTextsFromExpr(expr.expression)
  if (ts.isConditionalExpression(expr)) {
    return [...literalTextsFromExpr(expr.whenTrue), ...literalTextsFromExpr(expr.whenFalse)]
  }
  // `cond && 'Foo'` / `value ?? 'Foo'`
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...literalTextsFromExpr(expr.left), ...literalTextsFromExpr(expr.right)]
    }
  }
  return []
}

function literalTexts(init: ts.JsxAttributeValue | undefined): string[] {
  if (!init) return []
  if (ts.isStringLiteral(init)) return [init.text]
  // attr={'...'} and attr={cond ? '...' : '...'} forms
  if (ts.isJsxExpression(init)) return literalTextsFromExpr(init.expression)
  return []
}

function extractFromSource(relFile: string, content: string): ExtractedHit[] {
  const isTsx = relFile.endsWith('.tsx')
  const sf = ts.createSourceFile(
    relFile,
    content,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const hits: ExtractedHit[] = []
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1

  const visit = (node: ts.Node): void => {
    // JSX text nodes
    if (ts.isJsxText(node)) {
      const raw = node.text.trim()
      if (raw && /^[A-Z]/.test(raw) && !raw.includes('\n')) {
        hits.push({ text: raw, kind: 'text', line: lineOf(node.getStart(sf)) })
      }
    }
    // `__DARWIN__ ? 'Foo Bar' : 'Foo bar'` — GitHub Desktop's platform-label
    // idiom. It shows up as a JSX attribute, an object `label:` property and a
    // bare call argument, so match the ternary itself rather than its context.
    if (ts.isConditionalExpression(node) && /__DARWIN__/.test(node.condition.getText(sf))) {
      for (const value of literalTextsFromExpr(node)) {
        const text = value.trim()
        if (text) {
          hits.push({ text, kind: 'darwin', line: lineOf(node.getStart(sf)) })
        }
      }
    }
    // Exported label constants — `export const DefaultShellLabel =
    // __DARWIN__ ? 'Open in Shell' : 'Open in shell'` and friends never appear
    // in JSX directly but end up as menu-item and button labels.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /Label$|Title$|Text$/.test(node.name.text) &&
      node.initializer
    ) {
      for (const value of literalTextsFromExpr(node.initializer)) {
        const text = value.trim()
        if (text) {
          hits.push({ text, kind: 'const', line: lineOf(node.getStart(sf)) })
        }
      }
    }
    // JSX attributes with string-literal values
    if (ts.isJsxAttribute(node)) {
      const attr = getAttrName(node)
      if (attr && STRING_ATTRS.has(attr)) {
        for (const value of literalTexts(node.initializer)) {
          const text = value.trim()
          if (text) {
            hits.push({ text, kind: `attr:${attr}`, line: lineOf(node.getStart(sf)) })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

// ── Extract command ──────────────────────────────────────────────────────────
function extract(locale: string, args: ExtractArgs): CatalogJson {
  const mapPath = resolveMapPath(args)
  const appVersion = inferAppVersion(mapPath)
  console.log(`[extract] map:     ${mapPath}`)
  console.log(`[extract] version: ${appVersion}`)

  const map = readSourceMap(mapPath)
  const sources = [...map.sources]
  const contents = [...map.sourcesContent]

  // The application menu is built in the main process (`build-default-menu.ts`),
  // so its labels are absent from the renderer bundle entirely.
  const mainMapPath = path.join(path.dirname(mapPath), 'main.js.map')
  if (fs.existsSync(mainMapPath)) {
    const mainMap = readSourceMap(mainMapPath)
    sources.push(...mainMap.sources)
    contents.push(...mainMap.sourcesContent)
    console.log(`[extract] main:    ${mainMapPath}`)
  }

  // catalog: text -> { locations: [{file,line,kind,section,target}], sections:Set, areas:Set }
  const catalog = new Map<string, CatalogEntry>()
  let scannedFiles = 0

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    if (src === undefined) continue
    const rel = src.replace(/^webpack:\/\/\/\.\//, '').replace(/^webpack:\/\/\//, '')
    if (!/\/?app\/src\//.test(rel)) continue
    if (/node_modules/.test(rel)) continue
    if (!/\.tsx?$/.test(rel)) continue
    if (/\.d\.ts$/.test(rel)) continue
    if (/\.(test|spec)\.tsx?$/.test(rel)) continue
    const content = contents[i]
    if (!content) continue

    const { section, target } = classify(rel)
    scannedFiles++
    let hits: ExtractedHit[]
    try {
      hits = extractFromSource(rel, content)
    } catch (error) {
      console.warn(`[extract] parse failed for ${rel}: ${errorMessage(error)}`)
      continue
    }

    for (const hit of hits) {
      if (!isValidCandidate(hit.text)) continue
      let entry = catalog.get(hit.text)
      if (!entry) {
        entry = {
          text: hit.text,
          locations: [],
          sections: new Set<string>(),
          areas: new Set<string>(),
        }
        catalog.set(hit.text, entry)
      }
      const area = areaFileFor(section, target)
      entry.locations.push({ file: rel, line: hit.line, kind: hit.kind, section, target })
      entry.sections.add(section)
      entry.areas.add(area)
    }
  }

  const entries = [...catalog.values()].sort((a, b) => a.text.localeCompare(b.text))
  console.log(`[extract] scanned ${scannedFiles} source files → ${entries.length} unique strings`)

  // 1. Machine catalog
  fs.mkdirSync(stringsOutDir, { recursive: true })
  const catalogPath = path.join(stringsOutDir, `${appVersion}.json`)
  const catalogJson: CatalogJson = {
    appVersion,
    mapPath,
    generatedFrom: 'source-map',
    stringCount: entries.length,
    strings: entries.map((e) => {
      const location = e.locations[0]
      if (location === undefined) {
        throw new Error(`catalog entry has no source location: ${JSON.stringify(e.text)}`)
      }
      return {
        text: e.text,
        area: areaFileFor(
        // route by the first location's section/target (all locations of a
        // string share the same area only when unambiguous; ambiguous ones are
        // flagged separately below)
          location.section,
          location.target
        ),
        ambiguous: e.sections.size > 1 || e.areas.size > 1,
        locations: e.locations,
      }
    }),
  }
  fs.writeFileSync(catalogPath, JSON.stringify(catalogJson, null, 2) + '\n')
  console.log(`[extract] catalog → ${path.relative(rootDir, catalogPath)}`)

  // 2. Ambiguity report
  const ambiguous = catalogJson.strings.filter((s) => s.ambiguous)
  const ambiguousPath = path.join(stringsOutDir, `ambiguous-${appVersion}.json`)
  fs.writeFileSync(
    ambiguousPath,
    JSON.stringify(
      {
        appVersion,
        count: ambiguous.length,
        note: 'Same English at multiple sections. Add _overrides with an anchor selector only where the translation genuinely differs.',
        strings: ambiguous,
      },
      null,
      2
    ) + '\n'
  )
  console.log(`[extract] ambiguous (${ambiguous.length}) → ${path.relative(rootDir, ambiguousPath)}`)

  // 3. Merge new keys into per-area source locale files (add-only)
  mergeIntoLocaleFiles(locale, entries)

  return catalogJson
}

// Collect every English key already present across ALL locale files in the dir,
// so a string already translated (possibly in a differently-named, hand-curated
// file) is never re-added as an empty duplicate — which would fragment the
// dictionary and, at runtime flatten, risk shadowing the real translation.
// A string counts as "already covered" when a locale file translates it, when
// an `_aliases` entry routes it to another key, or when it differs from an
// existing key only by case (the runtime falls back to a case-insensitive
// lookup — see packages/hooks/src/i18n-lookup.ts). Without the last two, every
// `__DARWIN__ ? 'Foo Bar' : 'Foo bar'` pair would keep coming back as a new
// untranslated key.
function collectExistingKeys(localeDir: string): { keys: Set<string>; lowerKeys: Set<string> } {
  const keys = new Set<string>()
  const lowerKeys = new Set<string>()
  const add = (key: string): void => {
    keys.add(key)
    lowerKeys.add(key.toLowerCase())
  }

  if (!fs.existsSync(localeDir)) return { keys, lowerKeys }
  for (const name of fs.readdirSync(localeDir)) {
    if (!name.endsWith('.json')) continue
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(localeDir, name), 'utf-8')) as unknown
      if (!isRecord(obj)) continue
      for (const [k, v] of Object.entries(obj)) {
        if (k === '_meta' || k === '_overrides') continue
        if (k === '_aliases') {
          if (!isRecord(v)) continue
          for (const sources of Object.values(v)) {
            if (Array.isArray(sources)) {
              for (const source of sources) {
                if (typeof source === 'string') add(source)
              }
            }
          }
          continue
        }
        add(k)
      }
    } catch {
      // ignore unparseable file
    }
  }
  return { keys, lowerKeys }
}

function mergeIntoLocaleFiles(locale: string, entries: CatalogEntry[]): void {
  const localeDir = path.join(localesDir, locale)
  fs.mkdirSync(localeDir, { recursive: true })

  const { keys: existingKeys, lowerKeys: existingLowerKeys } = collectExistingKeys(localeDir)

  // Group NEW strings (absent from every existing file) by routed area file.
  const byArea = new Map<string, { texts: string[]; section: string }>()
  for (const e of entries) {
    // Covered by an exact key, an alias, or the runtime's case-insensitive fallback.
    if (existingKeys.has(e.text) || existingLowerKeys.has(e.text.toLowerCase())) continue
    // …and not twice within this run either.
    existingLowerKeys.add(e.text.toLowerCase())
    const loc = e.locations[0]
    if (loc === undefined) continue
    const area = areaFileFor(loc.section, loc.target)
    let group = byArea.get(area)
    if (!group) {
      group = { texts: [], section: loc.section }
      byArea.set(area, group)
    }
    group.texts.push(e.text)
  }

  let addedTotal = 0
  const perFile: string[] = []
  for (const [area, { texts, section }] of byArea) {
    const filePath = path.join(localeDir, `${area}.json`)
    const isNewFile = !fs.existsSync(filePath)

    if (isNewFile) {
      // Brand-new file: seed _meta header (repo convention) + sorted keys.
      // Auto-created files are always renderer DOM areas (main→menu.json,
      // renderer-ipc→ui-context-menus.json already exist, never created here).
      const obj: Record<string, unknown> = {
        _meta: {
          description: `${section} 区域 UI 字符串（自动抽取）`,
          target: 'renderer',
          section,
        },
      }
      for (const text of texts) obj[text] = ''
      writeLocaleFile(filePath, reorderLocaleObject(obj), '\r\n')
      addedTotal += texts.length
      perFile.push(`${area}.json +${texts.length}`)
      continue
    }

    // Existing file: append new keys textually before the closing brace so the
    // original bytes (key order, \uXXXX escapes, blank-line grouping, existing
    // translations) are preserved untouched — a clean add-only diff.
    const raw = fs.readFileSync(filePath, 'utf-8')
    let existing: Record<string, unknown>
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) throw new Error('root value is not an object')
      existing = parsed
    } catch (error) {
      console.warn(`[merge] skip ${area}.json (parse error: ${errorMessage(error)})`)
      continue
    }
    const fresh = texts.filter((t) => !(t in existing))
    if (fresh.length === 0) continue
    appendKeysToExistingFile(filePath, raw, fresh)
    addedTotal += fresh.length
    perFile.push(`${area}.json +${fresh.length}`)
  }
  if (addedTotal > 0) {
    console.log(`[merge] added ${addedTotal} new untranslated keys: ${perFile.join(', ')}`)
  } else {
    console.log('[merge] no new keys (locale files already cover all extracted strings)')
  }
}

function writeLocaleFile(
  filePath: string,
  obj: Record<string, unknown>,
  eol: '\n' | '\r\n'
): void {
  let text = JSON.stringify(obj, null, 2) + '\n'
  if (eol === '\r\n') text = text.replace(/\n/g, '\r\n')
  fs.writeFileSync(filePath, text)
}

// Splice `  "key": "",` lines in before the root object's closing brace without
// re-serializing any existing content. Preserves the file's exact bytes, EOL
// style, escaping and blank-line grouping — so the diff is purely additive.
function appendKeysToExistingFile(filePath: string, raw: string, newKeys: string[]): void {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lastBrace = raw.lastIndexOf('}')
  if (lastBrace < 0) throw new Error(`no closing brace in ${filePath}`)

  const head = raw.slice(0, lastBrace).replace(/\s+$/, '') // drop trailing ws/newlines
  const needsComma = !head.endsWith('{') && !head.endsWith(',')
  const lines = newKeys.map((k) => `  ${JSON.stringify(k)}: ""`)
  const insertion = (needsComma ? ',' : '') + eol + lines.join(',' + eol) + eol
  fs.writeFileSync(filePath, head + insertion + '}' + eol)
}

// Keep _meta and _overrides at the top; sort the rest alphabetically.
function reorderLocaleObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (obj._meta !== undefined) out._meta = obj._meta
  if (obj._overrides !== undefined) out._overrides = obj._overrides
  const keys = Object.keys(obj)
    .filter((k) => k !== '_meta' && k !== '_overrides')
    .sort((a, b) => a.localeCompare(b))
  for (const k of keys) out[k] = obj[k]
  return out
}

// ── Diff command ─────────────────────────────────────────────────────────────
function diff(oldPath: string, newPath: string): void {
  const oldCat = readDiffCatalog(oldPath)
  const newCat = readDiffCatalog(newPath)
  const oldSet = new Set(oldCat.strings.map((s) => s.text))
  const newSet = new Set(newCat.strings.map((s) => s.text))

  const added = newCat.strings.filter((s) => !oldSet.has(s.text)).map((s) => s.text)
  const removed = oldCat.strings.filter((s) => !newSet.has(s.text)).map((s) => s.text)

  console.log(`=== String diff: ${oldCat.appVersion} → ${newCat.appVersion} ===`)
  console.log(`Added:   ${added.length}`)
  console.log(`Removed: ${removed.length}`)
  console.log('')
  if (added.length) {
    console.log('--- Added (translate these) ---')
    for (const t of added.sort()) console.log(`  + ${JSON.stringify(t)}`)
  }
  if (removed.length) {
    console.log('\n--- Removed (English no longer present; translations now dead) ---')
    for (const t of removed.sort()) console.log(`  - ${JSON.stringify(t)}`)
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const args: ExtractArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--map' || a === '--app-dir') {
      const value = argv[++i]
      if (!value) throw new Error(`${a} requires a path`)
      if (a === '--map') args.map = value
      else args.appDir = value
    }
    else positional.push(a)
  }
  return { positional, args }
}

function main(): void {
  const { positional, args } = parseArgs(process.argv.slice(2))

  if (positional[0] === 'diff') {
    const oldCatalog = positional[1]
    const newCatalog = positional[2]
    if (!oldCatalog || !newCatalog) {
      console.error('Usage: pnpm run locales:diff -- <oldCatalog.json> <newCatalog.json>')
      process.exit(1)
    }
    diff(oldCatalog, newCatalog)
    return
  }

  const locale = positional[0] || 'zh-CN'
  extract(locale, args)
}

main()
