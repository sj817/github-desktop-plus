import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import { buildOpenWithCommand, launchOpenWith, resolveOpenWithTarget, type OpenWithItem } from '../src/open-with'

const editor: OpenWithItem = { id: 'code', label: 'Code', path: 'C:\\Tools\\Code.exe', args: '"%TARGET_PATH%"', group: 'editor', console: false, enabled: true }
const shell: OpenWithItem = { ...editor, id: 'ps', path: 'C:\\Tools\\pwsh.exe', args: '', group: 'shell', console: true }

test('resolves file models under Windows, WSL UNC and POSIX repositories and rejects escaping paths', () => {
  assert.deepEqual(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: 'D:\\项目 repo', path: 'docs/说明.md' }), { kind: 'file', path: 'D:\\项目 repo\\docs\\说明.md' })
  assert.deepEqual(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: '\\\\wsl.localhost\\Debian\\home\\me\\repo', path: 'src/main.ts' }), { kind: 'file', path: '\\\\wsl.localhost\\Debian\\home\\me\\repo\\src\\main.ts' })
  assert.deepEqual(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: '/home/me/repo', path: 'src/main.ts' }), { kind: 'file', path: '/home/me/repo/src/main.ts' })
  for (const file of ['../outside', '..\\outside', 'D:\\outside', '\\\\server\\share\\file', '']) {
    assert.equal(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: 'C:\\repo', path: file }), null)
  }
  assert.equal(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: 'relative', path: 'file' }), null)
})

test('editors receive the file while terminals receive its parent, keeping executable argv separate', () => {
  const file = 'D:\\中文 & repo%\\src\\a & b%.ts'
  const edit = buildOpenWithCommand(editor, file, 'file', 'win32')
  assert.deepEqual(edit.args, [file])
  assert.equal(edit.command, editor.path)
  const terminal = buildOpenWithCommand(shell, file, 'file', 'win32')
  assert.equal(terminal.command, shell.path)
  assert.equal(terminal.options.cwd, 'D:\\中文 & repo%\\src')
  assert.equal(terminal.options.windowsHide, false)
  assert.deepEqual(terminal.args, [])
  assert.equal(buildOpenWithCommand(shell, 'D:\\repo', 'repository', 'win32').options.cwd, 'D:\\repo')
  assert.deepEqual(buildOpenWithCommand({ ...shell, args: '-d "%TARGET_PATH%"' }, file, 'file', 'win32').args, ['-d', 'D:\\中文 & repo%\\src'])
})

test('WSL terminals translate same-distro UNC directories and never use a file as --cd', () => {
  const wsl = { ...shell, path: 'C:\\Windows\\System32\\wsl.exe', args: '-d Debian --cd "%TARGET_PATH%"' }
  const file = '\\\\wsl.localhost\\Debian\\home\\me\\repo\\源文件\\file.ts'
  const launch = buildOpenWithCommand(wsl, file, 'file', 'win32')
  assert.deepEqual(launch.args, ['-d', 'Debian', '--cd', '/home/me/repo/源文件'])
  assert.ok(!launch.options.cwd?.toString().startsWith('\\\\wsl'))
  assert.throws(() => buildOpenWithCommand({ ...wsl, args: '-d Ubuntu --cd "%TARGET_PATH%"' }, file, 'file', 'win32'), /Debian/)
  assert.deepEqual(buildOpenWithCommand(wsl, 'D:\\repo\\src\\file.ts', 'file', 'win32').args, ['-d', 'Debian', '--cd', 'D:\\repo\\src'])
  assert.deepEqual(buildOpenWithCommand({ ...wsl, args: '' }, file, 'file', 'win32').args, ['--cd', '/home/me/repo/源文件', '-d', 'Debian'])
})

test('the real launcher preserves Unicode, spaces, percent signs and shell metacharacters', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gdp-open-with-'))
  try {
    const workdir = path.join(directory, '中文 & repo%')
    await mkdir(workdir)
    const helper = path.join(directory, 'record.ts')
    await writeFile(helper, 'import { writeFileSync } from "node:fs"\nwriteFileSync(process.argv[2], JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(3) }))\n')
    const target = path.join(workdir, 'a & b%.ts')
    await writeFile(target, 'test')
    for (const group of ['editor', 'shell']) {
      const output = path.join(directory, `${group}.json`)
      const item = { ...editor, path: process.execPath, args: `"${helper}" "${output}" "%TARGET_PATH%"`, group, console: false }
      assert.equal((await launchOpenWith(item, target, 'file')).ok, true)
      let result: { cwd: string; args: string[] } | undefined
      for (let attempt = 0; attempt < 100; attempt++) {
        try { result = JSON.parse(await readFile(output, 'utf8')); break } catch { await setTimeout(20) }
      }
      assert.ok(result, `launcher ${group} completed`)
      assert.deepEqual(result.args, [group === 'editor' ? target : workdir])
      if (group === 'shell') assert.equal(result.cwd, workdir)
    }
  } finally {
    // The detached helper can briefly hold its cwd after writing the result.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
