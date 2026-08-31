# GitHub Desktop Plus

Supercharge your GitHub Desktop experience — custom AI commit generation, multiple external editors & terminals, full i18n localization, and WSL 2 integration, **without patching official binaries**.

[English](README.md) · [简体中文](README.zh-CN.md)

---

## Features

- **Custom AI Commits**: Replace the native Copilot button with your own AI endpoint. Works with any OpenAI-compatible API (DeepSeek, Ollama, OpenAI, SiliconFlow, etc.), with custom system prompts and latency testing.
- **Open With+ (Multi-Editor & Terminal)**: Launch unlimited editors and terminals directly from the repository context menu (VS Code, Cursor, Zed, JetBrains IDEs, Windows Terminal, WSL distros, etc.) with drag-and-drop reordering.
- **Full i18n & Localization**: Built-in runtime translation architecture. Currently ships with Simplified Chinese (`zh-CN`), with instant hot-reloading and open community contributions for other languages.
- **WSL 2 Integration**: Seamlessly manage repositories hosted inside WSL from Windows with automatic `/mnt/c/` ↔ `\\wsl$\` path translation.
- **Privacy & Version Control**: Block background telemetry tracking and disable silent automatic updates with a single toggle.
- **Embedded Settings Panel**: Press `Ctrl+Alt+G` or click `GDP` in the menu bar to access settings. All changes apply instantly without restarting.
- **Zero Binary Modification**: Injected at launch via the official V8 Inspector protocol. Leaves your official GitHub Desktop installation 100% clean and intact.

---

## Screenshots

### Localized UI & GDP Menu
Full runtime UI translation with a dedicated `GDP` menu entry.

![GitHub Desktop running with GDP](docs/screenshots/overview.png)

### Key Features

| Custom AI Commits | Open With+ (Multi-Editor & Terminal) |
| :---: | :---: |
| Native Copilot button calls your custom AI endpoint | Launch VS Code, Cursor, terminals, or WSL from the context menu |
| ![Custom AI commits](docs/screenshots/ai-commit.png) | ![Open With context menu](docs/screenshots/open-with.png) |

### Embedded Settings Modal (`Ctrl+Alt+G`)

Open settings on demand with instant live updates:

![General Settings](docs/screenshots/settings-general.png)

| Open With Settings | AI Commit Settings |
| :---: | :---: |
| ![Open With settings tab](docs/screenshots/settings-open-with.png) | ![AI commit settings tab](docs/screenshots/settings-ai.png) |
| **Language Packs & Hot Reload** | **Live Hook Logs** |
| ![Language packs tab](docs/screenshots/settings-locales.png) | ![Live logs tab](docs/screenshots/settings-logs.png) |

---

## How It Works

GDP acts as a lightweight Rust launcher (< 10MB memory overhead). It launches GitHub Desktop with `--inspect-brk=0`, attaches via the Chrome DevTools Protocol (CDP), and injects runtime hooks into the main and renderer processes:

```text
┌───────────────────────────┐         ┌──────────────────────────────┐
│  GDP (Rust Launcher)      │   CDP   │  GitHub Desktop (Electron)   │
│  • Embedded Hook Bundles  │────────→│  • Main Process Hook         │
│  • Embedded Settings UI   │         │    - Telemetry / Update Block│
│  • Embedded Locales       │         │    - AI Dispatcher & IPC     │
│                           │         │  • Renderer Process Hook     │
│                           │         │    - i18n DOM Translation    │
│                           │         │    - Copilot Button Hijack   │
│                           │         │    - Embedded Settings Modal │
└───────────────────────────┘         └──────────────────────────────┘
```

All IPC communication (settings, logs, AI requests, locales) runs directly inside the Electron process via typed IPC — no local HTTP server required.

---

## Localization & Contributing Translations

GDP provides full runtime i18n support (intercepting and translating native application menus, DOM elements, dialogs, and context menus) with hot-reloading.

Currently, **Simplified Chinese (`zh-CN`)** is built-in and maintained. We warmly welcome community contributions for other languages (Traditional Chinese, Japanese, Korean, Spanish, French, German, etc.)!

### How to Contribute a Language Pack

- **Option 1 (In-App UI)**:
  1. Press `Ctrl+Alt+G` to open Settings and go to the **Language Packs** tab.
  2. Click to scaffold a new locale or import a JSON translation pack.
  3. Edit strings and test them live with instant hot-reloading.
  4. Export the JSON and submit a Pull Request to this repo.

- **Option 2 (Directly in the Codebase)**:
  1. Check the modular JSON files under [`apps/gdp/resources/locales/zh-CN/`](apps/gdp/resources/locales/zh-CN).
  2. Create a new directory under `apps/gdp/resources/locales/<locale-code>` (e.g. `ja-JP`, `zh-TW`).
  3. Translate the keys, verify with `pnpm locales:prepare <locale>`, and submit a PR.

---

## Installation & Usage

### Option 1: Windows Installer (Recommended)

1. Download `GitHubDesktopPlus-win-x64-Setup.exe` from [Releases](https://github.com/sj817/github-desktop-plus/releases).
2. Run the installer (supports custom install directories and dark mode).
3. Launch **GitHub Desktop Plus** from your Desktop or Start Menu.

> [!NOTE]
> Configuration and runtime data are stored in `%APPDATA%\github-desktop-plus`, keeping your settings safe across updates.

### Option 2: WSL One-Line Install

If you develop inside WSL 2, install with one command:

```bash
curl -fsSL https://github.com/sj817/github-desktop-plus/releases/latest/download/install.sh | bash
```

This installs GDP and creates the `gdp` CLI command in `~/.local/bin`. Run `gdp` in your terminal to launch.

### Shortcuts

- **`Ctrl+Alt+G`**: Open / close the GDP settings modal (or click `GDP` in the menu bar).

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

# Build Windows installer and portable packages
pnpm run package:windows
```

---

## Supporting the Project

If you find GitHub Desktop Plus helpful, please consider giving it a Star on GitHub! Your support keeps this project active and growing.

---

## Disclaimer

GitHub Desktop Plus is an independent open-source project and is not affiliated with, endorsed by, or sponsored by GitHub, Inc. or Microsoft Corporation. GitHub and GitHub Desktop are registered trademarks of GitHub, Inc.

GitHub Desktop itself is licensed under the [MIT License](https://github.com/desktop/desktop/blob/development/LICENSE).

---

## License

[MIT](LICENSE)


