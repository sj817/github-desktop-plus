# GitHub Desktop Plus

外部增强工具，在不修改 GitHub Desktop 源码的前提下扩展其功能。

基于 **Rust + 0-path Inspector 注入 + 无框架 WebUI** 构建。

## 功能

- **禁用自动更新** — 阻止 autoUpdater 检查和安装更新
- **拦截手动更新按钮** — 接管 About 对话框中的“检查更新”入口
- **屏蔽遥测上报** — 拦截统计数据和异常上报到 central.github.com
- **日志过滤** — 控制日志级别，减少无用输出
- **中文界面 (i18n)** — 通过菜单翻译和 DOM 文本替换实现 UI 中文化
- **本地控制面板** — 由 GDP 内置的 `http://127.0.0.1:7788` WebUI 提供

## 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 运行时核心 | Rust (`gdp`) |
| Hook 注入 | V8 Inspector (`--inspect-brk`) |
| Hook 源码 | TypeScript |
| Hook 构建 | Node.js + esbuild |
| 控制面板 | Static HTML + CSS + JavaScript |
| 包管理 | pnpm |

## 当前结构

当前源码已经统一收敛到 `src/` 下，运行时目标如下：

- **运行时核心迁移到 Rust**，Node.js 仅保留为可选构建辅助
- **常驻内存目标 < 10MB**，优先压缩运行时和依赖树
- **启动速度优先**，避免多进程常驻和重型 JS runtime
- **跨平台**：Windows / macOS / Linux

当前主线拆分如下：

- `gdp-core`：纯 Rust 核心逻辑库
- `gdp`：CLI 入口 + 0-path 注入 + 内置本地 Web 控制面板
- `src/hooks/`：Electron hook / preload 的 TypeScript 源码
- `src/ui/`：无框架静态前端

详细设计见：[`docs/phase5-rust-architecture.md`](docs/phase5-rust-architecture.md)

## 工作原理

```text
┌─────────────────────────┐      ┌──────────────────────────────┐
│  GitHub Desktop Plus    │      │  GitHub Desktop (Electron)   │
│  (Rust gdp binary)      │      │                              │
│                         │      │  ┌──────────────────────┐    │
│  ┌───────────────┐      │ CDP  │  │ Hook Scripts (CJS)   │    │
│  │ Inspector     │─────→│─────→│  │ • update blocker     │    │
│  │ injector      │      │      │  │ • telemetry blocker  │    │
│  ├───────────────┤      │      │  │ • menu i18n          │    │
│  │ WebUI server  │      │      │  │ • renderer preload   │    │
│  └───────────────┘      │      │  └──────────────────────┘    │
└─────────────────────────┘      └──────────────────────────────┘
```

GDP 使用 `--inspect-brk=0` 启动 GitHub Desktop，连接 V8 Inspector 后在 `main.js` 执行前注入 hook，
从而实现 **0-path** 更新拦截、遥测屏蔽、菜单注入和渲染进程 i18n。

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式（启动 GDP + GitHub Desktop）
pnpm run gdp:dev

# 构建发布版二进制
pnpm run build

# 运行桌面自检
pnpm run self-check:desktop
```

## 项目结构

```text
src/
├── core/             # Rust 核心库：配置、探测、运行时元数据
├── gdp/              # Rust CLI：注入、启动、停止、WebUI 服务
├── hooks/            # Electron 注入脚本与 preload 源码 (TypeScript)
│   └── preload/
└── ui/               # 无框架 Web 控制面板
scripts/
└── build-hooks.mjs   # 使用 esbuild 生成 hook bundle
locales/
└── zh-CN/
    ├── menu.json
    └── ui.json
```

## 文档

- [阶段 1：源码分析](docs/phase1-source-analysis.md)
- [阶段 2：可行性分析](docs/phase2-feasibility.md)
- [阶段 3：架构设计](docs/phase3-architecture.md)
- [阶段 4：实现说明](docs/phase4-implementation.md)
- [阶段 5：Rust 底层重构设计](docs/phase5-rust-architecture.md)

## License

MIT
