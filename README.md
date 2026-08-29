# GitHub Desktop Plus

An external enhancement tool and hook suite for GitHub Desktop.

GitHub Desktop Plus (GDP) extends GitHub Desktop at runtime via the official V8 Inspector debugging interface (`--inspect-brk=0`). It unlocks power-user features—custom AI commits, multiple editors/terminals, full i18n localization, and update/telemetry controls—**without modifying or patching official GitHub Desktop files**.

[English](README.md) · [简体中文](README.zh-CN.md)

---

## Enhanced Capabilities

- **Custom AI Commits**: Replaces the native Copilot commit button action with your own AI endpoint. Compatible with any OpenAI-compatible API (OpenAI, DeepSeek, Ollama, SiliconFlow), with custom system prompts and live latency testing.
- **Multiple Editors & Terminals (Open With+)**: Configure unlimited external editors and terminals in the repository context menu. Auto-detects VS Code, Cursor, Zed, JetBrains IDEs, Windows Terminal, WSL distros, and custom CLI tools, with Framer Motion drag-and-drop ordering.
- **Full UI Localization (i18n)**: Complete translation for menus, context menus, and UI dialogs with country flag previews. Includes hot-reloadable JSON translation packs.
- **WSL 2 Integration**: Manage WSL-hosted repositories from Windows with transparent `/mnt/c/` ↔ `\\wsl$\` path translation.
- **Telemetry & Update Controls**: Block background telemetry tracking and suppress automatic updates with a single toggle.
- **Embedded Settings Modal**: Press `Ctrl+Alt+G` or click `GDP` in the menu bar to open a clean React 19 settings panel. All settings apply instantly without restarting.
- **Zero Binary Modification**: Injected at launch using standard V8 debugging protocols. Leaves your official GitHub Desktop installation 100% clean and intact.

---

## How It Works

GDP acts as a lightweight launcher (< 10MB memory). It starts GitHub Desktop with `--inspect-brk=0`, attaches via the Chrome DevTools Protocol (CDP), and injects runtime hooks into the main and renderer processes before scripts execute:

```text
┌───────────────────────────┐         ┌──────────────────────────────┐
│  gdp (Rust Launcher)      │   CDP   │  GitHub Desktop (Electron)   │
│  • Embedded Hook Bundles  │────────→│  • Main Process Hook         │
│  • Embedded Settings UI   │         │    - Telemetry / Update Block│
│  • Embedded Locales       │         │    - AI Dispatcher & IPC     │
│                           │         │  • Renderer Process Hook     │
│                           │         │    - i18n DOM Translation    │
│                           │         │    - Copilot Button Hijack   │
│                           │         │    - Embedded Settings Modal │
└───────────────────────────┘         └──────────────────────────────┘
```

All IPC communication (settings, logs, AI requests, locales) runs directly over typed Electron IPC inside the process. No local HTTP server is required.

---

## Installation & Usage

Install from WSL with one command (Windows x64, GitHub Desktop, WSL 2, and Windows interop are required):

```bash
curl -fsSL https://github.com/sj817/github-desktop-plus/releases/latest/download/install.sh | bash
```

The installer downloads the latest release asset, verifies its SHA-256 checksum, installs it under Windows `%LOCALAPPDATA%\GitHubDesktopPlus\bin`, and creates the WSL command `~/.local/bin/gdp`. Run `gdp` to launch GitHub Desktop, then press `Ctrl+Alt+G` or click `GDP` in the menu bar to open settings.

For a manual install, download `gdp-windows-x64.exe` and its `.sha256` file from [Releases](https://github.com/sj817/github-desktop-plus/releases), verify the checksum, and run the executable from a writable directory.

---

## Development

### Prerequisites
- Node.js >= 22.18, pnpm 9.15.9
- Rust toolchain (stable)

### Commands

```bash
# Install dependencies
pnpm install

# Start development mode (Vite HMR + Hook watcher + GDP + GitHub Desktop)
pnpm dev

# Run settings UI standalone in browser (with mock bridge)
pnpm --filter @github-desktop-plus/settings-ui dev

# Run type checks
pnpm run typecheck

# Full production build
pnpm run build
```

---

## Disclaimer

GitHub Desktop Plus is an independent open-source project and is not affiliated with, endorsed by, or sponsored by GitHub, Inc. or Microsoft Corporation. GitHub and GitHub Desktop are registered trademarks of GitHub, Inc.

GitHub Desktop itself is licensed under the [MIT License](https://github.com/desktop/desktop/blob/development/LICENSE).

---

## License

[MIT](LICENSE)
