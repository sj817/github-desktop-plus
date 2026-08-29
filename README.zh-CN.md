# GitHub Desktop Plus 🚀

<div align="center">

<p align="center">
  <img src="https://raw.githubusercontent.com/sj817/github-desktop-plus/main/apps/site/public/favicon.svg" width="84" height="84" alt="GitHub Desktop Plus Logo" />
</p>

<h3>GitHub Desktop 终极 0-Patch 外部增强工具套件</h3>

<p align="center">
  <strong>在不修改任何官方二进制文件的纯净前提下，赋予 GitHub Desktop 强悍扩展能力。</strong><br>
  自定义 AI 提交信息生成 • 多个外部编辑器/终端打开 • 全界面本地化多语言 • 遥测与自动更新拦截 • 纯扁平内嵌设置弹窗
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

## ✨ 为什么选择 GitHub Desktop Plus？

GitHub Desktop 拥有极佳的直观体验与简洁设计，但官方版存在诸多限制：只能绑定 1 个外部编辑器与 1 个终端、无法使用自定义 AI 模型生成提交信息、强制联网上报遥测、强制后台静默自动更新等。

**GitHub Desktop Plus (GDP)** 彻底突破了这些限制。基于 **Rust 0-patch 注入核心** 与 **React 19 原生内嵌设置面板** 构建，GDP 在运行时动态增强 GitHub Desktop，**无需对官方安装包或执行文件进行任何篡改或补丁注入**。

---

## 🌟 核心功能一览

### 🤖 1. AI 提交信息生成（支持任意 OpenAI 兼容大模型）
- **无缝接管 Copilot 按钮**：点击提交框中原生的 Copilot 星火图标，直接调用您自己配置的大模型生成规范提交信息。
- **广泛兼容**：内置 **OpenAI** (`gpt-4o-mini`, `gpt-4o`)、**DeepSeek** (`deepseek-chat`)、**SiliconFlow（硅基流动）** 以及本地 **Ollama** (`qwen2.5-coder`, `deepseek-r1`, `llama3`) 等预设。
- **实时连通性测试**：一键发起实际接口诊断并返回真实往返延迟（ms），测试满意前不写入持久配置。
- **自定义 System Prompt**：内置常规 Conventional Commits、Gitmoji、极简摘要等模板，亦可随心编写专属提示词。

### 🖥️ 2. 多编辑器与终端启动器（打开方式增强）
- **突破单程序绑定限制**：可在右键仓库时同时配置任意多个外部编辑器和终端工具。
- **一键智能扫描**：自动探测本机安装的 **VS Code**、**Cursor**、**Zed**、**Windsurf**、**JetBrains 全家桶** (IntelliJ, WebStorm, PyCharm, CLion)、**Windows Terminal**、**PowerShell**、**WSL 发行版**等。
- **Framer Motion 60fps 物理拖拽排序**：直观上下拖动调整右键菜单展示顺序。
- **展示方式切换**：支持在右键菜单平铺展示或一键折叠为干净的「打开方式 ▸」子菜单。

### 🌐 3. 完整原生 i18n 多语言汉化（真实矢量国旗）
- **深度界面中文化**：全面汉化菜单栏、上下文右键菜单、操作按钮、提示框与对话框文本。
- **真实国旗微图标预览**：基于 `country-flag-icons` 呈现高清晰度矢量国旗（🇨🇳 `zh-CN`、🇺🇸 `en-US`、🇯🇵 `ja-JP` 等）。
- **即时热生效**：支持导入、导出、新建与热切换本地 JSON 翻译包，无需重启 GitHub Desktop。

### 🐧 4. WSL 2 跨环境无缝集成
- 完美解决 Windows 宿主与 WSL 2 子系统之间的路径转换问题（`/mnt/c/...` ↔ `\\wsl$\...`）。
- 支持直接在 Windows 版 GitHub Desktop 中管理 WSL 仓库，并使用 WSL 内部终端或 Windows 宿主 IDE 极速拉起。

### 🛡️ 5. 隐私与自动更新拦截
- **彻底阻止自动更新**：拦截 autoUpdater 后台更新逻辑并接管「关于」面板中的检查更新入口，保持稳定打补丁环境。
- **隐私遥测屏蔽**：拦截向 central / usage / stats.github.com 发送的所有数据统计与异常跟踪请求。

### ⚙️ 6. 现代内嵌设置面板（React 19 + Element Plus 扁平美学）
- **零污染原生呼出**：按下快捷键 `Ctrl+Alt+G` 或点击顶部 GDP 菜单即可唤起设置弹窗。
- **Element Plus 扁平风格**：告别厚重纯色实心大方块，采用纯扁平描边（`#409EFF`）与轻量化微交互。
- **MiSans 按需裁剪字体**：中文字符集深度子集化（< 60KB），呈现优雅高级的排版质感。
- **实时运行日志诊断器**：模块化彩色胶囊日志流，支持关键词即时过滤、一键清空与独立文件导出。

---

## 📊 官方版 vs GitHub Desktop Plus 对比

| 特性 | 官方 GitHub Desktop | GitHub Desktop Plus (GDP) |
| :--- | :---: | :---: |
| **外部编辑器数量** | 最多仅 1 个 | **无限制**（VS Code / Cursor / Zed / JetBrains 并存） |
| **外部终端数量** | 最多仅 1 个 | **无限制**（Windows Terminal / PowerShell / WSL 等） |
| **AI 提交信息生成** | 需付费 Copilot 订阅 | **任意 OpenAI 兼容模型**（DeepSeek / Ollama / 免费本地模型） |
| **界面中文化 (i18n)** | 官方仅英文 | **深度完整中文化**（支持热重载 JSON 翻译包） |
| **WSL 2 环境支持** | 仅 Windows 基础路径 | **深度集成 WSL 发行版与跨环境路径转换** |
| **遥测与数据上报** | ❌ 强制开启 | **✅ 内置一键彻底拦截** |
| **后台自动更新** | ❌ 强制后台拉取 | **✅ 一键冻结版本，拒绝破坏性覆盖** |
| **二进制安全性** | 官方分发 | **0-Path 运行时注入，100% 不破坏官方签名与文件** |
| **常驻内存与开销** | 标准 Electron 开销 | **< 10MB 超低常驻内存（Rust 原生核心）** |

---

## 🏗️ 系统架构图

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

1. **0-Patch 启动**：GDP 使用 `--inspect-brk=0` 参数唤起 GitHub Desktop，并通过 Chrome DevTools Protocol (CDP) 建立连接。
2. **早期 Hook 注入**：在主进程和渲染进程脚本执行前，直接注入编译为 CJS 的 TypeScript 逻辑。
3. **高效 IPC 契约**：React 19 设置界面通过强类型 IPC 直接与主进程通信，不占用任何本地 HTTP 端口。

---

## 🚀 快速开始

### 安装与运行

从 [Releases 页面](https://github.com/sj817/github-desktop-plus/releases) 下载最新的执行程序并启动：

```bash
# 启动增强版 GitHub Desktop
gdp
```

在 GitHub Desktop 中按下 `Ctrl+Alt+G` 即可随时呼出 GDP 设置面板。

---

## 🛠️ 本地开发与源码构建

### 环境要求
- [Node.js](https://nodejs.org/) (>= 20.x) 与 [pnpm](https://pnpm.io/) (>= 9.x)
- [Rust](https://www.rust-lang.org/) (stable toolchain)

### 本地编译

```bash
# 克隆仓库
git clone https://github.com/sj817/github-desktop-plus.git
cd github-desktop-plus

# 安装依赖
pnpm install

# 进入开发模式（Vite HMR + Hook 热重载 + GDP + GitHub Desktop）
pnpm dev

# 仅在浏览器中独立调试设置界面（带 Mock 数据桥）
pnpm --filter @github-desktop-plus/settings-ui dev

# 类型检查
pnpm run typecheck

# 完整构建发布包（Settings UI → Hooks Bundle → Rust 二进制）
pnpm run build
```

---

## 🗺️ 后续路线规划 (Roadmap)

- [x] 基于 Rust 的 0-patch V8 Inspector 注入引擎
- [x] React 19 + Element Plus 扁平风内嵌设置面板
- [x] 多编辑器与多终端管理器（支持 Framer Motion 拖拽排序）
- [x] 通用 AI 提交信息生成器（OpenAI / DeepSeek / SiliconFlow / Ollama）
- [x] 完整中文本地化多语言引擎与矢量国旗预览
- [x] 遥测屏蔽与自动更新拦截
- [x] WSL 2 跨环境集成与路径无损转换
- [ ] Git Worktree 多工作区图形化增强
- [ ] 交互式单文件/部分代码块暂存（Stash / Unstash）
- [ ] 开放第三方插件生态 Hook

---

## 🤝 欢迎贡献

非常欢迎提交 Issue、功能建议与 Pull Request！

1. Fork 本项目
2. 创建您的特性分支 (`git checkout -b feat/amazing-feature`)
3. 提交您的修改 (`git commit -m 'feat: add some amazing feature'`)
4. 推送到远程分支 (`git push origin feat/amazing-feature`)
5. 新建 Pull Request

---

## 📜 免责声明

**GitHub Desktop Plus** 是一个独立的开源社区项目，与 GitHub, Inc. 或 Microsoft Corporation 无任何隶属、背书或赞助关系。GitHub 与 GitHub Desktop 是 GitHub, Inc. 的注册商标。

GitHub Desktop 本身基于 [MIT 许可证](https://github.com/desktop/desktop/blob/development/LICENSE) 发布。

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

<div align="center">
  <sub>由 sj817 与开源社区用 ❤️ 打造。如果这个项目对您有所帮助，请为它点亮一颗 ⭐ Star！</sub>
</div>
