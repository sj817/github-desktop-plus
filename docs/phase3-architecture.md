# 阶段 3：架构设计

> github-desktop-plus 整体架构与模块划分

---

## 1. 项目定位

github-desktop-plus 是一个 **外部增强工具**，通过启动包装器 + 运行时注入的方式，在不修改 GitHub Desktop 源码的前提下扩展其功能。

## 2. 目录结构

```text
github-desktop-plus/
├── package.json
├── tsconfig.json
├── config/
│   └── default.json          # 默认配置
├── src/
│   ├── cli/
│   │   └── index.ts          # CLI 入口（启动包装器）
│   ├── hook/
│   │   ├── index.ts          # --require 入口（主进程 hook）
│   │   ├── update-blocker.ts # 禁用自动更新
│   │   ├── telemetry-blocker.ts # 拦截遥测
│   │   ├── log-filter.ts     # 日志过滤
│   │   └── preload-injector.ts # preload 注入器
│   ├── preload/
│   │   ├── index.ts          # preload 入口（渲染进程）
│   │   └── i18n/
│   │       ├── engine.ts     # i18n 替换引擎
│   │       └── locales/      # 翻译文件
│   │           └── zh-CN.json
│   └── shared/
│       ├── config.ts         # 配置加载
│       ├── logger.ts         # 自有日志
│       └── platform.ts       # 跨平台路径检测
├── dist/                     # 编译输出
├── docs/
└── locales/                  # 翻译资源（用户可扩展）
    └── zh-CN.json
```

## 3. 启动流程

```text
用户执行: gdp launch (或点击快捷方式)
    │
    ▼
┌──────────────────────┐
│   CLI (src/cli/)     │
│   1. 加载配置         │
│   2. 定位 GH Desktop │
│   3. 构建启动参数     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  spawn GitHubDesktop.exe                 │
│    --require=<dist/hook/index.js>        │
│    [--proxy-server=127.0.0.1:port]       │
└──────────┬───────────────────────────────┘
           │
           ▼ (主进程启动前)
┌──────────────────────────────────────────┐
│  hook/index.js (--require 加载)          │
│  1. 读取配置                              │
│  2. update-blocker: patch autoUpdater    │
│  3. telemetry-blocker: 拦截 HTTP 请求     │
│  4. log-filter: patch winston transport  │
│  5. preload-injector: hook BrowserWindow │
└──────────┬───────────────────────────────┘
           │
           ▼ (原始 main.js 执行)
┌──────────────────────────────────────────┐
│  GitHub Desktop main process             │
│  (autoUpdater 已被替换为 noop)            │
│  (HTTP 请求已被拦截)                       │
└──────────┬───────────────────────────────┘
           │
           ▼ (BrowserWindow 创建时)
┌──────────────────────────────────────────┐
│  preload/index.js (注入的 preload)        │
│  1. 等待 DOM ready                        │
│  2. i18n engine: MutationObserver 监听    │
│  3. 文本替换（基于翻译字典）               │
└──────────────────────────────────────────┘
```

## 4. 模块设计

### 4.1 CLI 模块 (`src/cli/`)

职责：
- 解析命令行参数
- 自动检测 GitHub Desktop 安装路径
- 构建 Electron 启动参数
- 启动 GitHub Desktop 子进程

命令设计：

```text
gdp launch              # 启动增强版 GitHub Desktop
gdp launch --no-update  # 仅禁用更新
gdp launch --no-telemetry  # 仅禁用遥测
gdp config set <key> <value>  # 修改配置
gdp config get <key>    # 查看配置
gdp config reset        # 恢复默认配置
gdp status              # 显示当前状态/版本信息
```

### 4.2 Hook 模块 (`src/hook/`)

#### update-blocker.ts

```text
策略：替换 electron.autoUpdater 为 noop 实现
触发点：Module._load hook，拦截 'electron' 模块
效果：
  - autoUpdater.checkForUpdates() → 无操作
  - autoUpdater.setFeedURL() → 无操作
  - 定时检查不再触发网络请求
```

#### telemetry-blocker.ts

```text
策略：多层拦截
  层 1: 拦截 net/https 模块的 request()，过滤目标域名/路径
  层 2: 替换 electron 的 net.request()
  层 3: (可选) 替换 fetch()
目标端点：
  - central.github.com/api/usage/*
  - central.github.com/api/desktop/exception
  - central.github.com/api/desktop-non-fatal/*
效果：
  - 上述请求返回空 200 响应（不报错）
  - 不影响其他正常网络请求
```

#### log-filter.ts

```text
策略：hook winston 的 transport
  - 可配置日志级别过滤
  - 可配置关键字过滤
效果：
  - 减少无用日志写入
  - 文件 transport 可选择性禁用
```

#### preload-injector.ts

```text
策略：拦截 BrowserWindow 构造函数
  - 在 webPreferences 中注入 preload 脚本路径
  - 由于 contextIsolation: false，preload 与页面共享上下文
效果：
  - 每个 BrowserWindow 自动加载我们的 preload
```

### 4.3 Preload 模块 (`src/preload/`)

#### i18n Engine

```text
策略：
  1. 加载翻译字典 (zh-CN.json)
  2. DOMContentLoaded 后遍历 DOM 文本节点，批量替换
  3. MutationObserver 监听 DOM 变更，对新增/修改节点实时替换
  4. 特殊处理：
     - placeholder / title / aria-label 等属性
     - React 动态渲染的文本
     - 菜单标签（通过 IPC hook）

翻译字典格式：
{
  "Changes": "更改",
  "History": "历史",
  "Commit to **{branch}**": "提交到 **{branch}**",
  "No local changes": "没有本地更改",
  ...
}
```

### 4.4 配置系统 (`src/shared/config.ts`)

配置文件位置：
- Windows: `%APPDATA%\github-desktop-plus\config.json`
- macOS: `~/Library/Application Support/github-desktop-plus/config.json`

默认配置：

```json
{
  "updates": {
    "disabled": true
  },
  "telemetry": {
    "disabled": true,
    "blockExceptions": true,
    "blockedEndpoints": [
      "central.github.com/api/usage",
      "central.github.com/api/desktop/exception",
      "central.github.com/api/desktop-non-fatal"
    ]
  },
  "logging": {
    "level": "warn",
    "disableFileLog": false
  },
  "i18n": {
    "enabled": true,
    "locale": "zh-CN"
  },
  "desktop": {
    "path": "auto"
  }
}
```

### 4.5 平台检测 (`src/shared/platform.ts`)

自动检测 GitHub Desktop 安装路径：

```text
Windows:
  1. %LOCALAPPDATA%\GitHubDesktop\GitHubDesktop.exe
  2. 注册表 HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\GitHubDesktop

macOS:
  1. /Applications/GitHub Desktop.app
  2. ~/Applications/GitHub Desktop.app
```

## 5. 扩展性设计

### 插件接口（预留）

```typescript
interface GDPPlugin {
  readonly name: string
  onMainProcessHook?(electron: typeof Electron): void
  onPreload?(window: Window): void
  onConfig?(config: GDPConfig): void
}
```

未来可通过 `plugins/` 目录或 npm 包加载第三方插件。MVP 阶段暂不实现插件系统，但模块化设计保证可扩展。

## 6. 技术选型

| 组件 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript | 类型安全，与目标项目一致 |
| 构建 | esbuild / tsup | 快速，输出单文件 bundle |
| CLI 框架 | commander | 轻量，成熟 |
| 配置 | cosmiconfig 或自己实现 | JSON 配置 + 环境变量 |
| 运行时 | Node.js >= 18 | Electron 40 内置 Node 22 |
