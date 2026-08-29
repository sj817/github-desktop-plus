# GitHub Desktop Plus

GitHub Desktop 的 0-Patch 运行时外部增强工具。

GitHub Desktop Plus (GDP) 通过 V8 Inspector 协议（`--inspect-brk=0`）在启动时直接注入 GitHub Desktop，在**不修改官方二进制文件、不破坏签名、不篡改本地文件**的前提下，补齐进阶功能：自定义 AI 提交信息、多编辑器/终端并发启动、完整中文汉化、阻止自动更新与遥测拦截。

[English](README.md) · [简体中文](README.zh-CN.md)

---

## 主要特性

- **自定义 AI 提交信息**：接管提交框中原生的 Copilot 按钮。支持任意兼容 OpenAI 协议的模型（OpenAI、DeepSeek、Ollama、硅基流动等），支持自定义 System Prompt 与实时往返延迟测试。
- **多编辑器与终端（打开方式增强）**：突破官方只能配 1 个编辑器和 1 个终端的限制。自动识别 VS Code、Cursor、Zed、JetBrains 全家桶、Windows Terminal、PowerShell、WSL 发行版等，支持物理拖拽排序与子菜单折叠。
- **完整界面汉化 (i18n)**：全量汉化菜单、右键菜单、操作按钮与对话框文本，带矢量国旗预览。支持本地 JSON 语言包热重载、导入与导出。
- **WSL 2 跨环境集成**：直接在 Windows 宿主版中管理 WSL 仓库，提供透明的 `/mnt/c/` ↔ `\\wsl$\` 路径转换。
- **隐私与版本锁定**：彻底拦截发往 GitHub 的后台遥测数据；支持一键禁用自动更新，避免环境被静默覆盖。
- **内嵌扁平设置面板**：按下 `Ctrl+Alt+G` 或点击菜单栏 `GDP` 唤起纯扁平设计的设置弹窗（React 19），所有配置即时热生效无需重启。
- **超轻量 Rust 核心**：原生 Rust 启动器，常驻内存增量 < 10MB。

---

## 运行原理

GDP 使用 `--inspect-brk=0` 参数唤起 GitHub Desktop，通过 Chrome DevTools Protocol (CDP) 连接，并在主进程和渲染进程脚本执行前注入 Hook：

```text
┌───────────────────────────┐         ┌──────────────────────────────┐
│  gdp (Rust 启动器)        │   CDP   │  GitHub Desktop (Electron)   │
│  • 内嵌 Hook Bundles      │────────→│  • 主进程 Hook               │
│  • 内嵌设置面板 UI        │         │    - 拦截遥测与自动更新      │
│  • 内嵌语言包             │         │    - AI 请求转发与 IPC 调度  │
│                           │         │  • 渲染进程 Hook             │
│                           │         │    - DOM / 菜单 i18n 热汉化  │
│                           │         │    - 接管 Copilot 生成按钮   │
│                           │         │    - 内嵌设置弹窗 (<dialog>) │
└───────────────────────────┘         └──────────────────────────────┘
```

所有通信（配置读写、日志流、AI 生成、语言包）直接在进程内通过强类型 Electron IPC 传输，无需开启本地 HTTP 端口。

---

## 官方版 vs GitHub Desktop Plus 对比

| 功能特性 | 官方 GitHub Desktop | GitHub Desktop Plus |
| :--- | :---: | :---: |
| **外部编辑器数量** | 仅限 1 个 | 无限制（VS Code, Cursor, Zed, JetBrains 等） |
| **外部终端数量** | 仅限 1 个 | 无限制（Windows Terminal, WSL, PowerShell 等） |
| **AI 提交信息生成** | 仅限官方 Copilot 付费订阅 | 支持任意 OpenAI 兼容接口（DeepSeek, Ollama, OpenAI） |
| **界面语言** | 仅限英文 | 深度汉化，支持热重载 JSON 语言包 |
| **WSL 2 支持** | 仅 Windows 路径 | 原生识别 WSL 发行版与跨环境路径映射 |
| **自动更新控制** | 强制后台下载 | 支持一键彻底禁用 |
| **遥测上报** | 强制开启 | 支持一键彻底拦截 |
| **程序安全性** | 官方安装包 | 100% 0-Patch 运行时注入（不改写任何文件） |
| **额外内存开销** | 标准开销 | < 10MB RAM |

---

## 安装与使用

1. 从 [Releases](https://github.com/sj817/github-desktop-plus/releases) 下载最新版本的 `gdp` 执行文件。
2. 运行 `gdp`（或将快捷方式指向 `gdp`）。
3. 在 GitHub Desktop 中按下 `Ctrl+Alt+G` 或点击顶部菜单 `GDP` 即可打开设置。

---

## 本地开发与构建

### 前置要求
- Node.js >= 20.x, pnpm >= 9.x
- Rust toolchain (stable)

### 常用命令

```bash
# 安装依赖
pnpm install

# 进入开发模式（Vite HMR + Hook 热编译 + GDP + GitHub Desktop）
pnpm dev

# 在浏览器中独立调试设置界面（带 Mock 桥）
pnpm --filter @github-desktop-plus/settings-ui dev

# 类型检查
pnpm run typecheck

# 全量打包构建
pnpm run build
```

---

## 免责声明

GitHub Desktop Plus 是一个独立的开源项目，与 GitHub, Inc. 或 Microsoft Corporation 无任何隶属、背书或关联关系。GitHub 与 GitHub Desktop 是 GitHub, Inc. 的注册商标。

GitHub Desktop 官方源码遵循 [MIT 许可证](https://github.com/desktop/desktop/blob/development/LICENSE)。

---

## 开源许可证

[MIT](LICENSE)
