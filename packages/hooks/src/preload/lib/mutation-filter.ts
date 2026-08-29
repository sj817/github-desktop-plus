export function mutationsTouchSelector(
  mutations: readonly MutationRecord[],
  selector: string,
): boolean {
  for (const mutation of mutations) {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement
    if (target?.closest(selector)) return true

    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue
      if (node.matches(selector) || node.querySelector(selector)) return true
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
