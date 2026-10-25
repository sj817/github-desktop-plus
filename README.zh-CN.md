<img src="apps/gdp/assets/gdp-icon.png" width="80" alt="GitHub Desktop Plus">

# GitHub Desktop Plus

轻量级、免改动原版文件的 GitHub Desktop 增强工具与持久汉化中文版。基于 Chrome 开发者工具协议 (CDP) 在运行时动态注入，支持自定义 AI 提交、多编辑器/终端快速唤醒、完整中文界面与 WSL 深度集成，官方升级不失效。

[English](README.md) · [简体中文](README.zh-CN.md)

---

## 功能特性

- **自定义 AI 提交 (AI Commit)**：在原生提交面板中调用自定义大模型接口。兼容任意 OpenAI 协议端点（DeepSeek、Ollama 本地模型、OpenAI、硅基流动等），支持自定义 Prompt 模板与延迟测试。
- **多编辑器与终端 (Open With+)**：在仓库与文件的右键菜单中快速唤醒外部工具（VS Code、Cursor、Zed、JetBrains 全家桶、Windows Terminal、WSL 各发行版等），支持拖拽排序与单文件精准跳转。
- **免改原版、升级不失效的汉化 (i18n)**：全界面、原生菜单与对话框运行时即时汉化。内置简体中文 (`zh-CN`)，基于 CDP 动态注入机制，不修改官方安装目录下的任何文件，官方自动更新后汉化依然有效。
- **WSL 2 深度集成**：无缝管理 WSL 内部的 Git 仓库，自动完成 Windows 与 WSL 之间的路径映射转换。
- **隐私保护与版本锁定**：一键拦截官方后台遥测数据上传，支持禁用静默自动更新。
- **原生内嵌设置面板**：按下 `Ctrl+Alt+G` 或点击菜单栏 `GDP` 即可唤出设置，所有配置修改实时生效，无需重启应用。
- **纯净无侵入**：启动时通过 V8 调试协议注入 Hook，不修改官方二进制文件与数字签名，安全可逆。

---

## 功能对比

| 功能特性 | 官方 GitHub Desktop | 传统汉化补丁 | GitHub Desktop Plus (GDP) |
| :--- | :--- | :--- | :--- |
| **界面汉化** | ❌ 仅支持英文 | ⚠️ 直接替换 `app.asar`（官方更新后失效） | ✅ 基于 CDP 运行时注入（免改原版，升级不失效） |
| **AI 提交信息生成** | ⚠️ 仅支持 GitHub Copilot（需付费订阅） | ❌ 无 | ✅ 支持任意兼容 OpenAI 协议的模型（DeepSeek、Ollama 等） |
| **外部编辑器与终端** | ⚠️ 仅支持配置 1 个默认编辑器 | ⚠️ 仅支持 1 个默认编辑器 | ✅ 右键菜单支持多编辑器与终端快捷唤醒 (Open With+) |
| **WSL 2 仓库管理** | ⚠️ 路径转换受限，配置繁琐 | ⚠️ 路径转换受限 | ✅ 自动处理 `/mnt/c/` ↔ `\\wsl$\` 跨系统路径映射 |
| **程序文件完整性** | ✅ 官方纯净安装 | ❌ 二进制文件被篡改，破坏数字签名 | ✅ 零修改官方文件，保留完整签名与安全性 |
| **遥测与自动更新** | ⚠️ 默认启用后台数据上传与静默更新 | ⚠️ 默认启用 | ✅ 支持一键禁用遥测上传与锁定更新 |

---

## 界面预览

### 汉化界面与 GDP 菜单
全界面运行时汉化，顶部菜单栏新增专属 `GDP` 设置入口。

![汉化主界面](docs/screenshots/overview.png)

### 核心功能

| 自定义 AI 提交 | 多编辑器与终端唤醒 (Open With+) |
| :---: | :---: |
| ![自定义 AI 提交](docs/screenshots/ai-commit.png) | ![右键打开方式](docs/screenshots/open-with.png) |
| 在原生提交框直接调用自定义 LLM 生成 Commit | 右键菜单直接唤醒常用编辑器或终端 |

### 内嵌设置面板 (`Ctrl+Alt+G`)

| 常规设置 | 打开方式配置 |
| :---: | :---: |
| ![常规设置](docs/screenshots/settings-general.png) | ![打开方式设置](docs/screenshots/settings-open-with.png) |

| AI 提交配置 | 语言包管理与热重载 |
| :---: | :---: |
| ![AI 提交设置](docs/screenshots/settings-ai.png) | ![语言包设置](docs/screenshots/settings-locales.png) |

---

## 工作原理

GDP 是一个轻量级 Rust 启动器（常驻内存 < 10MB）。启动时通过 `--inspect-brk=0` 唤起 GitHub Desktop 并通过 Chrome DevTools Protocol (CDP) 注入 Hook：

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

## 安装与使用

### Windows

1. 前往 [Releases](https://github.com/sj817/github-desktop-plus/releases/latest) 下载安装包 (`GitHubDesktopPlus-win-x64-Setup.exe`) 或便携版 (`Portable.zip`)。
2. 运行安装程序并启动 **GitHub Desktop Plus**。

> **说明**：配置与用户数据统一保存在 `%APPDATA%\github-desktop-plus`，软件更新不会丢失配置。

#### 内置更新与镜像加速
- 可在软件内点击 **GDP → 检查更新** 检测并下载最新版本。
- 下载线路支持 GitHub 直连与国内常见加速镜像（参考 [github.akams.cn](https://github.akams.cn/)），失败时自动降级切换。镜像设置仅对 Plus 自身的安装包下载生效。

### WSL 2

在 WSL 2 终端中运行单行脚本完成安装：

```bash
curl -fsSL https://raw.githubusercontent.com/sj817/github-desktop-plus/main/install.sh | bash
```

- 在 WSL 终端输入 `gdp` 即可启动并自动完成路径映射。
- 可选：设置环境变量 `GDP_DOWNLOAD_MIRROR=direct` 禁用镜像，或指定镜像域名（如 `gh-proxy.com`、`ghfast.top` 等）。

### 快捷键

- `Ctrl+Alt+G`：打开 / 关闭设置面板（或点击菜单栏 `GDP`）。

---

## 贡献语言包

GDP 底层具备完整的 i18n 拦截与热重载体系。目前官方内置 **简体中文 (`zh-CN`)**，欢迎社区贡献繁体中文、日语、韩语等其他语言。

### 通过内嵌界面贡献
1. 按下 `Ctrl+Alt+G` 打开设置，进入 **语言包** 页面。
2. 新建语言脚手架或导入已有 JSON 语言包。
3. 在界面中直接编辑并实时预览效果。
4. 导出 JSON 并向本仓库提交 Pull Request。

### 通过源码贡献
1. 参考 [`apps/gdp/resources/locales/zh-CN/`](apps/gdp/resources/locales/zh-CN) 中的分模块 JSON 文件。
2. 在 `apps/gdp/resources/locales/` 下新建对应语言目录（如 `ja-JP`、`zh-TW`）。
3. 翻译词条，运行 `pnpm locales:prepare <locale>` 验证后提交 PR。

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

## 免责声明

GitHub Desktop Plus 是一个独立的开源项目，与 GitHub, Inc. 或 Microsoft Corporation 无任何隶属、背书或关联关系。GitHub 与 GitHub Desktop 是 GitHub, Inc. 的注册商标。

GitHub Desktop 官方源码遵循 [MIT 许可证](https://github.com/desktop/desktop/blob/development/LICENSE)。

---

## 许可证

[MIT](LICENSE)
