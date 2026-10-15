/**
 * Pure source transforms for the Copilot gate unlock.
 *
 * GitHub Desktop 3.6 can drive any OpenAI-compatible endpoint through its own
 * "bring your own key" providers, but the commit-message UI stays hidden
 * behind a Copilot entitlement check:
 *
 *   // app/src/lib/feature-flag.ts
 *   enableCommitMessageGeneration = account =>
 *     account.features.includes('desktop_copilot_generate_commit_message') &&
 *     account.isCopilotDesktopEnabled
 *
 * That check is pure client-side UI gating, so we rewrite it in the renderer
 * bundle as it loads. Nothing is written to disk: `session.protocol.handle`
 * serves a patched copy of `renderer.js` and passes every other `file://`
 * request straight through.
 *
 * Scope: this only unlocks GitHub Desktop's own UI so it will talk to the
 * provider the user configured under 选项 → Copilot → 提供方. It does NOT grant
 * access to GitHub's hosted Copilot models — those calls are authorised
 * server-side and come back 402 Payment Required regardless.
 */

interface Patch {
  readonly name: string
  readonly pattern: RegExp
  readonly replacement: string
}

/**
 * Anchored on the feature-flag string literals, which minification leaves
 * untouched; identifier names are matched loosely because they change with
 * every GitHub Desktop build.
 */
const PATCHES: ReadonlyArray<Patch> = [
  {
    // enableCommitMessageGeneration — gates the "generate commit message" button
    name: 'enableCommitMessageGeneration',
    pattern:
      /\(([A-Za-z_$][\w$]*)\.features\?\?\[\]\)\.includes\("desktop_copilot_generate_commit_message"\)&&\1\.isCopilotDesktopEnabled/g,
    replacement: '!0',
  },
  {
    // enableCopilotSdkCommitMessageGeneration — gates the Copilot SDK path,
    // which is what actually talks to a BYOK provider
    name: 'enableCopilotSdkCommitMessageGeneration',
    pattern:
      /[A-Za-z_$][\w$]*\(\)\|\|\([A-Za-z_$][\w$]*\.features\?\?\[\]\)\.includes\("desktop_enable_copilot_sdk_commit_message_generation"\)/g,
    replacement: '!0',
  },
  {
    // fetchUserCopilotInfo — the single point where the entitlement lands on
    // the Account, covering the call sites that read the field directly
    // instead of going through the feature-flag helpers.
    name: 'fetchUserCopilotInfo',
    pattern: /isCopilotDesktopEnabled:[A-Za-z_$][\w$]*\.isCopilotDesktopEnabled/g,
    replacement: 'isCopilotDesktopEnabled:!0',
  },
]

/** Apply every patch, returning the number of matched entitlement checks. */
export function patchRendererSource(source: string): {
  code: string
  applied: number
  skipped: readonly string[]
} {
  let code = source
  let applied = 0
  const skipped: string[] = []

  for (const patch of PATCHES) {
    let hits = 0
    code = code.replace(patch.pattern, () => {
      hits++
      return patch.replacement
    })
    applied += hits
    if (hits === 0) skipped.push(patch.name)
  }

  return { code, applied, skipped }
}
