/** Memory limits for regenerable renderer data; user selection/drafts stay intact. */

interface WorkingDiffState {
  readonly changesState?: {
    readonly selection?: { readonly kind?: string; readonly diff?: unknown }
  }
}

/**
 * Self-contained because this function is also embedded into the official
 * renderer. Only the working diff is dropped: status owns partial selection,
 * drafts live alongside it, and history/stash need different reload paths.
 */
export function releaseInactiveWorkingDiffs<T extends WorkingDiffState>(
  states: Map<string, T>,
  activeHash: string | undefined,
): number {
  let released = 0
  for (const [hash, state] of states) {
    const changes = state.changesState
    const selection = changes?.selection
    if (hash !== activeHash && selection?.kind === 'WorkingDirectory' && selection.diff != null) {
      states.set(hash, {
        ...state,
        changesState: { ...changes, selection: { ...selection, diff: null } },
      })
      released++
    }
  }
  return released
}

// Kept as one runtime source, rather than depending on compiler helper names
// inside a function's toString(). This code runs only in the official renderer.
export const highlightPoolSource = String.raw`class {
  constructor(uri) {
    this.uri = uri;
    this.active = new Set();
    this.idle = [];
    this.queue = [];
  }
  enqueue(request) {
    return new Promise((resolve, reject) => {
      // At most two running and four waiting requests. Older queued requests
      // are cosmetic highlighting work; settle them with no syntax tokens.
      // Their diff text, inline diff tokens and staging model are unaffected.
      if (this.queue.length >= 4) {
        const stale = this.queue.shift();
        stale.request = null;
        stale.resolve({});
        stale.resolve = null;
        stale.reject = null;
      }
      this.queue.push({ request, resolve, reject });
      this.drain();
    });
  }
  drain() {
    while (this.active.size < 2 && this.queue.length) {
      this.start(this.queue.shift());
    }
  }
  start(task) {
    const entry = this.idle.pop();
    if (entry) window.clearTimeout(entry.timer);
    let worker;
    try {
      worker = entry ? entry.worker : new Worker(this.uri);
    } catch (error) {
      task.request = null;
      task.reject(error);
      return;
    }
    this.active.add(worker);
    let settled = false;
    let timeout;
    const finish = (error, tokens) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      this.active.delete(worker);
      task.request = null;
      if (error) {
        worker.terminate();
        task.reject(error);
      } else {
        this.park(worker);
        task.resolve(tokens);
      }
      task.resolve = null;
      task.reject = null;
      this.drain();
    };
    worker.onmessage = event => finish(null, event.data);
    worker.onerror = event => finish(event.error || new Error(event.message));
    worker.onmessageerror = () => finish(new Error('invalid highlight response'));
    timeout = window.setTimeout(() => finish(new Error('timed out')), 5000);
    try {
      worker.postMessage(task.request);
      // postMessage has cloned the input. The main renderer need not retain
      // this request's complete file contents until the worker responds.
      task.request = null;
    } catch (error) {
      finish(error);
    }
  }
  park(worker) {
    // A separate method keeps this idle timer's closure away from the completed
    // task, its promise and the potentially large highlighted token result.
    const idle = { worker, timer: null };
    idle.timer = window.setTimeout(() => {
      const index = this.idle.indexOf(idle);
      if (index < 0) return;
      this.idle.splice(index, 1);
      worker.terminate();
    }, 30000);
    this.idle.push(idle);
  }
}`

const identifier = '[A-Za-z_$][\\w$]*'

/** Exact, unique source shapes only. An unfamiliar build keeps upstream code. */
export function patchRendererMemory(source: string): {
  code: string
  applied: number
  patches: string[]
  skipped: string[]
} {
  let code = source
  const patches: string[] = []
  const skipped: string[] = []

  // Selection and both async boundaries must all match before applying any
  // part. Otherwise a late result could resurrect a diff we have evicted.
  const selectPattern = new RegExp(
    `async _selectRepository\\((${identifier})\\)\\{const (${identifier})=this\\.selectedRepository;`, 'g',
  )
  const diffPattern = new RegExp(
    `async updateChangesWorkingDirectoryDiff\\((${identifier})\\)\\{const (${identifier})=this\\.repositoryStateCache\\.get\\(\\1\\)`, 'g',
  )
  const selections = [...code.matchAll(selectPattern)]
  const diffs = [...code.matchAll(diffPattern)]
  if (selections.length === 1 && diffs.length === 1 && !code.includes('__gdpReleaseWorkingDiffs')) {
    const select = selections[0]!
    const diff = diffs[0]!
    const selectEnd = code.indexOf('}updateRecentRepositories(', select.index)
    const diffEnd = code.indexOf('}_hideStashedChanges(', diff.index)
    const selectBody = code.slice(select.index, selectEnd + 1)
    const diffBody = code.slice(diff.index, diffEnd + 1)
    const selectedWrite = `this.selectedRepository=${select[1]},this.emitUpdate()`
    const afterLoadPattern = new RegExp(
      `const (${identifier})=await (${identifier})\\(${diff[1]},(${identifier}),this\\.hideWhitespaceInChangesDiff\\),` +
      `(${identifier})=this\\.repositoryStateCache\\.get\\(${diff[1]}\\)\\.changesState;`, 'g',
    )
    const reads = [...diffBody.matchAll(afterLoadPattern)]
    if (selectEnd !== -1 && diffEnd !== -1 && selectBody.length < 4000 && diffBody.length < 6000 &&
        selectBody.split(selectedWrite).length === 2 && reads.length === 1 &&
        diffBody.includes('withSelectableLines(') && diffBody.includes('selectedFileIDs') &&
        code.includes('repositoryState=new Map;') &&
        diffBody.includes('async updateChangesWorkingDirectoryDiff(')) {
      const guard = `if(this.selectedRepository?.id!==${diff[1]}.id)return;`
      const lateGuard = `if(this.selectedRepository?.id!==${diff[1]}.id||` +
        `this.__gdpWorkingDiffRequest!==__gdpDiffRequest)return;`
      const late = reads[0]!
      const withLateGuard = diffBody.replace(late[0],
        `const ${late[1]}=await ${late[2]}(${diff[1]},${late[3]},this.hideWhitespaceInChangesDiff);` +
        lateGuard + `const ${late[4]}=this.repositoryStateCache.get(${diff[1]}).changesState;`)
      const firstBrace = withLateGuard.indexOf('{')
      const guardedDiff = withLateGuard.slice(0, firstBrace + 1) + guard +
        'const __gdpDiffRequest={};this.__gdpWorkingDiffRequest=__gdpDiffRequest;' + withLateGuard.slice(firstBrace + 1)
      const guardedSelection = selectBody.replace(selectedWrite,
        `this.selectedRepository=${select[1]},this.__gdpWorkingDiffRequest=null,` +
        `__gdpReleaseWorkingDiffs(this.repositoryStateCache.repositoryState,${select[1]}?.hash),this.emitUpdate()`)
      // Replace from the end so neither original source offset is invalidated.
      const edits = [
        { start: select.index, length: selectBody.length, text: guardedSelection },
        { start: diff.index, length: diffBody.length, text: guardedDiff },
      ].sort((a, b) => b.start - a.start)
      for (const edit of edits) code = code.slice(0, edit.start) + edit.text + code.slice(edit.start + edit.length)
      code = `const __gdpReleaseWorkingDiffs=(${releaseInactiveWorkingDiffs.toString()});\n` + code
      patches.push('release-inactive-working-diffs')
    } else {
      skipped.push('release-inactive-working-diffs')
    }
  } else {
    skipped.push('release-inactive-working-diffs')
  }

  const highlightStart = new RegExp(
    `function (${identifier})\\((${identifier}),(${identifier}),(${identifier}),(${identifier}),(${identifier})\\)\\{` +
    `if\\(!\\2\\.length\\|\\|!\\6\\.length\\)return Promise\\.resolve\\(\\{\\}\\);` +
    `const (${identifier})=(${identifier})\\.shift\\(\\)\\|\\|new Worker\\((${identifier})\\);return new Promise\\(`, 'g',
  )
  const highlighters = [...code.matchAll(highlightStart)]
  if (highlighters.length === 1 && !code.includes('__gdpHighlightPool')) {
    const match = highlighters[0]!
    const endMarker = '},5e3)})}'
    const window = code.slice(match.index, match.index + 2500)
    const end = window.indexOf(endMarker)
    const body = end < 0 ? '' : window.slice(0, end + endMarker.length)
    const [, name, content, basename, extension, tabSize, lines, worker, idle, uri] = match
    if (body && body.includes(`contentLines:${content},basename:${basename},extension:${extension},tabSize:${tabSize},lines:${lines},addModeClass:!0`) &&
        body.includes(`${worker}.onmessage=`) && body.includes(`${worker}.onerror=`) &&
        body.includes(`${idle}.length<2?${idle}.push(${worker}):${worker}.terminate()`) &&
        body.includes('new Error("timed out")')) {
      const replacement = `const __gdpHighlightPool=new (${highlightPoolSource})(${uri});` +
        `function ${name}(${content},${basename},${extension},${tabSize},${lines}){` +
        `if(!${content}.length||!${lines}.length)return Promise.resolve({});` +
        `return __gdpHighlightPool.enqueue({contentLines:${content},basename:${basename},extension:${extension},` +
        `tabSize:${tabSize},lines:${lines},addModeClass:!0})}`
      code = code.slice(0, match.index) + replacement + code.slice(match.index + body.length)
      patches.push('bounded-highlight-workers')
    } else {
      skipped.push('bounded-highlight-workers')
    }
  } else {
    skipped.push('bounded-highlight-workers')
  }
  return { code, applied: patches.length, patches, skipped }
}
