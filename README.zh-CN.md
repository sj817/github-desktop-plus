# GitHub Desktop Plus

让 GitHub Desktop 更好用 —— 免修改原版文件，解锁自定义 AI 提交、多编辑器/终端支持、完整中文汉化与 WSL 深度集成。

[English](README.md) · [简体中文](README.zh-CN.md)

---

## 核心特性

- **自定义 AI 提交 (AI Commit)**：替换原生 Copilot 按钮，接入任意兼容 OpenAI 协议的模型（DeepSeek、Ollama、OpenAI、硅基流动等），支持自定义 Prompt 与实时延迟测试。
- **多编辑器与终端 (Open With+)**：在仓库右键菜单中随心添加常用工具（VS Code、Cursor、Zed、JetBrains 全家桶、Windows Terminal、WSL 等），支持自定义启动参数与拖拽排序。
- **多语言与界面汉化 (i18n)**：全界面、菜单栏与弹窗即时汉化。底层具备完整的多语言注入架构，内置简体中文，支持语言包热重载并欢迎社区贡献更多语言。
- **WSL 2 深度集成**：无缝支持管理 WSL 内部的 Git 仓库，自动完成 Windows 与 WSL 之间的路径映射转换。
- **隐私保护与版本锁定**：一键拦截后台遥测数据上传，支持禁用静默自动更新。
- **原生内嵌设置面板**：按下 `Ctrl+Alt+G` 或点击菜单栏 `GDP` 即可呼出设置面板，修改即时生效，无需重启应用。
- **纯净无侵入**：基于 V8 调试协议在运行时动态注入 Hook，不修改官方二进制文件与数字签名，安全可逆。

---

## 界面预览

### 界面汉化与 GDP 菜单
全界面运行时汉化，并在菜单栏增加专属 `GDP` 入口。

![GDP 托管下的 GitHub Desktop 汉化主界面](docs/screenshots/overview.png)

### 核心功能

| 自定义 AI 提交 | 多编辑器 / 终端支持 (Open With+) |
| :---: | :---: |
| 原生 Copilot 按钮直接调用自定义 AI 接口生成提交信息 | 右键菜单直接打开 VS Code、Cursor、终端或 WSL |
| ![自定义 AI 提交](docs/screenshots/ai-commit.png) | ![打开方式增强](docs/screenshots/open-with.png) |

### 内嵌设置面板 (`Ctrl+Alt+G`)

按下快捷键随时呼出设置，所有配置修改即时生效：

![常规设置页](docs/screenshots/settings-general.png)

| 打开方式配置 | AI 提交配置 |
| :---: | :---: |
| ![打开方式设置](docs/screenshots/settings-open-with.png) | ![AI 提交设置](docs/screenshots/settings-ai.png) |
| **语言包管理与热重载** | **实时 Hook 日志** |
| ![语言包设置](docs/screenshots/settings-locales.png) | ![实时日志](docs/screenshots/settings-logs.png) |

---

## 工作原理

GDP 是一个超轻量的 Rust 启动器（常驻内存 < 10MB）。启动时通过 `--inspect-brk=0` 唤起 GitHub Desktop 并通过 Chrome DevTools Protocol (CDP) 注入 Hook：

```text
┌───────────────────────────┐         ┌──────────────────────────────┐
│  GDP (Rust 启动器)        │   CDP   │  GitHub Desktop (Electron)   │
│  • 内嵌 Hook 脚本         │────────→│  • 主进程 (Main)             │
│  • 内嵌设置面板           │         │    - 拦截遥测与自动更新      │
│  • 内嵌语言包             │         │    - AI 请求转发与 IPC 通信  │
│                           │         │  • 渲染进程 (Renderer)       │
│                           │         │    - DOM / 菜单 i18n 汉化    │
│                           │         │    - 接管 Copilot 生成按钮   │
│                           │         │    - 挂载内嵌设置弹窗        │
└───────────────────────────┘         └──────────────────────────────┘
```

所有配置读写与调度均在 Electron 进程内通过 IPC 完成，无需额外开启本地 HTTP 端口。

---

## 国际化与多语言贡献

GDP 在底层构建了完整的 i18n 运行时注入与文本提取体系（覆盖主进程原生菜单、渲染进程 DOM、各类弹出对话框与上下文菜单），支持语言包即时热重载。

目前官方内置并维护了 **简体中文 (`zh-CN`)** 语言包。如果你希望 GitHub Desktop Plus 支持更多语言（如繁体中文、日语、韩语、西班牙语、法语、德语等），非常欢迎参与翻译与贡献！

### 如何贡献语言包？

- **方法一（图形界面编辑 & 导出）**：
  1. 按下 `Ctrl+Alt+G` 打开设置面板，进入 **【语言包】** 页面。
  2. 点击新建语言脚手架，直接在界面中编辑或导入翻译 JSON。
  3. 编辑过程中支持即时热生效预览。
  4. 导出后将 JSON 文件提交 Pull Request 到本仓库。

- **方法二（直接在源码中添加）**：
  1. 参考 [`apps/gdp/resources/locales/zh-CN/`](apps/gdp/resources/locales/zh-CN) 中的分模块 JSON 文件。
  2. 在 `apps/gdp/resources/locales/` 目录下新建对应语言代码文件夹（例如 `ja-JP`、`zh-TW`）。
  3. 翻译对应词条，运行 `pnpm locales:prepare <locale>` 验证后提交 PR。

---

## 安装与使用

### 方式一：Windows 安装包（推荐）

1. 前往 [Releases](https://github.com/sj817/github-desktop-plus/releases) 下载最新版本的 `GitHubDesktopPlus-win-x64-Setup.exe`。
2. 运行安装向导，按提示完成安装（支持自定义安装路径与深浅色主题）。
3. 从桌面或开始菜单启动 **GitHub Desktop Plus**。

> [!NOTE]
> 配置与用户数据统一保存在 `%APPDATA%\github-desktop-plus`，软件更新或卸载不会丢失配置。

### 方式二：WSL 一键安装

如果你在 WSL 2 环境中工作，可以直接运行安装脚本：

```bash
curl -fsSL https://github.com/sj817/github-desktop-plus/releases/latest/download/install.sh | bash
```

脚本会自动下载校验并在 WSL 中生成 `gdp` 命令。之后在终端直接输入 `gdp` 即可启动。

### 快捷键

- **`Ctrl+Alt+G`**：打开 / 关闭 GDP 设置面板（或通过顶部菜单栏点击 `GDP`）。

---

## 本地开发

### 前置要求
- Node.js >= 22.18, pnpm 9.15.9
- Rust 工具链 (stable)

### 常用命令

```bash
# 安装依赖
pnpm install

# 启动开发环境（Vite HMR + Hook 热编译 + GDP + GitHub Desktop）
pnpm dev

# 在浏览器中独立调试设置界面（带 Mock 桥）
pnpm --filter @github-desktop-plus/settings-ui dev

# 类型检查
pnpm run typecheck

# 全量打包构建
pnpm run build

# 构建 Windows 安装包与便携包
pnpm run package:windows
```

---

## 支持项目

如果 GitHub Desktop Plus 对你的日常开发有所帮助，欢迎在 GitHub 上点个 Star 支持一下！你的支持是项目持续维护的最大动力。

---

## 免责声明

GitHub Desktop Plus 是一个独立的开源项目，与 GitHub, Inc. 或 Microsoft Corporation 无任何隶属、背书或关联关系。GitHub 与 GitHub Desktop 是 GitHub, Inc. 的注册商标。

GitHub Desktop 官方源码遵循 [MIT 许可证](https://github.com/desktop/desktop/blob/development/LICENSE)。

---

## 许可证

[MIT](LICENSE)


