/**
 * In-memory optimizations for the official renderer. Unknown bundle shapes are
 * left untouched. No diff text, token values, or original line numbers change.
 */

const identifier = '[A-Za-z_$][\\w$]*'
const modifiedRowsStart = new RegExp(
  `function (${identifier})\\((${identifier}),(${identifier})\\)\\{` +
  `if\\(0===\\2\\.length\\)return\\[\\];const (${identifier})=\\2\\[0\\]\\.diffLineNumber,` +
  `(${identifier})=new Array,(${identifier})=new Array;`,
  'g',
)

export interface ModifiedRowsFunction {
  readonly source: string
  readonly start: number
  readonly name: string
}

/** Locate only the uniquely recognized upstream row builder, for verification. */
export function findModifiedRowsFunction(source: string): ModifiedRowsFunction | null {
  const candidates = [...source.matchAll(modifiedRowsStart)]
  if (candidates.length !== 1) return null
  const match = candidates[0]!
  const start = match.index
  // The next upstream function builds individual row data. A bounded search
  // avoids accidentally treating a changed bundle's remaining contents as code.
  const window = source.slice(start, start + 8000)
  const end = window.indexOf('}function ')
  const candidate = end === -1 ? window : window.slice(0, end + 1)
  const returned = /return [A-Za-z_$][\w$]*\}$/.test(candidate)
  if (!returned || !candidate.includes('"oldLineNumber"') || !candidate.includes('"newLineNumber"')) {
    return null
  }
  return { source: candidate, start, name: match[1]! }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function optimizeTokenConsumption(source: string): string | null {
  const allocation = new RegExp(
    `const (${identifier})=new Array,(${identifier})=new Array,(${identifier})=new Array;`,
    'g',
  )
  const allocations = [...source.matchAll(allocation)]
  if (allocations.length !== 1) return null
  const [, output, before, after] = allocations[0]!
  if (!output || !before || !after || before === after || !source.endsWith(`return ${output}}`)) {
    return null
  }

  // Token arrays are fully populated before the row assembly loops. We only
  // replace their four destructive reads once all subsequent references are
  // proven to be shift() calls. Sparse arrays and exhausted arrays still yield
  // undefined at precisely the same rows.
  const boundary = new RegExp(`let (${identifier})=0;for\\(;`).exec(source)
  if (!boundary || source.includes('__gdpDiffToken')) return null
  const tail = source.slice(boundary.index)
  for (const tokenArray of [before, after]) {
    const refs = [...tail.matchAll(new RegExp(
      `(?<![\\w$])${escapeRegExp(tokenArray)}(?![\\w$])`, 'g',
    ))]
    const shifts = [...tail.matchAll(new RegExp(`${escapeRegExp(tokenArray)}\\.shift\\(\\)`, 'g'))]
    if (refs.length !== 2 || shifts.length !== 2) return null
  }
  if (!tail.includes(`"oldLineNumber",${before}.shift()`) ||
      !tail.includes(`"newLineNumber",${after}.shift()`)) return null

  const optimized = tail
    .replaceAll(`${before}.shift()`, `${before}[__gdpDiffTokenBefore++]`)
    .replaceAll(`${after}.shift()`, `${after}[__gdpDiffTokenAfter++]`)
  return source.slice(0, boundary.index) +
    'let __gdpDiffTokenBefore=0,__gdpDiffTokenAfter=0;' + optimized
}

export interface RendererPerformanceResult {
  readonly code: string
  readonly applied: number
  readonly patches: readonly string[]
  readonly skipped: readonly string[]
}

export function patchRendererPerformance(source: string): RendererPerformanceResult {
  let code = source
  const patches: string[] = []
  const skipped: string[] = []
  const rows = findModifiedRowsFunction(code)
  const optimizedRows = rows && optimizeTokenConsumption(rows.source)
  if (rows && optimizedRows) {
    code = code.slice(0, rows.start) + optimizedRows + code.slice(rows.start + rows.source.length)
    patches.push('linear-diff-token-consumption')
  } else {
    skipped.push('linear-diff-token-consumption')
  }

  // Upstream checks identity later, after starting Git refresh and network
  // work. Only skip a different repository ID here: recovery can return a new
  // model for the same repository, whose initial refresh must still run. Keep
  // the later guard and all general/background refresh entry points intact.
  const refreshStart = new RegExp(
    `async _selectRepositoryRefreshTasks\\((${identifier}),(${identifier})\\)\\{` +
    `if\\(this\\._refreshRepository\\(\\1\\),`, 'g',
  )
  const refreshMatches = [...code.matchAll(refreshStart)]
  const refresh = refreshMatches.length === 1 ? refreshMatches[0] : undefined
  if (refresh) {
    const start = refresh.index
    const boundary = code.indexOf('}stopBackgroundPruner(){', start)
    const method = boundary === -1 ? '' : code.slice(start, boundary + 1)
    if (method.length <= 3000 && method.includes(`return this.selectedRepository!==${refresh[1]}?null:`)) {
      const brace = code.indexOf('{', start)
      code = code.slice(0, brace + 1) +
        `if(this.selectedRepository?.id!==${refresh[1]}.id)return null;` + code.slice(brace + 1)
      patches.push('skip-stale-repository-selection')
    } else {
      skipped.push('skip-stale-repository-selection')
    }
  } else {
    skipped.push('skip-stale-repository-selection')
  }
  return { code, applied: patches.length, patches, skipped }
}
