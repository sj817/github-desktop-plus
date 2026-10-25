import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// gdp evaluates the main bundle through the inspector, where `require` only
// exists while that evaluation runs. Anything called later (IPC handlers,
// timers) gets a ReferenceError, so only index.ts, which runs during the
// injection, may call it.
test('main-process modules other than index.ts never call require', async () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  for (const name of await readdir(src)) {
    if (!name.endsWith('.ts') || name === 'index.ts') continue
    const source = await readFile(path.join(src, name), 'utf8')
    assert.doesNotMatch(source, /\brequire\s*\(/, name)
  }
})
