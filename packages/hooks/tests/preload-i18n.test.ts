import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { Window } from 'happy-dom'

const window = new Window()
const document = window.document
let observerTime = 0
class MeasuredMutationObserver extends window.MutationObserver {
  constructor(callback: ConstructorParameters<typeof window.MutationObserver>[0]) {
    super((records, observer) => {
      const start = performance.now()
      callback(records, observer)
      observerTime += performance.now() - start
    })
  }
}
for (const name of ['window', 'document', 'Node', 'Element', 'NodeFilter'] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === 'window' ? window : name === 'document' ? document : window[name],
  })
}
Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: MeasuredMutationObserver })
// The hook's contextual-menu bridge does not need an Electron process here.
Object.defineProperty(globalThis, 'require', { configurable: true, value: () => ({ ipcRenderer: { invoke: async () => undefined } }) })

const state = window as unknown as {
  __GDP_TRANSLATIONS__: Record<string, string>
  __GDP_OVERRIDES__: Record<string, { anchor: string; value: string }[]>
  __gdpTranslateTree: (node: unknown) => void
}
const translations = {
  Settings: '设置',
  Save: '保存',
  'Changed {{count}} files': '已更改 {{count}} 个文件',
}
state.__GDP_TRANSLATIONS__ = translations
state.__GDP_OVERRIDES__ = { Settings: [{ anchor: '.special', value: '特殊设置' }] }
document.body.innerHTML = '<button title="Save">Settings</button><pre>Settings</pre>'

// Override only for comparing a saved pre-change source in the same fixture.
await import(process.env.GDP_I18N_TEST_SOURCE ?? new URL('../src/preload/index.ts', import.meta.url).href)
await window.happyDOM.waitUntilComplete()

let failures = 0
async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL  ${name}`, error)
  }
}

await test('initial UI text and attributes translate while code stays unchanged', () => {
  assert.equal(document.querySelector('button')?.textContent, '设置')
  assert.equal(document.querySelector('button')?.getAttribute('title'), '保存')
  assert.equal(document.querySelector('pre')?.textContent, 'Settings')
})

await test('React additions, text updates, overrides and patterns translate', async () => {
  document.body.innerHTML = '<div class="special"><button>Settings</button></div>' +
    '<label title="Save"> Changed\n  12 files </label><p>Settings</p>'
  await window.happyDOM.waitUntilComplete()
  assert.equal(document.querySelector('button')?.textContent, '特殊设置')
  assert.equal(document.querySelector('label')?.textContent, ' 已更改 12 个文件 ')
  assert.equal(document.querySelector('label')?.getAttribute('title'), '保存')
  const text = document.querySelector('p')!.firstChild!
  text.textContent = 'Save'
  await window.happyDOM.waitUntilComplete()
  assert.equal(text.textContent, '保存')
})

await test('locale reload translates again from original sources', async () => {
  document.body.innerHTML = '<button title="Save">Settings</button>'
  await window.happyDOM.waitUntilComplete()
  state.__GDP_TRANSLATIONS__ = { Settings: 'Preferences', Save: 'Store' }
  state.__gdpTranslateTree(document.body)
  assert.equal(document.querySelector('button')?.textContent, 'Preferences')
  assert.equal(document.querySelector('button')?.getAttribute('title'), 'Store')
  state.__GDP_TRANSLATIONS__ = translations
  state.__gdpTranslateTree(document.body)
  await window.happyDOM.waitUntilComplete()
  assert.equal(document.querySelector('button')?.textContent, '设置')
  assert.equal(document.querySelector('button')?.getAttribute('title'), '保存')
})

await test('all code exclusions prune contents without excluding CodeMirror theme labels', async () => {
  document.body.innerHTML = '<div class="cm-s-default">Settings</div>' +
    '<div class="cm-keyword" title="Save">Settings</div>' +
    '<div class="CodeMirror-code"><span>Settings</span></div>' +
    '<div class="side-by-side-diff"><div class="content-wrapper">Settings</div></div>' +
    '<div id="gdp-settings-dialog">Settings</div><div data-gdp-no-translate>Settings</div>'
  await window.happyDOM.waitUntilComplete()
  assert.equal(document.querySelector('.cm-s-default')?.textContent, '设置')
  for (const selector of ['.cm-keyword', '.CodeMirror-code', '.content-wrapper', '#gdp-settings-dialog', '[data-gdp-no-translate]']) {
    assert.equal(document.querySelector(selector)?.textContent, 'Settings')
  }
  assert.equal(document.querySelector('.cm-keyword')?.getAttribute('title'), 'Save')
})

await test('moving already-translated UI into a new code subtree restores sources', async () => {
  document.body.innerHTML = '<button title="Save">Settings</button>'
  await window.happyDOM.waitUntilComplete()
  const button = document.querySelector('button')!
  const code = document.createElement('pre')
  const wrapper = document.createElement('div')
  wrapper.append(button)
  code.append(wrapper)
  document.body.append(code)
  await window.happyDOM.waitUntilComplete()
  assert.equal(button.textContent, 'Settings')
  assert.equal(button.title, 'Save')
  document.body.append(button)
  await window.happyDOM.waitUntilComplete()
  assert.equal(button.textContent, '设置')
  assert.equal(button.title, '保存')
})

await test('detached translated UI can later be restored inside code', async () => {
  document.body.innerHTML = '<button title="Save">Settings</button>'
  await window.happyDOM.waitUntilComplete()
  const button = document.querySelector('button')!
  button.remove()
  document.body.innerHTML = '<pre>unrelated code</pre>'
  await window.happyDOM.waitUntilComplete()
  document.querySelector('pre')!.append(button)
  await window.happyDOM.waitUntilComplete()
  assert.equal(button.textContent, 'Settings')
  assert.equal(button.title, 'Save')
})

await test('large highlighted diff does not walk its text or query its attributes', async () => {
  const view = document.createElement('main')
  view.innerHTML = '<button title="Save">Settings</button><div class="CodeMirror-code">' +
    '<div class="CodeMirror-line"><span class="cm-keyword">Settings</span><span title="Save">source text</span></div>'.repeat(5000) +
    '</div>'
  let walkedNodes = 0
  let subtreeQueries = 0
  const createTreeWalker = document.createTreeWalker.bind(document)
  document.createTreeWalker = (...args: Parameters<typeof document.createTreeWalker>) => {
    const walker = createTreeWalker(...args)
    const nextNode = walker.nextNode.bind(walker)
    walker.nextNode = () => {
      const node = nextNode()
      if (node !== null) walkedNodes++
      return node
    }
    return walker
  }
  const querySelectorAll = view.querySelectorAll.bind(view)
  view.querySelectorAll = ((...args: Parameters<typeof view.querySelectorAll>) => {
    subtreeQueries++
    return querySelectorAll(...args)
  }) as typeof view.querySelectorAll
  const start = performance.now()
  const initialObserverTime = observerTime
  try {
    document.body.replaceChildren(view)
    await window.happyDOM.waitUntilComplete()
    console.log(`    5,000-line diff: ${walkedNodes} walked nodes, ${subtreeQueries} subtree queries, ${(observerTime - initialObserverTime).toFixed(1)} ms observer / ${(performance.now() - start).toFixed(1)} ms fixture`)
    assert.equal(view.querySelector('button')?.textContent, '设置')
    assert.equal(view.querySelector('.cm-keyword')?.textContent, 'Settings')
    assert.equal(view.querySelector('.CodeMirror-line span[title]')?.getAttribute('title'), 'Save')
    assert.ok(walkedNodes < 20, `visited ${walkedNodes} nodes in excluded code`)
    assert.equal(subtreeQueries, 0)
  } finally {
    document.createTreeWalker = createTreeWalker
    view.querySelectorAll = querySelectorAll
  }
})

await test('continuous code-only updates do not rescan unchanged UI translations', async () => {
  document.body.innerHTML = '<aside>' + '<button>Settings</button>'.repeat(250) +
    '</aside><div class="CodeMirror-code"><div class="CodeMirror-line">Settings</div></div>'
  await window.happyDOM.waitUntilComplete()
  const code = document.querySelector('.CodeMirror-code')!
  let uiChecks = 0
  const matches = window.Element.prototype.matches
  window.Element.prototype.matches = function (selector: string) {
    if (this.tagName === 'BUTTON') uiChecks++
    return matches.call(this, selector)
  }
  const initialObserverTime = observerTime
  try {
    for (let i = 0; i < 100; i++) {
      code.innerHTML = `<div class="CodeMirror-line"><span class="cm-keyword">Settings</span><span>${i}</span></div>`
      await window.happyDOM.waitUntilComplete()
    }
    console.log(`    100 code-only updates, 250 translated labels: ${uiChecks} UI checks, ${(observerTime - initialObserverTime).toFixed(1)} ms observer (DOM fixture)`)
    assert.equal(uiChecks, 0)
    assert.equal(code.querySelector('.cm-keyword')?.textContent, 'Settings')
    assert.equal(document.querySelector('button')?.textContent, '设置')
  } finally {
    window.Element.prototype.matches = matches
  }
})

await window.happyDOM.close()
process.exitCode = failures === 0 ? 0 : 1
