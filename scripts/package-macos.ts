import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { MACOS_ARM64_DMG_NAME, MACOS_X64_DMG_NAME } from '../packages/shared/src/updates'

if (process.platform !== 'darwin') throw new Error('macOS packages must be built on macOS')
if (process.arch !== 'arm64' && process.arch !== 'x64') throw new Error(`Unsupported architecture: ${process.arch}`)

const root = fileURLToPath(new URL('..', import.meta.url))
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }
const source = path.join(root, 'target', 'release', 'gdp')
const { stdout } = await execa(source, ['--version'])
if (stdout.trim() !== `gdp ${version}`) throw new Error('Release binary version does not match package.json')

const target = path.join(root, 'target', 'macos')
const staging = path.join(target, 'staging')
const releases = path.join(target, 'releases')
const appName = 'GitHub Desktop Plus.app'
const app = path.join(staging, appName)
const contents = path.join(app, 'Contents')
const resources = path.join(contents, 'Resources')
const executable = path.join(contents, 'MacOS', 'gdp')
const iconset = path.join(target, 'gdp.iconset')
const dmgName = process.arch === 'arm64' ? MACOS_ARM64_DMG_NAME : MACOS_X64_DMG_NAME
const zipName = `GitHubDesktopPlus-mac-${process.arch}.zip`

await rm(target, { recursive: true, force: true })
await mkdir(path.dirname(executable), { recursive: true })
await mkdir(resources, { recursive: true })
await mkdir(releases, { recursive: true })
await mkdir(iconset)
await copyFile(source, executable)
await chmod(executable, 0o755)
await copyFile(path.join(root, 'LICENSE'), path.join(resources, 'LICENSE.txt'))
await writeFile(path.join(contents, 'PkgInfo'), 'APPL????')
await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>io.github.sj817.github-desktop-plus</string>
  <key>CFBundleName</key><string>GitHub Desktop Plus</string>
  <key>CFBundleDisplayName</key><string>GitHub Desktop Plus</string>
  <key>CFBundleExecutable</key><string>gdp</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleIconFile</key><string>gdp.icns</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`)

for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    await execa('sips', ['-z', String(size * scale), String(size * scale),
      path.join(root, 'apps', 'gdp', 'assets', 'gdp-icon.png'),
      '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
    ])
  }
}
await execa('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'gdp.icns')])
await execa('plutil', ['-lint', path.join(contents, 'Info.plist')])

// Ad-hoc signatures allow local Apple Silicon execution. Distribution can use
// a Developer ID identity and notarize the resulting disk image separately.
const identity = process.env.GDP_MACOS_SIGN_IDENTITY ?? '-'
await execa('codesign', ['--force', '--sign', identity,
  ...(identity === '-' ? [] : ['--options', 'runtime', '--timestamp']), app,
])
await execa('codesign', ['--verify', '--strict', app])
await execa('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(releases, zipName)])
await symlink('/Applications', path.join(staging, 'Applications'))
await execa('hdiutil', ['create', '-volname', 'GitHub Desktop Plus', '-srcfolder', staging,
  '-format', 'UDZO', '-ov', path.join(releases, dmgName),
], { stdio: 'inherit' })

const checksums = await Promise.all([dmgName, zipName].map(async name => {
  const digest = createHash('sha256').update(await readFile(path.join(releases, name))).digest('hex')
  return `${digest}  ${name}`
}))
await writeFile(path.join(releases, `SHA256SUMS-mac-${process.arch}.txt`), checksums.join('\n') + '\n', 'ascii')
console.log(`[package:macos] ${app}`)
console.log(`[package:macos] ${path.join(releases, dmgName)}`)
console.log(`[package:macos] ${path.join(releases, zipName)}`)
