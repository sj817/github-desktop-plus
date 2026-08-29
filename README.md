# GitHub Desktop Plus

A zero-patch runtime enhancement tool for GitHub Desktop.

GitHub Desktop Plus (GDP) injects into GitHub Desktop at launch via the V8 Inspector protocol (`--inspect-brk=0`). It adds missing power-user features—custom AI commit messages, multiple editors and terminals, full i18n translation, and telemetry/update suppression—without modifying official binaries or touching local files.

[English](README.md) · [简体中文](README.zh-CN.md)

---

## Features

- **Custom AI Commits**: Hijacks the native Copilot button in the commit box. Supports any OpenAI-compatible API (OpenAI, DeepSeek, Ollama, SiliconFlow) with custom system prompts and live latency testing.
- **Multiple Editors & Terminals**: Replaces the official 1-editor limit with an unlimited launcher. Auto-detects VS Code, Cursor, Zed, JetBrains IDEs, Windows Terminal, WSL distros, and custom CLI tools, with Framer Motion drag-and-drop ordering.
- **Full UI Localization (i18n)**: Native-feeling translation for menus, context menus, and UI dialogs with country flag previews. Hot-reloadable JSON translation packs.
- **WSL 2 Integration**: Open WSL-hosted repositories in Windows IDEs or Linux terminals with transparent `/mnt/c/` ↔ `\\wsl$\` path translation.
- **Privacy & Version Freezing**: Blocks background telemetry reporting and prevents forced auto-updates from overwriting your setup.
- **Embedded Settings Modal**: Clean React 19 settings dialog accessible via `Ctrl+Alt+G` or the menu bar. Hot-reloads all settings instantly without restarting the app.
- **Lightweight Rust Core**: Native Rust launcher with < 10MB resident memory overhead.

---

## How It Works

GDP launches GitHub Desktop with `--inspect-brk=0`, attaches via the Chrome DevTools Protocol (CDP), and injects hook scripts before `main.js` and renderer scripts execute:

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

## Comparison with Official GitHub Desktop

| Feature | Official GitHub Desktop | GitHub Desktop Plus |
| :--- | :---: | :---: |
| **External Editors** | 1 at a time | Unlimited (VS Code, Cursor, Zed, JetBrains...) |
| **External Terminals** | 1 at a time | Unlimited (Windows Terminal, WSL, PowerShell...) |
| **AI Commit Generation** | GitHub Copilot subscription only | Any OpenAI-compatible API (DeepSeek, Ollama, OpenAI...) |
| **UI Language** | English only | Multi-language with hot-reload JSON packs |
| **WSL 2 Support** | Windows paths only | Native distro detection & path mapping |
| **Auto-Updates** | Forced | Blockable via switch |
| **Telemetry** | Mandatory | Blockable via switch |
| **Binary Integrity** | Official | 100% Unmodified (0-patch runtime injection) |
| **Memory Overhead** | Standard | < 10MB RAM |

---

## Installation & Usage

1. Download the latest `gdp` executable from [Releases](https://github.com/sj817/github-desktop-plus/releases).
2. Run `gdp` (or replace your desktop shortcut target with `gdp`).
3. Press `Ctrl+Alt+G` inside GitHub Desktop or click `GDP` in the menu bar to open settings.

---

## Development

### Prerequisites
- Node.js >= 20.x, pnpm >= 9.x
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
