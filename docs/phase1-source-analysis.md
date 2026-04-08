# 阶段 1：GitHub Desktop 源码分析

> 基于 GitHub Desktop 源码（Electron 40.1.0）的结构化分析

---

## 1. 应用架构概览

| 项目 | 值 |
|---|---|
| 打包工具 | `electron-packager` v17.1.1 |
| 安装程序 (Windows) | `electron-winstaller` (Squirrel.Windows) |
| Electron 版本 | 40.1.0 |
| **ASAR** | **已禁用** (`asar: false`) |
| 应用入口 | `resources/app/main.js` |
| nodeIntegration | `true` |
| contextIsolation | `false` |
| preload 脚本 | **不存在** |

**关键发现：asar 未启用，应用代码以普通文件形式存在于 `resources/app/` 目录，这大幅降低了外部注入的难度。**

---

## 2. 自动更新系统

### 2.1 核心架构

更新系统基于 Electron 内置 `autoUpdater`（底层 Squirrel.Mac / Squirrel.Windows），不使用 `electron-updater`。

```
Renderer: UpdateStore → IPC 'check-for-updates' → Main: AppWindow → autoUpdater → central.github.com
```

### 2.2 关键文件

| 文件 | 作用 |
|---|---|
| `app/src/main-process/app-window.ts` | autoUpdater 事件监听、检查/安装执行 |
| `app/src/main-process/main.ts` | IPC handler 注册 |
| `app/src/ui/lib/update-store.ts` | 渲染进程更新状态机（`UpdateStore` 类） |
| `app/src/ui/app.tsx` | 定时检查调度（每 4 小时） |
| `app/src/main-process/squirrel-updater.ts` | Windows Squirrel 生命周期事件 |
| `app/src/lib/feature-flag.ts` | x64→ARM64 迁移特性标志 |

### 2.3 更新端点

```
https://central.github.com/api/deployments/desktop/desktop/{arch}/latest?version={v}&env={channel}
```

### 2.4 关键函数

| 函数 | 位置 | 作用 |
|---|---|---|
| `AppWindow.setupAutoUpdater()` | app-window.ts | 注册 autoUpdater 事件 |
| `AppWindow.checkForUpdates(url)` | app-window.ts | 设置 feedURL 并触发检查 |
| `UpdateStore.checkForUpdates()` | update-store.ts | 渲染进程触发检查入口 |
| `App.checkForUpdates()` | app.tsx | 定时检查调度 |

### 2.5 触发条件

- **自动**：每 4 小时，仅在 `production` / `beta` 频道
- **手动**：About 对话框 "Check for Updates" 按钮
- **排除**：Linux 和 development 频道不检查

---

## 3. 遥测/分析系统

### 3.1 核心架构

使用自建遥测系统（**非 Sentry**），所有数据上报到 `central.github.com`。

### 3.2 HTTP 端点

| 端点 | 用途 |
|---|---|
| `https://central.github.com/api/usage/desktop` | 日常使用统计 |
| `https://central.github.com/api/desktop/exception` | 致命异常 |
| `https://central.github.com/api/desktop-non-fatal/exception` | 非致命异常 |

### 3.3 关键文件

| 文件 | 作用 |
|---|---|
| `app/src/lib/stats/stats-store.ts` | 核心统计收集、聚合、上报 |
| `app/src/lib/stats/stats-database.ts` | IndexedDB 数据库（Dexie） |
| `app/src/main-process/exception-reporting.ts` | 异常上报 |
| `app/src/lib/helpers/non-fatal-exception.ts` | 非致命异常（限流60s/次） |

### 3.4 数据流

1. 各处通过 `statsStore.increment(key)` 记录操作计数 → IndexedDB
2. `getDailyStats()` 聚合 130+ 指标为 JSON payload
3. 每 24 小时 POST 到 `central.github.com/api/usage/desktop`
4. 异常实时 POST 到对应端点

### 3.5 已有退出机制

- UI: Preferences → Advanced → 取消勾选 "Help GitHub Desktop improve"
- localStorage key: `stats-opt-out`
- **注意：致命异常上报不检查 opt-out 状态，始终上报**

---

## 4. 日志系统

### 4.1 架构

| 组件 | 说明 |
|---|---|
| 日志库 | **winston** |
| 文件 Transport | `DesktopFileTransport` — 按日轮转，保留 14 天 |
| 控制台 Transport | 开发环境 `debug` 级、生产环境 `error` 级 |
| 渲染进程 | 通过 IPC `log` 通道桥接到主进程 |

### 4.2 关键文件

| 文件 | 作用 |
|---|---|
| `app/src/main-process/log.ts` | winston 初始化 |
| `app/src/main-process/desktop-file-transport.ts` | 文件写入（日轮转） |
| `app/src/main-process/desktop-console-transport.ts` | 控制台输出 |
| `app/src/lib/logging/renderer/install.ts` | 渲染进程日志安装 |
| `app/src/lib/logging/get-log-path.ts` | 日志目录路径 |

### 4.3 日志路径

- **Windows**: `%APPDATA%\GitHub Desktop\logs\`
- **macOS**: `~/Library/Application Support/GitHub Desktop/logs/`
- **文件名格式**: `YYYY-MM-DD.desktop.{channel}.log`

---

## 5. UI 渲染层

### 5.1 技术栈

- **React 16.x** + `ReactDOM.render()`
- 单向数据流：`AppStore` → `Dispatcher` → 组件
- Webpack 多入口：`main`, `renderer`, `crash`, `cli`, `highlighter`

### 5.2 i18n 支持

**不存在任何国际化支持**：
- 所有 UI 字符串为硬编码英文
- 无 i18n 库依赖
- 无翻译文件
- 无字符串常量集中管理

### 5.3 IPC 通道（核心）

| 通道 | 方向 | 用途 |
|---|---|---|
| `check-for-updates` | R→M | 触发更新检查 |
| `quit-and-install-updates` | R→M | 安装更新 |
| `log` | R→M | 日志桥接 |
| `send-non-fatal-exception` | R→M | 异常上报 |
| `auto-updater-*` | M→R | 更新状态回调 |

---

## 6. 对外部注入的关键利好

1. **`asar: false`** — 应用代码直接可访问和修改
2. **`nodeIntegration: true`** — 渲染进程有完整 Node.js 权限
3. **`contextIsolation: false`** — 无 contextBridge 隔离
4. **无 preload 脚本** — 可自由注入 preload
5. **无代码签名校验** — 修改文件后不会被检测
6. **所有遥测走 HTTPS** — 可通过网络层/DNS/hosts 拦截
