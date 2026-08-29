import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isGitExecutable,
  parseWslRepositoryPath,
  portableGitEnvironment,
  translateGitArgument,
} from '../src/preload/wsl/path'

test('parses modern, legacy, and extended WSL UNC paths', () => {
  assert.deepEqual(parseWslRepositoryPath('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\repo'), {
    distro: 'Ubuntu-24.04',
    linuxPath: '/home/me/repo',
  })
  assert.deepEqual(parseWslRepositoryPath('\\\\wsl$\\Debian\\srv\\repo'), {
    distro: 'Debian',
    linuxPath: '/srv/repo',
  })
  assert.deepEqual(parseWslRepositoryPath('\\\\?\\UNC\\wsl.localhost\\Ubuntu-24.04\\'), {
    distro: 'Ubuntu-24.04',
    linuxPath: '/',
  })
  assert.deepEqual(parseWslRepositoryPath('\\\\wsl.localhost\\Ubuntu-24.04/root/test'), {
    distro: 'Ubuntu-24.04',
    linuxPath: '/root/test',
  })
  assert.equal(parseWslRepositoryPath('D:\\Github\\repo'), null)
})

test('translates Git path arguments without touching refs or relative paths', () => {
  assert.equal(
    translateGitArgument('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\repo', 'Ubuntu-24.04'),
    '/home/me/repo',
  )
  assert.equal(translateGitArgument('C:\\Temp\\message.txt', 'Ubuntu-24.04'), '/mnt/c/Temp/message.txt')
  assert.equal(
    translateGitArgument('--git-dir=C:\\Temp\\repo.git', 'Ubuntu-24.04'),
    '--git-dir=/mnt/c/Temp/repo.git',
  )
  assert.equal(translateGitArgument('origin/main', 'Ubuntu-24.04'), 'origin/main')
})

test('passes portable Git variables but strips Windows tool paths', () => {
  assert.deepEqual(portableGitEnvironment({
    PATH: 'C:\\Windows',
    GIT_EXEC_PATH: 'C:\\git-core',
    GIT_ASKPASS: 'C:\\askpass.exe',
    GIT_CONFIG_PARAMETERS: "'credential.helper=' 'credential.helper=desktop'",
    GIT_REFLOG_ACTION: 'desktop commit',
    GIT_INDEX_FILE: 'C:\\Temp\\index',
  }, 'Ubuntu-24.04'), {
    GIT_TERMINAL_PROMPT: '0',
    GIT_REFLOG_ACTION: 'desktop commit',
    GIT_INDEX_FILE: '/mnt/c/Temp/index',
  })
})

test('recognizes Git executables only', () => {
  assert.equal(isGitExecutable('git'), true)
  assert.equal(isGitExecutable('C:\\Git\\cmd\\git.exe'), true)
  assert.equal(isGitExecutable('git-lfs.exe'), false)
})
