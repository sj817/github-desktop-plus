#!/usr/bin/env node
/**
 * Source-map-driven i18n string extractor.
 *
 * GitHub Desktop ships a full source map (resources/app/renderer.js.map) whose
 * `sourcesContent` embeds the original, un-minified TSX. We parse those sources
 * with the TypeScript compiler API and collect every user-visible English string
 * (JSX text + string-literal UI attributes), each with its file, line, section
 * and injection target. This replaces the lossy regex scan of a separately
 * checked-out source repo (scripts/scan-all-strings.py, now deprecated) with a
 * precise, version-diffable catalog derived from the app's own build.
 *
 * Usage:
 *   node scripts/extract-strings.mjs [locale] [--map <path>] [--app-dir <dir>]
 *   node scripts/extract-strings.mjs diff <oldCatalog.json> <newCatalog.json>
 *
 * Defaults: locale=zh-CN, map auto-discovered from the installed app.
 *
 * Outputs (extract mode):
 *   generated/strings/<appVersion>.json            machine catalog (diff source of truth)
 *   generated/strings/ambiguous-<appVersion>.json  strings at >1 location (need anchors)
 *   locales/<locale>/<area>.json                    NEW keys merged in, empty value, add-only
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const localesDir = path.join(rootDir, 'locales')
// Tracked (not under the gitignored generated/): the catalog is the committed
// baseline that future versions diff against, not a throwaway build artifact.
const stringsOutDir = path.join(rootDir, 'string-catalog')

// ── UI attribute / prop names that carry visible strings ─────────────────────
// Mirrors scripts/scan-all-strings.py patterns 2 & 3.
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

// ── Noise filters (ported from scan-all-strings.py) ──────────────────────────
const SKIP_PATTERNS = [
  /^https?:\/\//,
  /^[a-z][a-z0-9_-]+(\/[a-z0-9_-]+)+$/,
  /^[a-z][a-z0-9-_]*$/,
  /^[A-Z0-9_-]+$/,
  /^&\w+;$/,
  /^[\d\s%px.]+$/,
  /[=>{}[\]()]/,
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

function isValidCandidate(text) {
  if (!text || text.length < 2) return false
  if (HAS_CJK.test(text)) return false
  if (!HAS_ALPHA.test(text)) return false
  if (SKIP_EXACT.has(text)) return false
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(text)) return false
  }
  const words = text.split(/\s+/)
  if (words.length === 1) {
    const word = words[0]
    if (word === word.toLowerCase() && word !== word.toUpperCase()) return false
    if (/^[a-z][a-z0-9_-]+$/.test(word)) return false
  }
  return true
}

// ── Map discovery (local-first) ──────────────────────────────────────────────
// Modelled on the Rust proc.rs::find_main_js / gdp_core detector path logic.
function parseVersion(name) {
  const m = /app-(\d+)\.(\d+)\.(\d+)/.exec(name)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function discoverInstalledMap() {
  const candidates = []
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

function resolveMapPath(args) {
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

function inferAppVersion(mapPath) {
  const m = /app-(\d+\.\d+\.\d+)/.exec(mapPath)
  if (m) return m[1]
  return 'unknown'
}

// ── Section / target classification ──────────────────────────────────────────
// section = first path segment under app/src/ui (mirrors scan-all-strings.py
// get_section) so it lines up with the existing ui-<section>.json files.
function classify(relFile) {
  // relFile like "app/src/ui/changes/commit-message.tsx" or "app/src/lib/..."
  const norm = relFile.replace(/\\/g, '/')
  const uiIdx = norm.indexOf('app/src/ui/')
  let section = 'root'
  if (uiIdx >= 0) {
    const rest = norm.slice(uiIdx + 'app/src/ui/'.length)
    const parts = rest.split('/')
    section = parts.length > 1 ? parts[0] : 'root'
  }

  let target = 'renderer'
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
const SECTION_ALIASES = {
  preferences: 'ui-settings',
  tutorial: 'ui-welcome-tutorial',
  welcome: 'ui-welcome-tutorial',
  'open-pull-request': 'ui-pull-request',
  'clone-repository': 'ui-clone-add',
  'add-repository': 'ui-clone-add',
}

// Which source-locale file a string is routed into.
function areaFileFor(section, target) {
  if (target === 'main') return 'menu'
  if (target === 'renderer-ipc') return 'ui-context-menus'
  if (section === 'root') return 'ui'
  return SECTION_ALIASES[section] ?? `ui-${section}`
}

// ── AST extraction ───────────────────────────────────────────────────────────
function getAttrName(node) {
  const name = node.name
  if (!name) return null
  if (ts.isIdentifier(name)) return name.text
  // Namespaced (aria-label etc.) — TS represents as JsxNamespacedName
  if (name.namespace && name.name) return `${name.namespace.text}-${name.name.text}`
  return name.getText?.() ?? null
}

function literalText(init) {
  if (!init) return null
  if (ts.isStringLiteral(init)) return init.text
  // attr={'...'} form
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) {
    return init.expression.text
  }
  return null
}

function extractFromSource(relFile, content) {
  const isTsx = relFile.endsWith('.tsx')
  const sf = ts.createSourceFile(
    relFile,
    content,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const hits = []
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1

  const visit = (node) => {
    // JSX text nodes
    if (ts.isJsxText(node)) {
      const raw = node.text.trim()
      if (raw && /^[A-Z]/.test(raw) && !raw.includes('\n')) {
        hits.push({ text: raw, kind: 'text', line: lineOf(node.getStart(sf)) })
      }
    }
    // JSX attributes with string-literal values
    if (ts.isJsxAttribute(node)) {
      const attr = getAttrName(node)
      if (attr && STRING_ATTRS.has(attr)) {
        const value = literalText(node.initializer)
        if (value) {
          hits.push({ text: value.trim(), kind: `attr:${attr}`, line: lineOf(node.getStart(sf)) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

// ── Extract command ──────────────────────────────────────────────────────────
function extract(locale, args) {
  const mapPath = resolveMapPath(args)
  const appVersion = inferAppVersion(mapPath)
  console.log(`[extract] map:     ${mapPath}`)
  console.log(`[extract] version: ${appVersion}`)

  const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'))
  const sources = map.sources ?? []
  const contents = map.sourcesContent ?? []

  // catalog: text -> { locations: [{file,line,kind,section,target}], sections:Set, areas:Set }
  const catalog = new Map()
  let scannedFiles = 0

  for (let i = 0; i < sources.length; i++) {
    const src = String(sources[i])
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
    let hits
    try {
      hits = extractFromSource(rel, content)
    } catch (e) {
      console.warn(`[extract] parse failed for ${rel}: ${e.message}`)
      continue
    }

    for (const hit of hits) {
      if (!isValidCandidate(hit.text)) continue
      let entry = catalog.get(hit.text)
      if (!entry) {
        entry = { text: hit.text, locations: [], sections: new Set(), areas: new Set() }
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
  const catalogJson = {
    appVersion,
    mapPath,
    generatedFrom: 'source-map',
    stringCount: entries.length,
    strings: entries.map((e) => ({
      text: e.text,
      area: areaFileFor(
        // route by the first location's section/target (all locations of a
        // string share the same area only when unambiguous; ambiguous ones are
        // flagged separately below)
        e.locations[0].section,
        e.locations[0].target
      ),
      ambiguous: e.sections.size > 1 || e.areas.size > 1,
      locations: e.locations,
    })),
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
function collectExistingKeys(localeDir) {
  const keys = new Set()
  if (!fs.existsSync(localeDir)) return keys
  for (const name of fs.readdirSync(localeDir)) {
    if (!name.endsWith('.json')) continue
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(localeDir, name), 'utf-8'))
      for (const k of Object.keys(obj)) {
        if (k !== '_meta' && k !== '_overrides') keys.add(k)
      }
    } catch {
      // ignore unparseable file
    }
  }
  return keys
}

function mergeIntoLocaleFiles(locale, entries) {
  const localeDir = path.join(localesDir, locale)
  fs.mkdirSync(localeDir, { recursive: true })

  const existingKeys = collectExistingKeys(localeDir)

  // Group NEW strings (absent from every existing file) by routed area file.
  const byArea = new Map()
  for (const e of entries) {
    if (existingKeys.has(e.text)) continue // already covered somewhere — skip
    const loc = e.locations[0]
    const area = areaFileFor(loc.section, loc.target)
    if (!byArea.has(area)) byArea.set(area, { texts: [], section: loc.section })
    byArea.get(area).texts.push(e.text)
  }

  let addedTotal = 0
  const perFile = []
  for (const [area, { texts, section }] of byArea) {
    const filePath = path.join(localeDir, `${area}.json`)
    const isNewFile = !fs.existsSync(filePath)

    if (isNewFile) {
      // Brand-new file: seed _meta header (repo convention) + sorted keys.
      // Auto-created files are always renderer DOM areas (main→menu.json,
      // renderer-ipc→ui-context-menus.json already exist, never created here).
      const obj = {
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
    let existing
    try {
      existing = JSON.parse(raw)
    } catch (e) {
      console.warn(`[merge] skip ${area}.json (parse error: ${e.message})`)
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

function writeLocaleFile(filePath, obj, eol) {
  let text = JSON.stringify(obj, null, 2) + '\n'
  if (eol === '\r\n') text = text.replace(/\n/g, '\r\n')
  fs.writeFileSync(filePath, text)
}

// Splice `  "key": "",` lines in before the root object's closing brace without
// re-serializing any existing content. Preserves the file's exact bytes, EOL
// style, escaping and blank-line grouping — so the diff is purely additive.
function appendKeysToExistingFile(filePath, raw, newKeys) {
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
function reorderLocaleObject(obj) {
  const out = {}
  if (obj._meta !== undefined) out._meta = obj._meta
  if (obj._overrides !== undefined) out._overrides = obj._overrides
  const keys = Object.keys(obj)
    .filter((k) => k !== '_meta' && k !== '_overrides')
    .sort((a, b) => a.localeCompare(b))
  for (const k of keys) out[k] = obj[k]
  return out
}

// ── Diff command ─────────────────────────────────────────────────────────────
function diff(oldPath, newPath) {
  const oldCat = JSON.parse(fs.readFileSync(oldPath, 'utf-8'))
  const newCat = JSON.parse(fs.readFileSync(newPath, 'utf-8'))
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
function parseArgs(argv) {
  const positional = []
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--map') args.map = argv[++i]
    else if (a === '--app-dir') args.appDir = argv[++i]
    else positional.push(a)
  }
  return { positional, args }
}

function main() {
  const { positional, args } = parseArgs(process.argv.slice(2))

  if (positional[0] === 'diff') {
    if (positional.length < 3) {
      console.error('Usage: node scripts/extract-strings.mjs diff <oldCatalog.json> <newCatalog.json>')
      process.exit(1)
    }
    diff(positional[1], positional[2])
    return
  }

  const locale = positional[0] || 'zh-CN'
  extract(locale, args)
}

main()
