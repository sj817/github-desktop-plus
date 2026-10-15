import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import type { OpenWithLaunchRequest } from '@github-desktop-plus/shared'

test('file-row context reaches the launch IPC and native menu actions retain their indices', async () => {
  const window = new Window({ url: 'http://gdp.test/' })
  const document = window.document
  for (const [name, value] of Object.entries({ window, document, Element: window.Element, localStorage: window.localStorage })) {
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  Object.defineProperty(document, 'elementsFromPoint', { value: () => [] })
  const requests: OpenWithLaunchRequest[] = []
  let choose: (menu: Array<{ label?: string; submenu?: unknown[] }>) => number[] | null = () => null
  let shown: Array<{ label?: string }> = []
  let submenu = false
  const ipc = {
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      if (channel === 'gdp:get-config') return { open_with: { submenu, items: [
        { id: 'code', label: 'VS Code', path: 'C:\\Tools\\Code.exe', group: 'editor' },
        { id: 'wsl', label: 'WSL (Debian)', path: 'C:\\Windows\\System32\\wsl.exe', group: 'shell' },
      ] } }
      if (channel === 'gdp:open-with-launch') { requests.push(args[0] as OpenWithLaunchRequest); return { ok: true } }
      if (channel === 'show-contextual-menu') {
        shown = args[0] as typeof shown
        return choose(shown)
      }
      return true
    },
  }
  Object.defineProperty(globalThis, 'require', { configurable: true, value: () => ({ ipcRenderer: ipc }) })
  await import('../src/preload/open-with')
  await Promise.resolve()
  document.body.innerHTML = '<div class="file-list"><div class="list-item" tabindex="0"><div class="file"><span class="path">truncated…name.md</span></div></div></div>'
  const row = document.querySelector('.list-item')!
  const file = document.querySelector('.file')!
  const attachFiber = (relativePath: string) => Object.assign(file, { '__reactFiber$test': {
    memoizedProps: { children: 'host div' },
    return: { memoizedProps: { file: { path: relativePath } }, return: { memoizedProps: { repository: { path: 'D:\\项目 repo' } } } },
  } })
  const menu = [
    { label: 'Discard changes' },
    { label: 'Ignore folder (add to .gitignore)', submenu: [{ label: '/docs' }] },
    { label: 'Copy file path' },
    { label: 'Show in Explorer' },
    { label: 'Open in Zed' },
    { label: 'Open with default program' },
  ]
  const clickRow = () => document.querySelector('.path')!.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
  const selectLabel = (label: string) => { choose = items => [items.findIndex(item => item.label === label)] }
  try {
    attachFiber('docs/完整名称.md')
    clickRow()
    selectLabel('Open in VS Code')
    assert.equal(await ipc.invoke('show-contextual-menu', menu), null)
    assert.deepEqual(requests.pop(), { id: 'code', kind: 'file', repositoryPath: 'D:\\项目 repo', path: 'docs/完整名称.md' })

    attachFiber('src/current.ts')
    clickRow()
    selectLabel('Open in WSL (Debian)')
    await ipc.invoke('show-contextual-menu', menu)
    assert.equal(requests.pop()?.path, 'src/current.ts')

    clickRow()
    choose = items => [items.findIndex(item => item.label?.startsWith('Ignore folder')), 0]
    assert.deepEqual(await ipc.invoke('show-contextual-menu', menu), [1, 0])
    assert.equal(requests.length, 0)

    // Keyboard context menus need not emit another DOM contextmenu event.
    ;(row as unknown as HTMLElement).focus()
    attachFiber('src/keyboard.ts')
    selectLabel('Open in VS Code')
    await ipc.invoke('show-contextual-menu', menu)
    assert.equal(requests.pop()?.path, 'src/keyboard.ts')

    submenu = true
    clickRow()
    choose = () => null
    await ipc.invoke('show-contextual-menu', menu) // refresh cached configuration
    await Promise.resolve()
    clickRow()
    choose = items => [items.findIndex(item => item.label === 'Open with'), 1]
    await ipc.invoke('show-contextual-menu', menu)
    assert.equal(requests.pop()?.id, 'wsl')

    // Missing model data must never launch the last right-clicked file.
    document.body.innerHTML = '<div class="file-list"><div class="file">unknown</div></div>'
    document.querySelector('.file')!.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    choose = () => null
    await ipc.invoke('show-contextual-menu', menu)
    assert.equal(shown, menu)
    assert.equal(requests.length, 0)
  } finally { await window.happyDOM.close() }
})
