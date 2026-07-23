/**
 * Hides the "Filter Options" funnel button above GitHub Desktop's Changes
 * file list. The button is GD `changes-list-filter-options.tsx`
 * (`<Button className="filter-button">` with `octicons.filter`), wrapped in a
 * `<span>` inside `.filter-box-container` (GD `filter-changes-list.tsx:1290`).
 *
 * We hide it with a scoped <style> so it survives React re-renders. The
 * adjacent filter text box and "select all" checkbox are untouched. `:has`
 * also removes the wrapping <span> so no empty flex gap is left behind.
 */
;(function () {
  const STYLE_ID = 'gdp-hide-changes-filter'
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .filter-box-container > span:has(> .filter-button),
    .filter-box-container .filter-button { display: none !important; }
  `

  const attach = () => {
    if (document.getElementById(STYLE_ID)) return
    ;(document.head || document.documentElement).appendChild(style)
  }

  if (document.head) {
    attach()
  } else {
    document.addEventListener('DOMContentLoaded', attach, { once: true })
  }

  console.log('[GDP] Changes filter funnel hidden')
})()
