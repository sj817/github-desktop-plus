# GitHub Desktop Plus 🚀

<div align="center">

<p align="center">
  <img src="https://raw.githubusercontent.com/sj817/github-desktop-plus/main/apps/site/public/favicon.svg" width="84" height="84" alt="GitHub Desktop Plus Logo" />
</p>

<h3>The Ultimate 0-Patch Enhancement Suite for GitHub Desktop</h3>

<p align="center">
  <strong>Supercharge GitHub Desktop without modifying official binaries.</strong><br>
  Custom AI Commit Generation • Multi-Editor/Terminal Launch • Full Native i18n • Telemetry Blocker • Hot Reload Settings
</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> ·
  <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <a href="https://github.com/sj817/github-desktop-plus/releases"><img src="https://img.shields.io/github/v/release/sj817/github-desktop-plus?style=flat-square&color=409EFF" alt="Release" /></a>
  <a href="https://github.com/sj817/github-desktop-plus/stargazers"><img src="https://img.shields.io/github/stars/sj817/github-desktop-plus?style=flat-square&color=409EFF" alt="GitHub Stars" /></a>
  <a href="https://github.com/sj817/github-desktop-plus/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-2024-orange.svg?style=flat-square&logo=rust" alt="Rust" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-blue.svg?style=flat-square&logo=react" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
</p>

</div>

---

## ✨ Why GitHub Desktop Plus?

GitHub Desktop is a clean and intuitive Git GUI, but power users often hit rigid limitations: only one external editor/terminal, no custom AI commit models, mandatory telemetry, and forced auto-updates.

**GitHub Desktop Plus (GDP)** breaks these barriers. Powered by a high-performance **Rust 0-patch injection core** and a modern **React 19 embedded settings modal**, GDP extends GitHub Desktop seamlessly at runtime — **without patching or modifying a single official binary file**.

---

## 🌟 Key Features

### 🤖 1. AI Commit Message Generator (Any Model)
- **Hijack Copilot Button**: Click the native Copilot spark icon in the commit box to generate conventional commit messages with your own AI models.
- **Universal OpenAI Protocol Compatibility**: Out-of-the-box presets for **OpenAI** (`gpt-4o-mini`, `gpt-4o`), **DeepSeek** (`deepseek-chat`), **SiliconFlow**, and local **Ollama** (`qwen2.5-coder`, `deepseek-r1`, `llama3`).
- **Live Connectivity Testing**: One-click test with real latency readout without saving unverified credentials.
- **Custom System Prompt**: Choose from presets (Conventional Commits, Gitmoji, Concise) or write your own.

### 🖥️ 2. Multi-Editor & Terminal Launcher (Open With+)
- **Beyond the 1-Editor Limitation**: Configure unlimited external editors and terminals simultaneously.
- **Smart Auto-Detection**: One-click scanning for **VS Code**, **Cursor**, **Zed**, **Windsurf**, **JetBrains** (IntelliJ, WebStorm, PyCharm, CLion), **Windows Terminal**, **PowerShell**, **WSL distros**, and custom CLI tools.
- **60fps Drag-and-Drop Reordering**: Powered by Framer Motion spring physics.
- **Display Modes**: Choose between flat root context menu items or a clean collapsed submenu (`Open With ▸`).

### 🌐 3. Full Native i18n & Multi-Language (Real Country Flags)
- **High-Fidelity UI Translation**: Complete localization for menus, buttons, context menus, and dialogs.
- **Vector Country Flags**: Beautiful micro SVG flags powered by `country-flag-icons` (🇨🇳 `zh-CN`, 🇺🇸 `en-US`, 🇯🇵 `ja-JP`, etc.).
- **Hot-Reloadable Locales**: Import, export, create, and hot-switch JSON translation packs on the fly without restarting GitHub Desktop.

### 🐧 4. WSL 2 Cross-Environment Integration
- Seamlessly open repositories inside WSL distributions directly in Windows IDEs or Linux terminals without path mangling.
- High-efficiency path translation (`/mnt/c/...` ↔ `\\wsl$\...`) with background agent architecture.

### 🛡️ 5. Telemetry & Update Suppression
- **Block Auto-Updates**: Prevent unwanted background downloads and keep your patched environment rock-solid.
- **Telemetry Blocker**: Intercept and drop background tracking requests to central/usage metrics.

### ⚙️ 6. Modern Embedded Settings UI
- **Zero-Pollution Modal**: Press `Ctrl+Alt+G` or click menu `GDP` to summon the settings dialog.
- **Element Plus Flat Design**: Ultra-clean, non-intrusive flat outline aesthetic with zero heavy color blocks.
- **Subsetted MiSans Typography**: Elegant CJK font rendering bundled under 60KB.
- **Real-Time Diagnostic Log Viewer**: Live colorized console output with instant filtering and copy/clear controls.

---

## 📊 Feature Comparison

| Feature | Official GitHub Desktop | GitHub Desktop Plus (GDP) |
| :--- | :---: | :---: |
| **External Editors** | Max 1 Editor | **Unlimited** (VS Code, Cursor, Zed, JetBrains, etc.) |
| **External Terminals** | Max 1 Shell | **Unlimited** (Windows Terminal, PowerShell, WSL, Bash) |
| **AI Commit Generation** | GitHub Copilot Subscription only | **Any OpenAI API** (DeepSeek, Ollama, OpenAI, Qwen) |
| **UI Localization** | English only | **Full Native i18n** (Hot-reload JSON packs) |
| **WSL 2 Integration** | Basic Windows paths | **Native WSL Distro Detection & Launch** |
| **Telemetry Suppression** | ❌ Mandatory | **✅ Built-in Zero-Tracking Switch** |
| **Auto-Update Control** | ❌ Forced | **✅ One-click Block / Freeze Version** |
| **Binary Modification** | N/A | **0-Path Runtime Injection (100% Safe)** |
| **Runtime Overhead** | Standard | **< 10MB RAM (Rust Core)** |

---

## 🏗️ Technical Architecture

```text
┌──────────────────────────────────────────────┐
│  GitHub Desktop Plus (Rust Core `gdp`)       │
│                                              │
│  ┌────────────────────┐   CDP (Inspector)    │
│  │ V8 Inspector       │───────────────────┐  │
│  │ 0-Path Injector    │                   │  │
│  └────────────────────┘                   │  │
│  ┌────────────────────┐                   │  │
│  │ Embedded Bundles   │                   │  │
│  │ • Preload Hooks    │                   │  │
│  │ • Settings UI IIFE │                   │  │
│  │ • Locale Sources   │                   │  │
│  └────────────────────┘                   │  │
└───────────────────────────────────────────┼──┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────┐
│ GitHub Desktop (Official Electron Runtime)                │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Main Process Hook                                   │  │
│  │ • Update Blocker • Telemetry Filter • Menu Injector │  │
│  │ • Direct IPC Bridge • AI Dispatcher                 │  │
│  └──────────────────────────┬──────────────────────────┘  │
│                             │ Electron IPC                │
│  ┌──────────────────────────┴──────────────────────────┐  │
│  │ Renderer Process                                    │  │
│  │ • DOM & Menu i18n Hot Translation                   │  │
│  │ • Copilot Button Hijack (AI Commit Trigger)         │  │
│  │ • Embedded React 19 Settings Modal (<dialog>)       │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

1. **0-Patch Launch**: GDP starts GitHub Desktop via `--inspect-brk=0` and connects over the Chrome DevTools Protocol (CDP).
2. **Early Hook Injection**: Evaluates TypeScript-compiled CJS bundles inside `main.js` and `renderer` before initial execution.
3. **IPC Bridge**: High-performance typed IPC protocol connecting the React 19 UI directly to the Electron main process.

---

## 🚀 Quick Start

### Installation

Download the latest release executable from [Releases](https://github.com/sj817/github-desktop-plus/releases) and run:

```bash
# Start GitHub Desktop with GDP enhancements
gdp
```

Press `Ctrl+Alt+G` inside GitHub Desktop to open the Settings Panel anytime.

---

## 🛠️ Development & Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (>= 20.x) & [pnpm](https://pnpm.io/) (>= 9.x)
- [Rust](https://www.rust-lang.org/) (stable toolchain)

### Local Setup

```bash
# Clone the repository
git clone https://github.com/sj817/github-desktop-plus.git
cd github-desktop-plus

# Install all workspace dependencies
pnpm install

# Start development mode (Vite HMR + Hook watcher + GDP + GitHub Desktop)
pnpm dev

# Run settings UI standalone in browser with mock bridge
pnpm --filter @github-desktop-plus/settings-ui dev

# Typecheck all packages
pnpm run typecheck

# Full production build (Settings UI → Hooks Bundle → Rust Executable)
pnpm run build
```

---

## 🗺️ Roadmap

- [x] Rust-powered 0-patch V8 Inspector injector
- [x] Element Plus flat aesthetic settings modal (React 19)
- [x] Multi-Editor & Multi-Terminal manager with Framer Motion drag-and-drop
- [x] Universal AI commit generator (OpenAI, DeepSeek, SiliconFlow, Ollama)
- [x] Native i18n engine with SVG country flag previews
- [x] Telemetry blocker and auto-update suppressor
- [x] WSL 2 environment integration and path translation
- [ ] Git Worktree management GUI enhancement
- [ ] Quick interactive stash/unstash per-file diff manager
- [ ] Plugin ecosystem for community-contributed hooks

---

## 🤝 Contributing

Contributions, feature requests, and bug reports are warmly welcome!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feat/amazing-feature`)
3. Commit your Changes (`git commit -m 'feat: add some amazing feature'`)
4. Push to the Branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## 📜 Disclaimer

**GitHub Desktop Plus** is an independent open-source community project and is not affiliated with, endorsed by, or sponsored by GitHub, Inc. or Microsoft Corporation. GitHub and GitHub Desktop are registered trademarks of GitHub, Inc.

GitHub Desktop itself is licensed under the [MIT License](https://github.com/desktop/desktop/blob/development/LICENSE).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

<div align="center">
  <sub>Built with ❤️ by sj817 and the open-source community. If you like this project, please consider giving it a ⭐ star!</sub>
</div>
