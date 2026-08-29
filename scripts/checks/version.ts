import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface PackageManifest {
  name: string
  version: string
}

const root = fileURLToPath(new URL('../..', import.meta.url))
const manifestPaths = [
  'package.json',
  'apps/settings-ui/package.json',
  'packages/hooks/package.json',
  'packages/shared/package.json',
]

const manifests = await Promise.all(manifestPaths.map(async relativePath => {
  const content = await readFile(path.join(root, relativePath), 'utf8')
  return {
    relativePath,
    manifest: JSON.parse(content) as PackageManifest,
  }
}))

const expected = manifests[0]?.manifest.version
if (!expected) throw new Error('root package version is missing')

for (const { relativePath, manifest } of manifests) {
  if (manifest.version !== expected) {
    throw new Error(`${relativePath} has version ${manifest.version}; expected ${expected}`)
  }
}

const cargo = await readFile(path.join(root, 'Cargo.toml'), 'utf8')
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
if (cargoVersion !== expected) {
  throw new Error(`Cargo.toml has workspace version ${cargoVersion ?? 'missing'}; expected ${expected}`)
}

const releaseTag = process.argv[2]
if (releaseTag && releaseTag !== `v${expected}`) {
  throw new Error(`release tag ${releaseTag} does not match project version v${expected}`)
}

console.log(`[version] ${releaseTag ? `${releaseTag} matches` : 'all manifests match'} ${expected}`)
