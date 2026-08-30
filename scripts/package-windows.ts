import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'

interface Manifest {
  version: string
}

const root = fileURLToPath(new URL('..', import.meta.url))
const target = path.join(root, 'target', 'velopack')
const staging = path.join(target, 'staging')
const releases = path.join(target, 'releases')
const sourceExe = path.join(root, 'target', 'release', 'gdp.exe')
const stagedExe = path.join(staging, 'gdp.exe')
const setupName = 'GitHubDesktopPlus-win-x64-Setup.exe'
const installerIcon = path.join(root, 'apps', 'gdp', 'assets', 'gdp.ico')
const installerSplash = path.join(root, 'apps', 'gdp', 'assets', 'installer-splash.png')

if (process.platform !== 'win32') {
  throw new Error('Windows packages must be built on Windows')
}

const manifest = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
) as Manifest

await stat(sourceExe).catch(() => {
  throw new Error(`release binary is missing: ${sourceExe}`)
})

const { stdout: binaryVersion } = await execa(sourceExe, ['--version'])
const expectedVersion = `gdp ${manifest.version}`
if (binaryVersion.trim() !== expectedVersion) {
  throw new Error(`expected '${expectedVersion}', got '${binaryVersion.trim()}'`)
}

await rm(target, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
await mkdir(releases, { recursive: true })
await copyFile(sourceExe, stagedExe)
await copyFile(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE.txt'))

await execa('dotnet', ['tool', 'restore'], { cwd: root, stdio: 'inherit' })
await execa('dotnet', [
  'tool',
  'run',
  'vpk',
  'pack',
  '--packId',
  'GitHubDesktopPlus',
  '--packVersion',
  manifest.version,
  '--packDir',
  staging,
  '--mainExe',
  'gdp.exe',
  '--packTitle',
  'GitHub Desktop Plus',
  '--packAuthors',
  'sj817',
  '--icon',
  installerIcon,
  '--splashImage',
  installerSplash,
  '--runtime',
  'win-x64',
  '--channel',
  'win-x64',
  '--splashProgressColor',
  '#7DB6E8',
  '--outputDir',
  releases,
], { cwd: root, stdio: 'inherit' })

const generated = await readdir(releases)
const setupCandidates = generated.filter(file => file.endsWith('-Setup.exe'))
if (setupCandidates.length !== 1) {
  throw new Error(`expected one Setup.exe, found: ${setupCandidates.join(', ') || 'none'}`)
}

const generatedSetup = path.join(releases, setupCandidates[0]!)
if (path.basename(generatedSetup) !== setupName) {
  throw new Error(`expected '${setupName}', got '${path.basename(generatedSetup)}'`)
}

const setupBytes = await readFile(generatedSetup)
const setupHash = createHash('sha256').update(setupBytes).digest('hex')
await writeFile(
  `${generatedSetup}.sha256`,
  `${setupHash}  ${setupName}\n`,
  'ascii',
)
await copyFile(path.join(root, 'install.sh'), path.join(releases, 'install.sh'))

const assets = await Promise.all((await readdir(releases)).sort().map(async file => ({
  file,
  size: (await stat(path.join(releases, file))).size,
})))
for (const asset of assets) {
  console.log(`[package:windows] ${asset.file} (${asset.size} bytes)`)
}
