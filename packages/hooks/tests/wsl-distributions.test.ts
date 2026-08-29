import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decodeWslDistributionList,
  normalizeWslPathInput,
  toWslUncPath,
} from '../src/preload/wsl/distributions'

test('decodes the UTF-16LE output produced by wsl --list --quiet', () => {
  const output = Buffer.from('Ubuntu-24.04\r\nDebian\r\n', 'utf16le')
  assert.deepEqual(decodeWslDistributionList(output), ['Ubuntu-24.04', 'Debian'])
})

test('deduplicates and rejects malformed distribution names', () => {
  const output = Buffer.from('Ubuntu\nubuntu\ninvalid/name\n\n', 'utf8')
  assert.deepEqual(decodeWslDistributionList(output), ['Ubuntu'])
})

test('builds canonical wsl.localhost UNC paths', () => {
  assert.equal(
    toWslUncPath('Ubuntu-24.04', '/home/me/repo'),
    '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\repo',
  )
  assert.equal(toWslUncPath('Debian', '/'), '\\\\wsl.localhost\\Debian\\')
})

test('normalizes Linux and existing WSL paths without starting a distribution', () => {
  assert.equal(
    normalizeWslPathInput('/srv/repo', 'Debian'),
    '\\\\wsl.localhost\\Debian\\srv\\repo',
  )
  assert.equal(
    normalizeWslPathInput('\\\\wsl.localhost\\Debian\\srv\\repo', 'Ubuntu-24.04'),
    '\\\\wsl.localhost\\Ubuntu-24.04\\srv\\repo',
  )
  assert.equal(
    normalizeWslPathInput('\\\\wsl.localhost\\Debian/root/test', 'Ubuntu-24.04'),
    '\\\\wsl.localhost\\Ubuntu-24.04\\root\\test',
  )
  assert.equal(normalizeWslPathInput('~/repo', 'Ubuntu-24.04'), null)
  assert.equal(normalizeWslPathInput('D:\\Github', 'Ubuntu-24.04'), null)
})
