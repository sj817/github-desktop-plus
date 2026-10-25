import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import { classifyInstalledApps, executableFromValue, readInstalledApps } from '../src/open-with'

test('installer, App Paths and shortcut values reduce to absolute executables', () => {
  assert.equal(executableFromValue('"D:\\Program Files\\Kiro\\Kiro.exe",0'), 'D:\\Program Files\\Kiro\\Kiro.exe')
  assert.equal(executableFromValue('C:\\Apps\\Zed\\Zed.exe'), 'C:\\Apps\\Zed\\Zed.exe')
  assert.equal(executableFromValue('C:\\Apps\\app.ico'), null)
  assert.equal(executableFromValue('Kiro.exe'), null)
  assert.equal(executableFromValue(''), null)
})

test('recognises VS Code forks, JetBrains IDEs and named editors installed anywhere', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gdp-installed-'))
  try {
    const file = async (relative: string, content = '') => {
      const full = path.join(root, relative)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, content)
      return full
    }
    const product = (nameShort: string, nameLong: string, applicationName: string) => JSON.stringify({ nameShort, nameLong, applicationName })
    const kiro = await file('Kiro/Kiro.exe')
    const kiroUninstaller = await file('Kiro/unins000.exe')
    await file('Kiro/resources/app/product.json', product('Kiro', 'Kiro', 'kiro'))
    const insiders = await file('Insiders/Code - Insiders.exe')
    // Newer VS Code builds keep the product files in a per-commit folder.
    const fork = await file('Fork/Fork Editor.exe')
    await file('Fork/0123456789/resources/app/product.json', product('Fork Editor', 'Fork Editor Studio', 'fork-editor'))
    await file('IDEA/bin/idea64.exe')
    await file('IDEA/product-info.json', JSON.stringify({ name: 'IntelliJ IDEA', launch: [{ launcherPath: 'bin/idea64.exe' }] }))
    await file('Typora/Typora.exe')
    const electron = await file('Other/Other.exe')
    await file('Other/resources/app.asar')

    const found = await classifyInstalledApps([
      { name: 'Kiro (User)', exe: `"${kiro}",0` },
      { exe: kiroUninstaller },
      { exe: insiders },
      { name: 'Fork', exe: fork },
      { name: 'IntelliJ IDEA 2024.1.1', exe: '', dir: path.join(root, 'IDEA') + path.sep },
      { name: 'Typora', dir: `"${path.join(root, 'Typora')}"` },
      { exe: electron },
      { exe: path.join(root, 'Uninstalled', 'Cursor.exe') },
    ])

    const byId = new Map(found.map(item => [item.id, item]))
    assert.deepEqual([...byId.keys()].sort(), ['fork-editor', 'jetbrains-intellij-idea', 'kiro', 'typora', 'vscode-insiders'])
    assert.equal(byId.get('kiro')?.path, kiro)
    assert.equal(byId.get('vscode-insiders')?.path, insiders)
    assert.equal(byId.get('fork-editor')?.label, 'Fork Editor Studio')
    assert.equal(byId.get('jetbrains-intellij-idea')?.label, 'IntelliJ IDEA')
    assert.equal(byId.get('jetbrains-intellij-idea')?.path, path.join(root, 'IDEA', 'bin', 'idea64.exe'))
    assert.equal(byId.get('typora')?.path, path.join(root, 'Typora', 'Typora.exe'))
    for (const item of found) {
      assert.equal(item.group, 'editor')
      assert.equal(item.args, '"%TARGET_PATH%"')
      assert.equal(item.console, false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reads installed applications from the registry and shortcuts', { skip: process.platform !== 'win32' }, async () => {
  const apps = await readInstalledApps()
  assert.ok(apps.some(app => typeof app.exe === 'string' && /\.exe/i.test(app.exe)), 'at least one executable is listed')
})
