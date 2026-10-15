import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'

test('official update blocking leaves Plus settings clicks and other dialogs untouched', async () => {
  const window = new Window({ url: 'http://gdp.test/' })
  const document = window.document
  for (const name of ['window', 'document', 'Element', 'HTMLButtonElement', 'MutationObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : name === 'document' ? document : window[name] })
  }
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: window.getComputedStyle.bind(window) })
  const state = window as unknown as {
    __GDP_CONFIG__: { blockManualUpdateCheck: boolean }
    __GDP_UPDATE_INTERCEPTOR_STATE__: { interceptions?: string[] }
  }
  state.__GDP_CONFIG__ = { blockManualUpdateCheck: true }
  document.body.innerHTML = `
    <dialog id="gdp-settings-dialog" open><div id="gdp-settings-root">
      <button id="plus-check"><svg><path id="plus-icon" /></svg>检查更新</button>
      <button id="plus-install">安装更新</button>
    </div></dialog>
    <dialog id="about" open><div class="dialog-content"><button id="official-check">Check for Updates</button></div>
      <div class="dialog-footer"><button id="official-close">Close</button></div>
    </dialog>
    <dialog id="other-dialog" open><button id="other-check">Check for Updates</button></dialog>
  `
  const calls = new Map<string, number>()
  for (const button of document.querySelectorAll('button')) button.addEventListener('click', () => calls.set(button.id, (calls.get(button.id) ?? 0) + 1))
  const click = (id: string) => document.getElementById(id)!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  const modal = () => document.querySelector('#gdp-update-modal-dialog')
  const closeWarning = () => { assert.ok(modal()); click('gdp-modal-cancel'); assert.equal(modal(), null) }
  try {
    await import('../src/preload/update-interceptor')

    // Same labels and nested SVG target as the real Plus updates page.
    assert.equal(click('plus-icon'), true)
    assert.equal(calls.get('plus-check'), 1)
    assert.equal(modal(), null)
    document.getElementById('plus-check')!.textContent = 'Check for Updates'
    assert.equal(click('plus-check'), true)
    document.getElementById('plus-install')!.textContent = 'Quit and Install Update'
    assert.equal(click('plus-install'), true)
    assert.equal(click('other-check'), true)
    assert.equal(state.__GDP_UPDATE_INTERCEPTOR_STATE__.interceptions?.length, 0)

    const official = document.getElementById('official-check')!
    for (const label of ['Check for Updates', '检查更新', 'Quit and Install Update', '退出并安装更新', 'A localized update action']) {
      official.textContent = label
      assert.equal(click('official-check'), false)
      assert.equal(calls.get('official-check'), undefined)
      closeWarning()
    }
    assert.equal(click('official-close'), true)
    assert.equal(modal(), null)

    // The official opt-out remains live; Plus checks work with either flag.
    state.__GDP_CONFIG__.blockManualUpdateCheck = false
    assert.equal(click('official-check'), true)
    assert.equal(calls.get('official-check'), 1)
    assert.equal(click('plus-check'), true)
    assert.equal(calls.get('plus-check'), 3)
    assert.equal(modal(), null)
    state.__GDP_CONFIG__.blockManualUpdateCheck = true
    assert.equal(click('official-check'), false)
    assert.equal(calls.get('official-check'), 1)
    closeWarning()
  } finally { await window.happyDOM.close() }
})
