/**
 * GDP Navbar — intentionally empty.
 *
 * The previous floating bottom-right "GDP" button was removed because
 * it duplicated the top-level "GDP" menu entry without offering any
 * additional functionality (its panel only echoed status flags).
 *
 * The control panel (WebUI) is now reachable via:
 *   - Top menu:   GDP → 打开控制面板 (WebUI)
 *   - Shortcut:   Ctrl+Alt+G  (Cmd+Alt+G on macOS)
 *
 * This file is kept (rather than removed entirely) so that the existing
 * build / embed pipeline (esbuild + Rust hook_assets.rs) does not need
 * to change.  It compiles to a no-op IIFE.
 */
(function () {
  /* no floating UI — see GDP menu */
})();

