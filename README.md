# GitHub Desktop Plus

外部增强工具，在不修改 GitHub Desktop 源码的前提下扩展其功能。

基于 **Electrobun + Vue 3 + TypeScript** 构建的桌面客户端。

## 功能

- **禁用自动更新** — 阻止 autoUpdater 检查和安装更新
- **屏蔽遥测上报** — 拦截统计数据和异常上报到 central.github.com
- **日志过滤** — 控制日志级别，减少无用输出
- **中文界面 (i18n)** — 通过 DOM 文本替换实现 UI 中文化
- **图形化控制面板** — Electrobun 原生窗口 + Vue 3 界面

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Electrobun](https://github.com/nicehash/electrobun) (Bun + 原生 WebView) |
| 前端 | Vue 3 + Vite + TypeScript |
| 主进程 | Bun (Electrobun runtime) |
| Hook 注入 | Node.js CJS (运行在 Electron 内部) |
| 进程间通信 | Electrobun RPC (类型安全) |

## 工作原理

```
┌─────────────────────────┐      ┌──────────────────────────────┐
│  GitHub Desktop Plus    │      │  GitHub Desktop (Electron)   │
│  (Electrobun 客户端)    │      │                              │
│                         │      │  ┌──────────────────────┐    │
│  ┌───────┐  ┌────────┐ │spawn │  │ Hook Scripts (CJS)   │    │
│  │ Bun   │──│ Vue 3  │ │─────→│  │ • update-blocker     │    │
│  │ Main  │  │ WebView│ │      │  │ • telemetry-blocker  │    │
│  └───────┘  └────────┘ │      │  │ • log-filter         │    │
│       ↕ RPC            │      │  │ • preload-injector   │    │
└─────────────────────────┘      │  └──────────────────────┘    │
                                 └──────────────────────────────┘
```

GDP 客户端通过 `NODE_OPTIONS=--require hook.js` 环境变量启动 GitHub Desktop，
hook 脚本在 Electron 主进程加载前执行，monkey-patch `autoUpdater`、网络请求和 `BrowserWindow`。

## 快速开始

```bash
# 安装依赖 (需要 Bun)
bun install

# 构建 hook 脚本
bun run build:hooks

# 开发模式 (HMR)
bun run dev:hmr

# 生产构建
bun run build:release
```

## 项目结构

```
src/
├── bun/              # Electrobun 主进程 (Bun runtime)
│   └── index.ts      # 窗口创建、RPC 处理、进程管理
├── mainview/         # Vue 3 前端
│   ├── App.vue       # 主界面
│   ├── main.ts       # Vue 入口
│   ├── electroview.ts # Electrobun 浏览器端 RPC
│   └── components/
│       ├── SettingsPanel.vue  # 设置面板
│       └── StatusBar.vue      # 状态栏
├── hooks/            # Electron 注入脚本 (Node.js CJS)
│   ├── index.ts      # Hook 入口
│   ├── update-blocker.ts
│   ├── telemetry-blocker.ts
│   ├── log-filter.ts
│   ├── preload-injector.ts
│   └── preload/
│       └── index.ts  # i18n DOM 替换引擎
└── shared/           # 共享类型定义
    ├── types.ts      # RPC schema、配置类型
    └── platform.ts   # 平台检测
locales/
└── zh-CN.json        # 中文翻译
```

## 文档

- [阶段 1：源码分析](docs/phase1-source-analysis.md)
- [阶段 2：可行性分析](docs/phase2-feasibility.md)
- [阶段 3：架构设计](docs/phase3-architecture.md)
- [阶段 4：实现说明](docs/phase4-implementation.md)

## License

MIT
