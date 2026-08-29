import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  renderManagedGitConfig,
  windowsPathToWsl,
} from '../src/preload/wsl/git-config'

test('translates Windows executables to WSL interop paths', () => {
  assert.equal(
    windowsPathToWsl('D:\\Program Files\\Git\\mingw64\\bin\\git-credential-manager.exe'),
    '/mnt/d/Program Files/Git/mingw64/bin/git-credential-manager.exe',
  )
  assert.equal(windowsPathToWsl('/usr/bin/gpg'), null)
})

test('renders only portable identity, signing, and credential bridge settings', () => {
  const rendered = renderManagedGitConfig({
    userName: 'GDP Test',
    userEmail: 'gdp@example.test',
    signingKey: '0123456789ABCDEF',
    commitGpgSign: 'true',
    tagGpgSign: 'true',
    gpgProgram: '/mnt/c/Program Files/GnuPG/bin/gpg.exe',
    credentialHelper: '/mnt/d/Program Files/Git/mingw64/bin/git-credential-manager.exe',
  })
  assert.match(rendered, /\[user\]/)
  assert.match(rendered, /signingKey = "0123456789ABCDEF"/)
  assert.ok(rendered.includes(
    '[credential]\n' +
    '\thelper =\n' +
    '\thelper = "/mnt/d/Program\\\\ Files/Git/mingw64/bin/git-credential-manager.exe"\n',
  ))
  assert.doesNotMatch(rendered, /core\.autocrlf|GIT_ASKPASS|password|token/i)
})
