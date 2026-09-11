/**
 * Does any of these mutations land inside (or introduce) an element matching
 * `selector`?
 *
 * Every renderer hook that decorates one specific piece of GitHub Desktop's UI
 * observes the whole document, and those observers all fire for the same DOM
 * churn — diff rows, commit lists, file lists — that has nothing to do with
 * them. So the common case is answered with one `querySelectorAll` per batch
 * and a `contains` per record, rather than a `closest` per record plus a
 * `querySelector` over every inserted subtree.
 */
export function mutationsTouchSelector(
  mutations: readonly MutationRecord[],
  selector: string,
): boolean {
  const scopes = document.querySelectorAll(selector)
  if (scopes.length === 0) return false

  for (const mutation of mutations) {
    for (const scope of scopes) {
      if (scope.contains(mutation.target)) return true
    }
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue
      for (const scope of scopes) {
        if (node === scope || node.contains(scope)) return true
      }
    }
  }
  return false
}

export function frameScheduler(callback: () => void): () => void {
  let pending: number | undefined
  return () => {
    if (pending !== undefined) return
    pending = requestAnimationFrame(() => {
      pending = undefined
      callback()
    })
  }
}
