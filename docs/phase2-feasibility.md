# 阶段 2：可行性分析

> 在"不修改 GitHub Desktop 源码"前提下的扩展手段评估

---

## 方案总览

| # | 方案 | 可行性 | 风险 | 推荐度 |
| --- | --- | --- | --- | --- |
| A | 启动包装器 + Electron 参数注入 | ★★★★★ | 低 | **首选** |
| B | runtime patch（直接修改 resources/app/） | ★★★★★ | 中 | **备选** |
| C | 网络层拦截（hosts/proxy） | ★★★★☆ | 低 | 辅助 |
| D | require hook / module hijacking | ★★★☆☆ | 中 | 部分场景 |
| E | preload 注入 | ★★★★☆ | 低 | i18n 首选 |

---

## 方案 A：启动包装器 + Electron 参数注入（首选）

### 原理

创建一个包装可执行文件（CLI），替代直接启动 `GitHubDesktop.exe`。包装器：

1. 定位 GitHub Desktop 的 Electron 可执行文件
2. 注入 `--require` 参数，让 Electron 在主进程启动前加载我们的 hook 脚本
3. 可选：设置环境变量来控制行为

Electron 支持 `--require` 参数（继承自 Node.js），会在主进程 `main.js` 执行前先 `require()` 指定模块。

### 启动命令示例

```bash
# Windows
"C:\Users\xxx\AppData\Local\GitHubDesktop\app-x.x.x\GitHubDesktop.exe" \
  --require="C:\path\to\github-desktop-plus\dist\hook.js"

# macOS
"/Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop" \
  --require="/path/to/github-desktop-plus/dist/hook.js"
```

### 可行性：★★★★★

- Electron 原生支持 `--require`
- GitHub Desktop 的 `asar: false` 意味着不需要额外解包
- `nodeIntegration: true` 使得渲染进程也可被完全控制
- hook 脚本在 main.js 之前执行，可以 monkey-patch 任何模块

### 风险

- **低**：不修改任何原始文件
- GitHub Desktop 更新后包装器仍然有效（只要 Electron 架构不变）
- 唯一风险：Electron 移除 `--require` 参数（极不可能）

### 跨平台兼容性

- **Windows**: ✅ 完全支持
- **macOS**: ✅ 完全支持
- **Linux**: ✅ 完全支持

### hook.js 能做什么

由于在主进程加载前执行，可以：

1. **Monkey-patch `electron` 模块**：替换 `autoUpdater`、拦截 `BrowserWindow` 创建
2. **拦截 `require()`**：替换任何 Node.js 模块的行为
3. **修改环境变量**：影响后续加载的模块
4. **注入 preload 脚本**：拦截 `BrowserWindow` 构造，向 `webPreferences` 中注入 `preload`

---

## 方案 B：Runtime Patch（直接修改 resources/app/）

### 原理

因为 `asar: false`，应用代码以普通 JS 文件存在于：

- Windows: `%LOCALAPPDATA%\GitHubDesktop\app-x.x.x\resources\app\`
- macOS: `/Applications/GitHub Desktop.app/Contents/Resources/app/`

可以直接修改这些文件实现 patch。

### 可行性：★★★★★

- 技术上完全可行，就是编辑 JS 文件
- 可以精确修改任何功能

### 风险

- **中**：每次 GitHub Desktop 更新后，patch 会被覆盖，需要重新应用
- 需要维护 patch 脚本，随版本迭代更新
- 如果 patch 出错，应用可能无法启动（需要备份/回滚机制）

### 跨平台兼容性

- **Windows**: ✅（需要管理员权限写入 AppData）
- **macOS**: ✅（可能需要 sudo）

### 实施方式

```
github-desktop-plus patch apply   # 备份原文件，应用 patch
github-desktop-plus patch revert  # 恢复原始文件
github-desktop-plus patch status  # 检查 patch 状态
```

---

## 方案 C：网络层拦截

### 原理

通过 hosts 文件、本地代理或 DNS 拦截，阻止遥测数据发送。

### 目标域名

```text
central.github.com    # 所有遥测、异常上报、更新检查
```

### 实施方式

**方式 1：hosts 文件**

```text
# 在 hosts 文件中添加
127.0.0.1 central.github.com
```

- 优点：简单、系统级
- 缺点：会同时阻断更新检查，过于粗暴

**方式 2：本地透明代理**

启动一个本地 HTTP/HTTPS 代理，选择性拦截特定路径：

- 放行：`/api/deployments/` (如果需要更新)
- 拦截：`/api/usage/`、`/api/desktop/exception`、`/api/desktop-non-fatal/`

**方式 3：Electron `--proxy-server` 参数**

```bash
GitHubDesktop.exe --proxy-server="http://127.0.0.1:8899"
```

### 可行性：★★★★☆

- hosts 方式简单但不灵活
- 代理方式灵活但增加复杂度
- 可与方案 A 组合使用

### 风险

- **低**：不修改应用文件
- hosts 方式可能影响其他 GitHub 服务

### 跨平台兼容性

- **Windows**: ✅
- **macOS**: ✅
- **Linux**: ✅

---

## 方案 D：require hook / Module Hijacking

### 原理

通过 Node.js 的 `Module._resolveFilename` 或 `Module._load` hook，在模块加载时替换特定模块。

```javascript
const Module = require('module')
const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
  if (request === 'electron') {
    const electron = originalLoad.apply(this, arguments)
    // 替换 autoUpdater
    electron.autoUpdater = createNoopUpdater()
    return electron
  }
  return originalLoad.apply(this, arguments)
}
```

### 可行性：★★★☆☆

- 需要配合方案 A（通过 `--require` 加载 hook）
- 对 Electron 内部模块的 hook 可能不完全生效（部分 Electron API 是 C++ binding）

### 风险

- **中**：Electron 内部模块加载机制可能绕过 Node.js Module 系统

### 跨平台兼容性

- 与方案 A 相同

---

## 方案 E：Preload 注入

### 原理

通过方案 A 的 hook，在 `BrowserWindow` 创建时注入自定义 preload 脚本。

由于 GitHub Desktop 的 `contextIsolation: false` + `nodeIntegration: true`，preload 脚本拥有与渲染进程相同的完整权限，可以：

1. **DOM 操作**：替换 UI 文本（i18n）
2. **拦截 IPC**：阻止特定 IPC 消息
3. **修改全局对象**：替换 `window.fetch`、`XMLHttpRequest` 等

### 实施方式

在方案 A 的 hook.js 中：

```javascript
const { BrowserWindow } = require('electron')
const originalConstructor = BrowserWindow
// 拦截 BrowserWindow 创建，注入 preload
```

### 可行性：★★★★☆

- 对 UI 修改（i18n）非常合适
- 需要配合方案 A 使用

### 风险

- **低**：preload 在渲染进程中运行，不影响主进程
- React 虚拟 DOM 会重新渲染，可能覆盖 DOM 修改（需要 MutationObserver）

### 跨平台兼容性

- 与方案 A 相同

---

## 推荐组合策略

```text
┌─────────────────────────────────────────────┐
│           github-desktop-plus CLI            │
│                                              │
│  方案 A（启动包装器）                         │
│    ├── --require hook.js                     │
│    │   ├── autoUpdater monkey-patch (更新)   │
│    │   ├── Module._load hook (遥测/日志)     │
│    │   └── BrowserWindow hook → preload 注入 │
│    │       └── i18n DOM 替换                 │
│    └── 可选：--proxy-server (网络层拦截)       │
│                                              │
│  方案 C（网络层）作为补充                      │
│    └── 拦截 central.github.com 特定路径       │
└─────────────────────────────────────────────┘
```

**核心思路：以方案 A 为主干，方案 E 处理 UI 层，方案 C 作为网络层补充。**
