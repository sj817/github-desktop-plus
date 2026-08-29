import * as path from 'node:path'

import { parseWslRepositoryPath } from './path'

const childProcess = process.getBuiltinModule('node:child_process')

function wslExecutable(): string {
  const systemRoot = process.env.SystemRoot
  return systemRoot ? path.join(systemRoot, 'System32', 'wsl.exe') : 'wsl.exe'
}

function execWsl(args: readonly string[], timeout = 8_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      wslExecutable(),
      [...args],
      { encoding: 'buffer', timeout, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout),
    )
  })
}

export function decodeWslDistributionList(output: Buffer): string[] {
  const decoded = output.includes(0)
    ? output.toString('utf16le')
    : output.toString('utf8')
  const seen = new Set<string>()
  const distributions: string[] = []
  for (const line of decoded.split(/\r?\n/)) {
    const name = line.replaceAll('\0', '').trim()
    const key = name.toLowerCase()
    if (name === '' || name.includes('\\') || name.includes('/') || seen.has(key)) continue
    seen.add(key)
    distributions.push(name)
  }
  return distributions
}

export async function listWslDistributions(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    return decodeWslDistributionList(await execWsl(['--list', '--quiet'], 5_000))
  } catch {
    return []
  }
}

export function toWslUncPath(distro: string, linuxPath: string): string {
  const normalized = path.posix.normalize(linuxPath.replaceAll('\\', '/'))
  if (!normalized.startsWith('/')) {
    throw new Error(`Expected an absolute Linux path, got: ${linuxPath}`)
  }
  const suffix = normalized === '/' ? '\\' : normalized.replaceAll('/', '\\')
  return `\\\\wsl.localhost\\${distro}${suffix}`
}

export function normalizeWslPathInput(
  input: string,
  distro: string,
): string | null {
  const value = input.trim()
  const existing = parseWslRepositoryPath(value)
  if (existing) return toWslUncPath(distro, existing.linuxPath)
  if (value.startsWith('/')) return toWslUncPath(distro, value)
  return null
}
