/**
 * #5 FEASIBILITY PROTOTYPE — repository list redesign (spike).
 *
 * Goal: prove the two load-bearing risks before building the full Windows-style
 * list (pin / favorites / color labels / collapsible groups):
 *   (a) read GD's FULL repository list from IndexedDB (not from the virtualized
 *       DOM, which only renders visible rows), and
 *   (b) drive selection of ANY repo — including ones not currently rendered in
 *       the virtual list — by operating the original (hidden-behind) list.
 *
 * GD's repo dropdown is react-virtualized; we cannot reach its Dispatcher from
 * here. So selection is driven by: type the repo name into the original filter
 * box (`input.filter-list-filter-field`) via the native setter + input event,
 * wait for the matching `.repository-list-item` row to render, then click it.
 *
 * This prototype renders a simple overlay panel on top of the open dropdown
 * (`.repository-list`); the original list stays mounted underneath so the
 * virtual list keeps rendering rows for us to click. It is intentionally
 * minimal — no pinning/labels yet, just enough to validate (a) + (b).
 */
import { readGdRepositories, getSelectedRepositoryId, GdRepository } from './lib/gd-db'

;(function () {
  const PANEL_ID = 'gdp-repo-proto-panel'

  function setNativeValue(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  function findFilterInput(root: ParentNode): HTMLInputElement | null {
    return root.querySelector<HTMLInputElement>('input.filter-list-filter-field')
  }

  /** Poll for the rendered repo row that matches `name`, up to `timeoutMs`. */
  async function waitForRow(
    root: ParentNode,
    name: string,
    timeoutMs = 2000
  ): Promise<HTMLElement | null> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const rows = Array.from(
        root.querySelectorAll<HTMLElement>('.repository-list-item')
      )
      const exact = rows.find(
        r => (r.querySelector('.name')?.textContent ?? r.textContent ?? '').trim() === name
      )
      if (exact) return exact
      if (rows.length === 1) return rows[0]
      await delay(60)
    }
    return null
  }

  /** Drive GD to select `repo` by operating the original (underlying) list. */
  async function selectRepo(repo: GdRepository, listRoot: ParentNode): Promise<boolean> {
    const input = findFilterInput(listRoot)
    if (!input) {
      console.warn('[GDP proto] original filter input not found')
      return false
    }
    setNativeValue(input, repo.name)
    const row = await waitForRow(listRoot, repo.name)
    if (!row) {
      console.warn(`[GDP proto] no row rendered for "${repo.name}"`)
      return false
    }
    // The click handler lives on the list row (role="option"); bubbling from the
    // content element reaches it.
    const target = row.closest<HTMLElement>('[role="option"], .list-item') ?? row
    target.click()
    return true
  }

  function groupByOwner(repos: GdRepository[]): Map<string, GdRepository[]> {
    const groups = new Map<string, GdRepository[]>()
    for (const r of repos) {
      const key = r.owner ?? 'Other'
      const arr = groups.get(key) ?? []
      arr.push(r)
      groups.set(key, arr)
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name))
    }
    return groups
  }

  async function buildPanel(listEl: HTMLElement): Promise<void> {
    if (document.getElementById(PANEL_ID)) return

    const repos = await readGdRepositories()
    const selectedId = getSelectedRepositoryId()

    // Position the overlay over the original list's box; keep the original
    // mounted (just behind) so its virtualized rows still render for driving.
    const rect = listEl.getBoundingClientRect()

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    Object.assign(panel.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      zIndex: '99998',
      overflowY: 'auto',
      background: 'var(--background-color, #22272e)',
      color: 'var(--text-color, #cdd9e5)',
      borderRight: '1px solid var(--box-border-color, #444c56)',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '6px 0',
    } as CSSStyleDeclaration)

    const header = document.createElement('div')
    header.textContent = `GDP 仓库原型 (实验) — ${repos.length} repos · IndexedDB`
    Object.assign(header.style, {
      padding: '4px 12px 8px',
      fontWeight: '600',
      opacity: '0.7',
      position: 'sticky',
      top: '0',
      background: 'inherit',
    } as CSSStyleDeclaration)
    panel.appendChild(header)

    if (repos.length === 0) {
      const empty = document.createElement('div')
      empty.textContent = '⚠️ 没读到仓库 — IndexedDB 读取可能失败（见 console）'
      empty.style.padding = '8px 12px'
      panel.appendChild(empty)
    }

    for (const [owner, list] of groupByOwner(repos)) {
      const groupHeader = document.createElement('div')
      groupHeader.textContent = owner
      Object.assign(groupHeader.style, {
        padding: '8px 12px 2px',
        fontWeight: '600',
        opacity: '0.55',
        textTransform: 'uppercase',
        fontSize: '10px',
      } as CSSStyleDeclaration)
      panel.appendChild(groupHeader)

      for (const repo of list) {
        const item = document.createElement('div')
        item.textContent = (repo.id === selectedId ? '● ' : '') + repo.name
        item.title = repo.path
        Object.assign(item.style, {
          padding: '5px 12px 5px 20px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: repo.id === selectedId ? '600' : '400',
        } as CSSStyleDeclaration)
        item.addEventListener('mouseenter', () => {
          item.style.background = 'var(--list-item-hover-background-color, #2d333b)'
        })
        item.addEventListener('mouseleave', () => {
          item.style.background = ''
        })
        item.addEventListener('click', () => {
          void selectRepo(repo, listEl).then(ok => {
            console.log(`[GDP proto] select "${repo.name}" → ${ok ? 'ok' : 'FAILED'}`)
          })
        })
        panel.appendChild(item)
      }
    }

    document.body.appendChild(panel)
    console.log(`[GDP proto] panel mounted with ${repos.length} repos from IndexedDB`)
  }

  function removePanel(): void {
    document.getElementById(PANEL_ID)?.remove()
  }

  // Watch for the repo dropdown opening/closing. `.repository-list` is the
  // foldout content container (GD repositories-list.tsx).
  const observer = new MutationObserver(() => {
    const listEl = document.querySelector<HTMLElement>('.repository-list')
    if (listEl) {
      if (!document.getElementById(PANEL_ID)) {
        void buildPanel(listEl)
      }
    } else {
      removePanel()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  console.log('[GDP proto] repo-list prototype active')
})()
