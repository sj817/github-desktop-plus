import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { watch } from 'chokidar'
import {
  parse,
  printParseErrorCode,
  visit,
  type JSONPath,
  type ParseError,
  type ParseOptions,
} from 'jsonc-parser'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const resourcesDir = path.join(rootDir, 'apps', 'gdp', 'resources')
const localesDir = path.join(resourcesDir, 'locales')

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
type JsonObject = { [key: string]: JsonValue }

interface DuplicateKey {
  key: string
  location: string
}

interface ParsedJson {
  value: JsonValue
  duplicates: DuplicateKey[]
}

const parseOptions: ParseOptions = {
  allowTrailingComma: false,
  disallowComments: true,
  allowEmptyContent: false,
}

function formatJsonPath(jsonPath: JSONPath): string {
  return jsonPath.reduce<string>(
    (location, segment) =>
      typeof segment === 'number'
        ? `${location}[${segment}]`
        : `${location}.${JSON.stringify(segment)}`,
    '$'
  )
}

function formatParseError(fileName: string, source: string, error: ParseError): string {
  const before = source.slice(0, error.offset)
  const line = before.split('\n').length
  const column = error.offset - before.lastIndexOf('\n')
  return `${fileName}:${line}:${column}: ${printParseErrorCode(error.error)}`
}

async function jsonFiles(locale: string): Promise<string[]> {
  const dir = path.join(localesDir, locale)
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => path.join(dir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
}

async function readJsonWithDuplicates(filePath: string): Promise<ParsedJson> {
  const source = await readFile(filePath, 'utf8')
  const fileName = path.relative(rootDir, filePath)
  const duplicates: DuplicateKey[] = []
  const seenByObject = new Map<string, Set<string>>()

  visit(
    source,
    {
      onObjectProperty(key, _offset, _length, _line, _character, pathSupplier) {
        const location = formatJsonPath(pathSupplier())
        const seen = seenByObject.get(location) ?? new Set<string>()
        if (seen.has(key)) duplicates.push({ key, location })
        seen.add(key)
        seenByObject.set(location, seen)
      },
    },
    parseOptions
  )

  const errors: ParseError[] = []
  const value = parse(source, errors, parseOptions) as JsonValue
  if (errors.length > 0) {
    throw new Error(errors.map(error => formatParseError(fileName, source, error)).join('\n'))
  }
  return { value, duplicates }
}

/**
 * `_aliases` maps a canonical source string to the other spellings that should
 * reuse its translation. The runtime expands them (packages/hooks/src/i18n-lookup.ts);
 * this only catches the mistakes it would otherwise swallow silently — a typo
 * in the canonical key, or an alias that already has a translation of its own.
 */
function validateAliases(bundled: JsonObject): void {
  const translated = new Set<string>()
  for (const entries of Object.values(bundled)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value === 'string' && !key.startsWith('_')) translated.add(key)
    }
  }

  let count = 0
  for (const [category, entries] of Object.entries(bundled)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    const aliases = entries._aliases
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) continue

    for (const [canonical, sources] of Object.entries(aliases)) {
      if (!Array.isArray(sources)) {
        console.warn(`[locales] ${category}._aliases.${JSON.stringify(canonical)} is not an array`)
        continue
      }
      if (!translated.has(canonical)) {
        console.warn(
          `[locales] ${category}._aliases points at ${JSON.stringify(canonical)}, which has no translation`
        )
      }
      for (const source of sources) {
        if (typeof source !== 'string') {
          console.warn(
            `[locales] ${category}._aliases.${JSON.stringify(canonical)} contains a non-string value`
          )
          continue
        }
        if (translated.has(source)) {
          console.warn(
            `[locales] ${category}._aliases lists ${JSON.stringify(source)}, ` +
              'which already has its own translation (the alias will be ignored)'
          )
        }
        count += 1
      }
    }
  }

  if (count > 0) console.log(`[locales] ${count} alias(es) declared`)
}

async function bundle(locale: string): Promise<string> {
  const files = await jsonFiles(locale)
  const bundled: JsonObject = {}
  const duplicateErrors: string[] = []

  for (const filePath of files) {
    const { value, duplicates } = await readJsonWithDuplicates(filePath)
    if (duplicates.length > 0) {
      const name = path.relative(rootDir, filePath)
      const keys = duplicates.map(item => `${item.location}.${JSON.stringify(item.key)}`)
      duplicateErrors.push(`${name}: ${keys.join(', ')}`)
    }
    const key = path.basename(filePath, '.json')
    bundled[key] = value
  }

  if (duplicateErrors.length > 0) {
    throw new Error(`duplicate locale keys:\n${duplicateErrors.join('\n')}`)
  }
  validateAliases(bundled)
  console.log(`[locales] ${locale}: validated and bundled ${files.length} source file(s)`)
  return `${JSON.stringify(bundled, null, 2)}\n`
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function copyToRuntime(locale: string, content: string): Promise<boolean> {
  const runtimeDir =
    process.env.GDP_RUNTIME_DATA_DIR ??
    path.join(rootDir, 'target', 'debug', 'gdp-data')
  const runtimeLocalesDir = path.join(runtimeDir, 'locales')
  if (!(await pathExists(runtimeDir))) {
    return false
  }

  await mkdir(runtimeLocalesDir, { recursive: true })
  const target = path.join(runtimeLocalesDir, `${locale}.json`)
  await writeFile(target, content)
  await writeFile(path.join(runtimeDir, '.gdp-locale-reload'), String(Math.floor(Date.now() / 1000)))
  console.log(`[locales] pushed ${path.relative(rootDir, target)} and touched runtime reload marker`)
  return true
}

interface PrepareOptions {
  runtime?: boolean
}

async function prepare(locale: string, options: PrepareOptions = {}): Promise<void> {
  const content = await bundle(locale)
  if (options.runtime) {
    await copyToRuntime(locale, content)
  }
}

async function watchLocale(locale: string): Promise<void> {
  await prepare(locale, { runtime: true })
  const dir = path.join(localesDir, locale)
  console.log(`[locales] watching ${path.relative(rootDir, dir)}`)

  const watcher = watch(dir, {
    depth: 0,
    ignoreInitial: true,
    atomic: 200,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 },
  })
  let build: Promise<void> = Promise.resolve()
  const rebuild = (file: string) => {
    if (!file.endsWith('.json')) return
    build = build.then(async () => {
      await prepare(locale, { runtime: true })
    }).catch(error => {
      console.error('[locales] watch build failed')
      console.error(error)
    })
  }
  watcher.on('add', rebuild).on('change', rebuild).on('unlink', rebuild)
  await new Promise<void>((_resolve, reject) => watcher.on('error', reject))
}

async function run(): Promise<void> {
  const command = process.argv[2] ?? 'prepare'
  const locale = process.argv[3] ?? 'zh-CN'

  if (command === 'prepare') {
    await prepare(locale)
    return
  }
  if (command === 'watch') {
    await watchLocale(locale)
    return
  }

  throw new Error(`unknown command: ${command}`)
}

run().catch(error => {
  console.error('[locales] failed')
  console.error(error)
  process.exitCode = 1
})
