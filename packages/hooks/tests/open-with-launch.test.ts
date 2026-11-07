import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import { buildOpenWithCommand, isAppLink, launchOpenWith, resolveItemTarget, resolveOpenWithTarget, terminalScript, type OpenWithItem } from '../src/open-with'

const editor: OpenWithItem = { id: 'code', label: 'Code', path: 'C:\\Tools\\Code.exe', args: '"%TARGET_PATH%"', group: 'editor', console: false, enabled: true }
const shell: OpenWithItem = { ...editor, id: 'ps', path: 'C:\\Tools\\pwsh.exe', args: '', group: 'shell', console: true }

test('macOS applications receive native file events and terminals open the containing directory', () => {
  const file = "/Users/me/中文 & repo%/src/it's a file.ts"
  const app = { ...editor, path: '/Applications/Visual Studio Code.app' }
  const edit = buildOpenWithCommand(app, file, 'file', 'darwin')
  assert.equal(edit.command, '/usr/bin/open')
  assert.deepEqual(edit.args, ['-a', app.path, file])
  const terminal = { ...shell, path: '/System/Applications/Utilities/Terminal.app' }
  assert.deepEqual(buildOpenWithCommand(terminal, file, 'file', 'darwin').args,
    ['-a', terminal.path, '/Users/me/中文 & repo%/src'])
  assert.deepEqual(buildOpenWithCommand(terminal, '/Users/me/repo', 'repository', 'darwin').args,
    ['-a', terminal.path, '/Users/me/repo'])
  assert.deepEqual(buildOpenWithCommand({ ...app, args: '--new-window "%TARGET_PATH%"' }, file, 'file', 'darwin').args,
    ['-a', app.path, '--args', '--new-window', file])
})

test('resolves file models under Windows, WSL UNC and POSIX repositories and rejects escaping paths', () => {
  assert.deepEqual(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: 'D:\\项目 repo', path: 'docs/说明.md' }), { kind: 'file', path: 'D:\\项目 repo\\docs\\说明.md' })
  assert.deepEqual(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: '\\\\wsl.localhost\\Debian\\home\\me\\repo', path: 'src/main.ts' }), { kind: 'file', path: '\\\\wsl.localhost\\Debian\\home\\me\\repo\\src\\main.ts' })
  assert.deepEqual(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: '/home/me/repo', path: 'src/main.ts' }), { kind: 'file', path: '/home/me/repo/src/main.ts' })
  for (const file of ['../outside', '..\\outside', 'D:\\outside', '\\\\server\\share\\file', '']) {
    assert.equal(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: 'C:\\repo', path: file }), null)
  }
  assert.equal(resolveOpenWithTarget({ id: 'code', kind: 'file', repositoryPath: 'relative', path: 'file' }), null)
})

/** The command line cmd.exe hands to `start` for a console program. */
const startLine = (launch: ReturnType<typeof buildOpenWithCommand>) => {
  assert.equal(launch.command, process.env.ComSpec || 'cmd.exe')
  assert.deepEqual(launch.args.slice(0, 4), ['/d', '/v:off', '/s', '/c'])
  return launch.args[4] ?? ''
}

test('editors receive the file while terminals receive its parent, keeping executable argv separate', () => {
  const file = 'D:\\中文 & repo%\\src\\a & b%.ts'
  const edit = buildOpenWithCommand(editor, file, 'file', 'win32')
  assert.deepEqual(edit.args, [file])
  assert.equal(edit.command, editor.path)
  const gui = { ...shell, path: 'C:\\Tools\\wt.exe', console: false }
  const terminal = buildOpenWithCommand(gui, file, 'file', 'win32')
  assert.equal(terminal.command, gui.path)
  assert.equal(terminal.options.cwd, 'D:\\中文 & repo%\\src')
  assert.equal(terminal.options.windowsHide, false)
  assert.deepEqual(terminal.args, [])
  assert.equal(buildOpenWithCommand(gui, 'D:\\repo', 'repository', 'win32').options.cwd, 'D:\\repo')
  assert.deepEqual(buildOpenWithCommand({ ...gui, args: '-d "%TARGET_PATH%"' }, file, 'file', 'win32').args, ['-d', 'D:\\中文 & repo%\\src'])
})

test('console programs get a console of their own through start, never a NUL stdin', () => {
  // Spawned directly with `detached`, a console program gets no console and
  // an interactive shell or CLI exits immediately.
  const terminal = buildOpenWithCommand(shell, 'D:\\中文 & repo\\src\\a & b.ts', 'file', 'win32')
  assert.equal(startLine(terminal), 'start "Code" /D "D:\\中文 & repo\\src" "C:\\Tools\\pwsh.exe"')
  assert.equal(terminal.options.windowsVerbatimArguments, true)
  const cli = { ...shell, id: 'claude', label: 'Claude Code CLI', path: 'C:\\Users\\me\\.local\\bin\\claude.exe', group: 'agent' as const }
  assert.equal(startLine(buildOpenWithCommand(cli, 'D:\\repo', 'repository', 'win32')),
    'start "Claude Code CLI" /D "D:\\repo" "C:\\Users\\me\\.local\\bin\\claude.exe"')
  const shim = { ...cli, path: 'D:\\Program Files\\nodeJS\\claude.cmd', console: false }
  assert.equal(startLine(buildOpenWithCommand(shim, 'D:\\repo', 'repository', 'win32')),
    'start "Claude Code CLI" /D "D:\\repo" "D:\\Program Files\\nodeJS\\claude.cmd"')
  // cmd expands %…% even inside quotes, so such folders are refused outright.
  assert.throws(() => buildOpenWithCommand(cli, 'D:\\100%\\repo', 'repository', 'win32'), /%/)
})

test('agents open the repository, including from a file menu', () => {
  const agent: OpenWithItem = { ...editor, id: 'codex', path: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\chatgpt-desktop.exe', args: '--open-project "%TARGET_PATH%"', group: 'agent' }
  const fromFile = resolveItemTarget(agent, { id: 'codex', kind: 'file', repositoryPath: 'D:\\项目 repo', path: 'src/main.ts' })
  assert.deepEqual(fromFile, { kind: 'repository', path: 'D:\\项目 repo' })
  const launch = buildOpenWithCommand(agent, fromFile!.path, fromFile!.kind, 'win32')
  assert.deepEqual(launch.args, ['--open-project', 'D:\\项目 repo'])
  assert.equal(launch.options.cwd, 'D:\\项目 repo')
  // Editors keep opening the file itself.
  assert.deepEqual(resolveItemTarget(editor, { id: 'code', kind: 'file', repositoryPath: 'D:\\项目 repo', path: 'src/main.ts' }),
    { kind: 'file', path: 'D:\\项目 repo\\src\\main.ts' })
})

test('app links get the target URL-encoded and are handed to the system, not cmd', () => {
  const desktop: OpenWithItem = { ...editor, id: 'claude-desktop', path: 'claude://code/new?folder=%TARGET_PATH%', args: '', group: 'agent' }
  const url = 'claude://code/new?folder=D%3A%5C%E4%B8%AD%E6%96%87%20%26%20repo%25'
  const win = buildOpenWithCommand(desktop, 'D:\\中文 & repo%', 'repository', 'win32')
  assert.match(win.command, /rundll32\.exe$/i)
  assert.deepEqual(win.args, ['url.dll,FileProtocolHandler', url])
  assert.deepEqual(buildOpenWithCommand(desktop, '/Users/me/repo', 'repository', 'darwin').args,
    ['claude://code/new?folder=%2FUsers%2Fme%2Frepo'])
  assert.ok(isAppLink('codex://threads/new?path=x'))
  for (const notLink of ['C://Tools/x.exe', 'C:\\Tools\\x.exe', '\\\\server\\share\\x.exe', '/usr/bin/claude']) assert.ok(!isAppLink(notLink), notLink)
})

test('macOS runs command-line agents in a Terminal window at the repository', () => {
  const cli: OpenWithItem = { ...shell, label: 'Claude Code CLI', path: '/Users/me/.local/bin/claude', group: 'agent' }
  const launch = buildOpenWithCommand(cli, "/Users/me/it's \"repo\"", 'repository', 'darwin')
  assert.equal(launch.command, '/usr/bin/osascript')
  assert.deepEqual(launch.args, terminalScript("/Users/me/it's \"repo\"", ['/Users/me/.local/bin/claude']))
  assert.equal(launch.args[1], `tell application "Terminal" to do script "cd '/Users/me/it'\\\\''s \\"repo\\"' && exec '/Users/me/.local/bin/claude'"`)
})

test('GUI editors are not started hidden; only unrequested console programs are', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gdp-open-with-pe-'))
  try {
    const writePe = async (name: string, subsystem: number) => {
      const image = Buffer.alloc(0x200)
      image.write('MZ', 0, 'latin1')
      image.writeUInt32LE(0x80, 0x3c)
      image.write('PE\0\0', 0x80, 'latin1')
      image.writeUInt16LE(subsystem, 0x80 + 24 + 68)
      const file = path.join(directory, name)
      await writeFile(file, image)
      return file
    }
    const gui = await writePe('gui.exe', 2)
    const cui = await writePe('cui.exe', 3)
    assert.equal(buildOpenWithCommand({ ...editor, path: gui }, 'D:\\repo', 'repository', 'win32').options.windowsHide, false)
    assert.equal(buildOpenWithCommand({ ...editor, path: cui }, 'D:\\repo', 'repository', 'win32').options.windowsHide, true)
    // Asked-for console programs go through `start`, which shows their window.
    assert.match(startLine(buildOpenWithCommand({ ...editor, path: cui, console: true }, 'D:\\repo', 'repository', 'win32')), /cui\.exe" "D:\\repo"$/)
    assert.equal(buildOpenWithCommand(editor, 'D:\\repo', 'repository', 'win32').options.windowsHide, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('WSL terminals translate same-distro UNC directories and never use a file as --cd', () => {
  const wsl = { ...shell, path: 'C:\\Windows\\System32\\wsl.exe', args: '-d Debian --cd "%TARGET_PATH%"' }
  const file = '\\\\wsl.localhost\\Debian\\home\\me\\repo\\源文件\\file.ts'
  // A console cannot start in a UNC folder: start from home, cd inside WSL.
  assert.equal(startLine(buildOpenWithCommand(wsl, file, 'file', 'win32')),
    `start "Code" /D "${os.homedir()}" "C:\\Windows\\System32\\wsl.exe" "-d" "Debian" "--cd" "/home/me/repo/源文件"`)
  assert.throws(() => buildOpenWithCommand({ ...wsl, args: '-d Ubuntu --cd "%TARGET_PATH%"' }, file, 'file', 'win32'), /Debian/)
  assert.equal(startLine(buildOpenWithCommand(wsl, 'D:\\repo\\src\\file.ts', 'file', 'win32')),
    'start "Code" /D "D:\\repo\\src" "C:\\Windows\\System32\\wsl.exe" "-d" "Debian" "--cd" "D:\\repo\\src"')
  assert.match(startLine(buildOpenWithCommand({ ...wsl, args: '' }, file, 'file', 'win32')),
    /wsl\.exe" "--cd" "\/home\/me\/repo\/源文件" "-d" "Debian"$/)
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
    for (const group of ['editor', 'shell'] as const) {
      const output = path.join(directory, `${group}.json`)
      const item = { ...editor, path: process.execPath, args: `"${helper}" "${output}" "%TARGET_PATH%"`, group, console: false }
      assert.equal((await launchOpenWith(item, target, 'file')).ok, true)
      let result: { cwd: string; args: string[] } | undefined
      for (let attempt = 0; attempt < 100; attempt++) {
        try { result = JSON.parse(await readFile(output, 'utf8')); break } catch { await setTimeout(20) }
      }
      assert.ok(result, `launcher ${group} completed`)
      assert.deepEqual(result.args, [group === 'editor' ? target : workdir])
      if (group === 'shell') assert.equal(await realpath(result.cwd), await realpath(workdir))
    }
  } finally {
    // The detached helper can briefly hold its cwd after writing the result.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
