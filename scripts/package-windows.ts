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

interface PackagedAsset {
  RelativeFileName: string
  Type: string
}

const root = fileURLToPath(new URL('..', import.meta.url))
const target = path.join(root, 'target', 'velopack')
const staging = path.join(target, 'staging')
const releases = path.join(target, 'releases')
const sourceExe = path.join(root, 'target', 'release', 'gdp.exe')
const stagedExe = path.join(staging, 'gdp.exe')
const msiName = 'GitHubDesktopPlus-win-x64.msi'
const installerIcon = path.join(root, 'apps', 'gdp', 'assets', 'gdp.ico')
const installerSplash = path.join(root, 'apps', 'gdp', 'assets', 'installer-splash.png')
const installerWelcome = path.join(root, 'apps', 'gdp', 'assets', 'installer-welcome.md')
const installerConclusion = path.join(root, 'apps', 'gdp', 'assets', 'installer-conclusion.md')
const msiBanner = path.join(root, 'apps', 'gdp', 'assets', 'msi-banner.bmp')
const msiLogo = path.join(root, 'apps', 'gdp', 'assets', 'msi-logo.bmp')

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
  '--msi',
  '--instLocation',
  'Either',
  '--instWelcome',
  installerWelcome,
  '--instConclusion',
  installerConclusion,
  '--msiBanner',
  msiBanner,
  '--msiLogo',
  msiLogo,
  '--outputDir',
  releases,
], { cwd: root, stdio: 'inherit' })

const generated = await readdir(releases)
const setupCandidates = generated.filter(file => file.endsWith('-Setup.exe'))
if (setupCandidates.length !== 1) {
  throw new Error(`expected one Setup.exe, found: ${setupCandidates.join(', ') || 'none'}`)
}

const generatedSetup = path.join(releases, setupCandidates[0]!)
const generatedMsi = path.join(releases, msiName)
await stat(generatedMsi).catch(() => {
  throw new Error(`MSI installer is missing: ${generatedMsi}`)
})

// Setup.exe is intentionally a no-questions one-click bootstrapper. Publishing
// it beside the MSI makes a double-click look like the app simply launched, so
// only expose the MSI as the interactive Windows installer.
await rm(generatedSetup, { force: true })
const assetManifestPath = path.join(releases, 'assets.win-x64.json')
const assetManifest = JSON.parse(
  await readFile(assetManifestPath, 'utf8'),
) as PackagedAsset[]
const publishedAssets = assetManifest.filter(asset => asset.Type !== 'Installer')
if (!publishedAssets.some(asset => asset.RelativeFileName === msiName)) {
  throw new Error(`asset manifest does not contain '${msiName}'`)
}
await writeFile(assetManifestPath, JSON.stringify(publishedAssets), 'utf8')

const msiBytes = await readFile(generatedMsi)
const msiHash = createHash('sha256').update(msiBytes).digest('hex')
await writeFile(
  `${generatedMsi}.sha256`,
  `${msiHash}  ${msiName}\n`,
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
