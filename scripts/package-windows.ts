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
const setupName = 'GitHubDesktopPlus-win-x64-Setup.exe'
const installerIcon = path.join(root, 'apps', 'gdp', 'assets', 'gdp.ico')
const installerSplash = path.join(root, 'apps', 'gdp', 'assets', 'installer-splash.png')
const installerScript = path.join(root, 'installer', 'windows', 'GitHubDesktopPlus.iss')

const innoCandidates = [
  process.env.INNO_SETUP_COMPILER,
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 7', 'ISCC.exe')
    : undefined,
  process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, 'Inno Setup 7', 'ISCC.exe')
    : undefined,
  process.env['ProgramFiles(x86)']
    ? path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 7', 'ISCC.exe')
    : undefined,
].filter((candidate): candidate is string => Boolean(candidate))

if (process.platform !== 'win32') {
  throw new Error('Windows packages must be built on Windows')
}

const manifest = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
) as Manifest

await stat(sourceExe).catch(() => {
  throw new Error(`release binary is missing: ${sourceExe}`)
})
await stat(installerScript).catch(() => {
  throw new Error(`Inno Setup script is missing: ${installerScript}`)
})

let innoCompiler: string | undefined
for (const candidate of innoCandidates) {
  if (await stat(candidate).then(() => true).catch(() => false)) {
    innoCompiler = candidate
    break
  }
}
if (!innoCompiler) {
  throw new Error(
    'Inno Setup 7 compiler was not found; install JRSoftware.InnoSetup.7 or set INNO_SETUP_COMPILER',
  )
}

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
  'PerUser',
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
if (path.basename(generatedSetup) !== setupName) {
  throw new Error(`expected '${setupName}', got '${path.basename(generatedSetup)}'`)
}
await stat(generatedMsi).catch(() => {
  throw new Error(`MSI installer is missing: ${generatedMsi}`)
})

const msiBytes = await readFile(generatedMsi)
// Velopack's Setup.exe is intentionally one-click. Replace it with an Inno
// Setup wizard while keeping the generated MSI as the transactional payload.
await rm(generatedSetup, { force: true })
await execa(innoCompiler, [
  `/DAppVersion=${manifest.version}`,
  `/DSourceMsi=${generatedMsi}`,
  `/DOutputDir=${releases}`,
  `/DOutputBaseFilename=${path.parse(setupName).name}`,
  `/DSetupIcon=${installerIcon}`,
  installerScript,
], { cwd: root, stdio: 'inherit' })
await stat(generatedSetup).catch(() => {
  throw new Error(`Inno Setup installer is missing: ${generatedSetup}`)
})

const assetManifestPath = path.join(releases, 'assets.win-x64.json')
const assetManifest = JSON.parse(
  await readFile(assetManifestPath, 'utf8'),
) as PackagedAsset[]
if (!assetManifest.some(asset => asset.RelativeFileName === msiName)) {
  throw new Error(`asset manifest does not contain '${msiName}'`)
}
if (!assetManifest.some(asset => asset.RelativeFileName === setupName && asset.Type === 'Installer')) {
  throw new Error(`asset manifest does not contain '${setupName}'`)
}

const msiHash = createHash('sha256').update(msiBytes).digest('hex')
await writeFile(
  `${generatedMsi}.sha256`,
  `${msiHash}  ${msiName}\n`,
  'ascii',
)
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
