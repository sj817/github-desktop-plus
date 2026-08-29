import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { execa } from 'execa'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

function rustTarget(): string {
  return process.arch === 'arm64'
    ? 'aarch64-unknown-linux-gnu'
    : 'x86_64-unknown-linux-gnu'
}

async function latestMtime(input: string): Promise<number> {
  const metadata = await stat(input)
  if (!metadata.isDirectory()) return metadata.mtimeMs

  const children = await readdir(input)
  const mtimes = await Promise.all(children.map(child => latestMtime(path.join(input, child))))
  return Math.max(metadata.mtimeMs, ...mtimes)
}

async function needsBuild(artifact: string): Promise<boolean> {
  let artifactMtime: number
  try {
    artifactMtime = (await stat(artifact)).mtimeMs
  } catch {
    return true
  }

  const sourceMtime = Math.max(...await Promise.all([
    latestMtime(path.join(rootDir, 'Cargo.lock')),
    latestMtime(path.join(rootDir, 'Cargo.toml')),
    latestMtime(path.join(rootDir, 'crates', 'wsl-agent')),
  ]))
  return artifactMtime < sourceMtime
}

async function toWslPath(wsl: string, windowsPath: string): Promise<string> {
  const result = await execa(wsl, ['--exec', 'wslpath', '-u', windowsPath])
  return result.stdout.trim()
}

async function wslHome(wsl: string): Promise<string> {
  const result = await execa(wsl, ['--exec', 'printenv', 'HOME'])
  const home = result.stdout.trim()
  if (!home.startsWith('/')) throw new Error(`WSL returned an invalid HOME: ${home}`)
  return home
}

export async function ensureWslAgent(force = false): Promise<string> {
  const target = rustTarget()
  const targetDir = path.join(rootDir, 'target', 'wsl-agent')
  const artifact = path.join(targetDir, target, 'release', 'gdp-wsl-agent')
  if (!force && !await needsBuild(artifact)) {
    console.log(`[wsl-agent] current: ${path.relative(rootDir, artifact)}`)
    return artifact
  }

  console.log(`[wsl-agent] building ${target}`)
  if (process.platform === 'win32') {
    const wsl = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'wsl.exe')
      : 'wsl.exe'
    const [linuxRoot, linuxTargetDir, home] = await Promise.all([
      toWslPath(wsl, rootDir),
      toWslPath(wsl, targetDir),
      wslHome(wsl),
    ])
    await execa(wsl, [
      '--cd', linuxRoot,
      '--exec', 'env', `CARGO_TARGET_DIR=${linuxTargetDir}`,
      `${home}/.cargo/bin/cargo`,
      'build', '--release', '--target', target, '-p', 'gdp-wsl-agent',
    ], { stdio: 'inherit' })
  } else {
    await execa('cargo', [
      'build', '--release', '--target', target, '-p', 'gdp-wsl-agent',
    ], {
      cwd: rootDir,
      env: { CARGO_TARGET_DIR: targetDir },
      stdio: 'inherit',
    })
  }
  return artifact
}
