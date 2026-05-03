import { mkdir, readFile, readdir, stat, writeFile, watch } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const localesDir = path.join(rootDir, 'locales')
const generatedDir = path.join(rootDir, 'generated', 'locales')

class JsonParser {
  constructor(source, fileName) {
    this.source = source
    this.fileName = fileName
    this.index = 0
    this.duplicates = []
  }

  parse() {
    const value = this.parseValue('$')
    this.skipWhitespace()
    if (this.index !== this.source.length) {
      this.fail('unexpected trailing content')
    }
    return { value, duplicates: this.duplicates }
  }

  parseValue(location) {
    this.skipWhitespace()
    const ch = this.peek()
    if (ch === '{') return this.parseObject(location)
    if (ch === '[') return this.parseArray(location)
    if (ch === '"') return this.parseString()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber()
    if (this.consumeWord('true')) return true
    if (this.consumeWord('false')) return false
    if (this.consumeWord('null')) return null
    this.fail(`unexpected token at ${location}`)
  }

  parseObject(location) {
    this.expect('{')
    const entries = new Map()
    this.skipWhitespace()
    if (this.peek() === '}') {
      this.index += 1
      return {}
    }

    while (true) {
      this.skipWhitespace()
      if (this.peek() !== '"') this.fail('object key must be a string')
      const key = this.parseString()
      this.skipWhitespace()
      this.expect(':')
      const childLocation = `${location}.${JSON.stringify(key)}`
      const value = this.parseValue(childLocation)

      if (entries.has(key)) {
        this.duplicates.push({ key, location })
        entries.delete(key)
      }
      entries.set(key, value)

      this.skipWhitespace()
      const ch = this.peek()
      if (ch === ',') {
        this.index += 1
        continue
      }
      if (ch === '}') {
        this.index += 1
        break
      }
      this.fail('expected , or }')
    }

    return Object.fromEntries(entries)
  }

  parseArray(location) {
    this.expect('[')
    const values = []
    this.skipWhitespace()
    if (this.peek() === ']') {
      this.index += 1
      return values
    }

    while (true) {
      values.push(this.parseValue(`${location}[${values.length}]`))
      this.skipWhitespace()
      const ch = this.peek()
      if (ch === ',') {
        this.index += 1
        continue
      }
      if (ch === ']') {
        this.index += 1
        break
      }
      this.fail('expected , or ]')
    }
    return values
  }

  parseString() {
    const start = this.index
    this.expect('"')
    while (this.index < this.source.length) {
      const ch = this.source[this.index]
      if (ch === '"') {
        this.index += 1
        return JSON.parse(this.source.slice(start, this.index))
      }
      if (ch === '\\') {
        this.index += 2
        continue
      }
      this.index += 1
    }
    this.fail('unterminated string')
  }

  parseNumber() {
    const rest = this.source.slice(this.index)
    const match = rest.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (!match) this.fail('invalid number')
    this.index += match[0].length
    return Number(match[0])
  }

  consumeWord(word) {
    if (this.source.slice(this.index, this.index + word.length) !== word) {
      return false
    }
    this.index += word.length
    return true
  }

  skipWhitespace() {
    while (/\s/.test(this.peek())) {
      this.index += 1
    }
  }

  expect(ch) {
    if (this.peek() !== ch) this.fail(`expected ${ch}`)
    this.index += 1
  }

  peek() {
    return this.source[this.index] ?? ''
  }

  fail(message) {
    throw new Error(`${this.fileName}: ${message} near offset ${this.index}`)
  }
}

async function jsonFiles(locale) {
  const dir = path.join(localesDir, locale)
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => path.join(dir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
}

async function readJsonWithDuplicates(filePath) {
  const source = await readFile(filePath, 'utf8')
  return new JsonParser(source, path.relative(rootDir, filePath)).parse()
}

async function dedupe(locale) {
  const files = await jsonFiles(locale)
  let duplicateCount = 0
  let changedFiles = 0

  for (const filePath of files) {
    const { value, duplicates } = await readJsonWithDuplicates(filePath)
    if (duplicates.length === 0) continue

    duplicateCount += duplicates.length
    changedFiles += 1
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

    const name = path.relative(rootDir, filePath)
    const keys = duplicates.map(item => `${item.location}.${JSON.stringify(item.key)}`)
    console.log(`[locales] deduped ${name}: ${keys.join(', ')}`)
  }

  console.log(`[locales] ${locale}: ${duplicateCount} duplicate key(s), ${changedFiles} file(s) updated`)
}

async function bundle(locale) {
  const files = await jsonFiles(locale)
  const bundled = {}

  for (const filePath of files) {
    const { value } = await readJsonWithDuplicates(filePath)
    const key = path.basename(filePath, '.json')
    bundled[key] = value
  }

  await mkdir(generatedDir, { recursive: true })
  const outFile = path.join(generatedDir, `${locale}.json`)
  await writeFile(outFile, `${JSON.stringify(bundled, null, 2)}\n`, 'utf8')
  console.log(`[locales] bundled ${files.length} file(s) into ${path.relative(rootDir, outFile)}`)
  return outFile
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function copyToRuntime(locale, bundleFile) {
  const runtimeDir =
    process.env.GDP_RUNTIME_DATA_DIR ??
    path.join(rootDir, 'target', 'debug', 'gdp-data')
  const runtimeLocalesDir = path.join(runtimeDir, 'locales')
  if (!(await pathExists(runtimeDir))) {
    return false
  }

  await mkdir(runtimeLocalesDir, { recursive: true })
  const target = path.join(runtimeLocalesDir, `${locale}.json`)
  const content = await readFile(bundleFile)
  await writeFile(target, content)
  await writeFile(path.join(runtimeDir, '.gdp-locale-reload'), String(Math.floor(Date.now() / 1000)))
  console.log(`[locales] pushed ${path.relative(rootDir, target)} and touched runtime reload marker`)
  return true
}

async function notifyRuntime() {
  if (process.env.GDP_NOTIFY_RUNTIME === '0') return
  try {
    await fetch('http://127.0.0.1:7788/api/dev/locales/reload', { method: 'POST' })
  } catch {
    // The runtime may not be up yet. The marker file still covers the normal path.
  }
}

async function prepare(locale, options = {}) {
  await dedupe(locale)
  const bundleFile = await bundle(locale)
  if (options.runtime) {
    await copyToRuntime(locale, bundleFile)
    await notifyRuntime()
  }
  return bundleFile
}

async function watchLocale(locale) {
  await prepare(locale, { runtime: true })
  const dir = path.join(localesDir, locale)
  console.log(`[locales] watching ${path.relative(rootDir, dir)}`)

  let timer
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      prepare(locale, { runtime: true }).catch(error => {
        console.error('[locales] watch build failed')
        console.error(error)
      })
    }, 120)
  }

  for await (const event of watch(dir, { recursive: false })) {
    if (event.filename && String(event.filename).endsWith('.json')) {
      schedule()
    }
  }
}

async function run() {
  const command = process.argv[2] ?? 'prepare'
  const locale = process.argv[3] ?? 'zh-CN'

  if (command === 'dedupe') {
    await dedupe(locale)
    return
  }
  if (command === 'bundle') {
    await bundle(locale)
    return
  }
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
