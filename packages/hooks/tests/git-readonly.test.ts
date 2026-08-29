import assert from 'node:assert/strict'
import { buildReadOnlyGitOptions } from '../src/ipc'

const baseEnv: NodeJS.ProcessEnv = {
  PATH: 'test-path',
  GIT_OPTIONAL_LOCKS: '1',
}
const options = buildReadOnlyGitOptions('D:\\repo', 1234, baseEnv)

assert.equal(options.cwd, 'D:\\repo')
assert.equal(options.timeout, 1234)
assert.equal(options.windowsHide, true)
assert.equal(options.env?.PATH, 'test-path')
assert.equal(options.env?.GIT_OPTIONAL_LOCKS, '0')
assert.equal(baseEnv.GIT_OPTIONAL_LOCKS, '1', 'the caller environment must not be mutated')

console.log('all read-only git tests passed')
