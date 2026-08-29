import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const forbiddenExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean)

type Offender = { file: string; reason: string }

const offenders: Offender[] = []
for (const file of sourceFiles) {
  if (!existsSync(file)) continue

  const extension = path.extname(file).toLowerCase()
  if (forbiddenExtensions.has(extension)) {
    offenders.push({ file, reason: `forbidden ${extension} source file` })
    continue
  }

  if (extension !== '.html') continue
  const html = readFileSync(file, 'utf8')
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) {
    offenders.push({ file, reason: 'inline <script>' })
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    offenders.push({ file, reason: 'inline event handler' })
  }
  if (/\b(?:href|src)\s*=\s*["']\s*javascript:/i.test(html)) {
    offenders.push({ file, reason: 'javascript: URL' })
  }
}

if (offenders.length > 0) {
  console.error('JavaScript source is forbidden:')
  for (const { file, reason } of offenders) console.error(`  ${file}: ${reason}`)
  process.exitCode = 1
} else {
  console.log('[source-policy] JavaScript files and inline JavaScript: 0')
}
