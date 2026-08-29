# GitHub Desktop Plus

外部增强工具，在不修改 GitHub Desktop 源码的前提下扩展其功能。

基于 **Rust + 0-path Inspector 注入 + React 内嵌设置弹窗** 构建。

## 功能

- **禁用自动更新** — 阻止 autoUpdater 检查和安装更新，并接管 About 对话框中的"检查更新"入口
- **屏蔽遥测上报** — 拦截发往 central / usage / stats.github.com 的统计与异常上报
- **中文界面 (i18n)** — 通过菜单翻译和 DOM 文本替换实现 UI 中文化，语言包可导入 / 导出 / 切换
- **AI 提交信息** — 接管提交框的 Copilot 按钮，用任意 OpenAI 兼容接口生成提交信息（含连通性测试）
- **最近仓库增强** — 自定义"最近"列表条数（官方固定 3 个），支持仓库置顶
- **多个打开方式** — 官方右键菜单只能配一个编辑器 + 一个终端，GDP 可配置任意多个（VS Code / Cursor / Zed / JetBrains / WSL 等），并支持自动检测、排序、平铺或折叠为子菜单；原生条目保持不变
- **内嵌设置弹窗** — GDP 菜单或 `Ctrl+Alt+G` 打开：常规配置、打开方式、AI 接入、语言包管理、实时日志
- **全部设置热生效** — 开关与语言切换即时应用，无需重启 GitHub Desktop

## 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 运行时核心 | Rust (`gdp`) |
| Hook 注入 | V8 Inspector (`--inspect-brk`) |
| Hook 源码 | TypeScript |
| Hook 构建 | tsdown（Rolldown，main / early / renderer 三入口） |
| UI 构建 | Vite（library 模式，单文件 IIFE） |
| 设置弹窗 UI | React 19 + TypeScript + Tailwind CSS 4 + Base UI，Vite 打包 |
| 设置弹窗宿主 | 渲染进程内的薄壳（dialog + bridge），经 Electron IPC 与主进程通信 |
| 包管理 | pnpm |

## 当前结构

仓库采用 `apps/` + `packages/` + `crates/` 的分层布局，运行时目标如下：

- **运行时核心迁移到 Rust**，Node.js 仅保留为构建辅助
- **常驻内存目标 < 10MB**，优先压缩运行时和依赖树
- **启动速度优先**，避免多进程常驻和重型 JS runtime
- **跨平台**：Windows / macOS / Linux

当前主线拆分如下：

- `crates/gdp-core/`：纯 Rust 核心逻辑库
- `apps/gdp/`：CLI 入口 + 0-path 注入 + hook 资源内嵌
- `packages/hooks/`：独立 pnpm 包；Electron hook / preload 的 TypeScript 源码与 tsdown 配置
- `apps/settings-ui/`：设置弹窗的 React 应用，独立 Vite 包
- `packages/shared/`：主进程 / 弹窗外壳 / 设置 UI 共用的 IPC 契约

详细设计见：[`docs/architecture.md`](docs/architecture.md)

## 工作原理

```text
┌─────────────────────────┐      ┌──────────────────────────────┐
│  GitHub Desktop Plus    │      │  GitHub Desktop (Electron)   │
│  (Rust gdp binary)      │      │                              │
│                         │      │  ┌──────────────────────┐    │
│  ┌───────────────┐      │ CDP  │  │ Hook Scripts (CJS)   │    │
│  │ Inspector     │─────→│─────→│  │ • update blocker     │    │
│  │ injector      │      │      │  │ • telemetry blocker  │    │
│  ├───────────────┤      │      │  │ • menu & UI i18n     │    │
│  │ Config +      │      │      │  │ • AI commit hijack   │    │
│  │ hook assets   │      │      │  │ • settings dialog    │    │
│  └───────────────┘      │      │  │ • IPC bridge         │    │
└─────────────────────────┘      │  └──────────────────────┘    │
                                 └──────────────────────────────┘
```

GDP 使用 `--inspect-brk=0` 启动 GitHub Desktop，连接 V8 Inspector 后在 `main.js` 执行前注入 hook，
从而实现 **0-path** 更新拦截、遥测屏蔽、菜单注入和渲染进程 i18n。配置读写、语言包管理、日志流与
AI 请求全部经 Electron IPC 在注入的主进程 hook 内完成，不依赖本地 HTTP 服务。

## 设置弹窗架构

设置界面是一个独立的 React 应用（`apps/settings-ui`），渲染进程里只留一层薄壳负责创建 `<dialog>`、
挂载/卸载和桥接 IPC。开发和生产走同一份 UI 代码、同一个 `GDPBridge` 接口，业务代码不知道自己
运行在哪一侧：

```text
生产          React ──▶ GDPBridge ──▶ ipcRenderer ──▶ 主进程 hook
开发（iframe）React ──▶ GDPBridge ──▶ postMessage ──▶ 弹窗外壳 ──▶ ipcRenderer ──▶ 主进程 hook
```

- **生产**：Vite 以 library 模式打出单文件 IIFE（CSS 内联），随其他 preload 一起注入，
  `window.__GDP_SETTINGS_UI__.mount(root, bridge)` 直接挂载到 `<dialog>` 里，不用 iframe、
  不起本地服务、不依赖开发服务器。
- **开发**：`scripts/dev.ts` 顺带拉起 Vite，弹窗改为加载 `http://127.0.0.1:5273` 的 iframe。
  iframe 没有任何 Electron 权限，只能通过 postMessage RPC 说话；外壳会校验来源窗口、来源
  origin、协议标记和信道白名单（由 `@github-desktop-plus/shared` 提供）后才转发给 `ipcRenderer`。
- 改 `apps/settings-ui/**` 只走 Vite HMR，不重启 GDP / GitHub Desktop；改 `packages/hooks/**`、
  `packages/shared/**` 或 Rust 才触发原来的重启流程。

## 快速开始

```bash
# 安装依赖（pnpm workspace，会一并安装 settings-ui 与 hooks）
pnpm install

# 开发模式（Vite + hook 构建 + 语言包，启动 GDP + GitHub Desktop）
pnpm dev

# 只跑设置界面的 Vite dev server
# 浏览器直接打开 http://127.0.0.1:5273/?mock=1 可脱离 GitHub Desktop 预览界面
#（内存 mock 桥；加 &theme=dark 看深色，&scenario=empty 看空状态）
pnpm --filter @github-desktop-plus/settings-ui dev

# 类型检查（hooks + 设置界面）
pnpm run typecheck

# 构建发布版二进制（设置 UI → hook bundle → Rust）
pnpm run build

# 运行桌面自检
pnpm run self-check:desktop
```

## 项目结构

```text
apps/
├── gdp/              # Rust CLI：注入、启动、hook 资源内嵌
│   └── resources/    # 语言包源与 GitHub Desktop 字符串目录
├── settings-ui/      # 设置弹窗的 React 应用（Vite + Tailwind + Base UI）
│   └── src/
│       ├── bridge/   # GDPBridge 的 iframe 实现与 React context
│       ├── pages/    # 常规 / 打开方式 / AI / 语言包 / 日志
│       └── mount.tsx # 生产入口：mount(root, bridge)
└── site/             # GitHub Pages 落地页
crates/
└── gdp-core/         # Rust 核心库：配置、探测、运行时元数据
packages/
├── hooks/            # 私有 npm 包（tsdown 三入口构建）
│   ├── package.json
│   ├── tsdown.config.ts
│   └── src/
│       ├── ipc.ts        # IPC 桥：配置 / 语言包 / 日志 / AI
│       ├── entries/      # main / early / renderer 打包入口
│       └── preload/
│           └── gdp-dialog/   # 设置弹窗外壳：dialog、bridge、dev RPC host
└── shared/           # 私有 source package：三方共用的 IPC 契约与类型
scripts/              # 受 TypeScript 严格检查的全部 Node 自动化
├── dev.ts            # 开发编排：Vite + 监听重启 + 拉起 GDP
├── locales.ts        # 严格校验语言源，并为 dev 热更新做内存聚合
├── checks/           # 源码策略与桌面自检
├── i18n/             # 字符串提取与版本 diff
└── mock/             # 本地测试服务
docs/                 # 跨应用的架构和调研文档
```

开发约定见 [`CLAUDE.md`](CLAUDE.md)。

## 文档

- [架构设计](docs/architecture.md)
- [0-path Hook 方案集](docs/0-path-solutions.md)
- [WSL 仓库支持可行性调研](docs/wsl-support-feasibility.md)

## 免责声明

本项目是社区第三方工具，与 GitHub, Inc. 无任何关联，亦未获其背书。
GitHub 与 GitHub Desktop 是 GitHub, Inc. 的商标。本工具不分发、不修改
GitHub Desktop 的安装文件，仅在本机运行时通过官方调试接口注入增强逻辑；
GitHub Desktop 本身以 [MIT 许可证](https://github.com/desktop/desktop/blob/development/LICENSE) 发布。

## License

[MIT](LICENSE)
