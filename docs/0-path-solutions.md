# GitHub Desktop Plus — 0-Path Hook 方案集

> 0-Path = 不修改 GitHub Desktop 安装目录下的任何文件
>
> 目标路径: `C:\Users\Administrator\AppData\Local\GitHubDesktop\app-3.5.7\`
>
> Electron 40.1.0 | Chrome 144.0.7559.96 | Node 24.11.1
>
> Electron Fuses: `1,0,1,1,0,0,0,1`
> - [0] RunAsNode = ON
> - [1] EnableCookieEncryption = OFF
> - [2] EnableNodeOptionsEnvironmentVariable = ON (但被 C++ 层阻断)
> - [3] EnableNodeCliInspectArguments = ON
> - [4] EnableEmbeddedAsarIntegrityValidation = OFF
> - [5] OnlyLoadAppFromAsar = OFF
> - [6] LoadBrowserProcessSpecificV8Snapshot = OFF
> - [7] GrantFileProtocolExtraPrivileges = ON
>
> Renderer: nodeIntegration=true, contextIsolation=false, 无 asar

---

## 方案 A: V8 Inspector 注入 (已验证 ✅)

### 原理
通过 `--inspect=<port>` 启动 Electron，利用 Node.js V8 Inspector Protocol 的
`Runtime.evaluate` 在主进程中执行任意代码。

### 启动命令
```
app-3.5.7\GitHubDesktop.exe --inspect=9230 --remote-debugging-port=19222
```

### 注入流程
```
GDP CLI 启动 GH Desktop (带 --inspect + --remote-debugging-port)
  → 轮询 GET http://127.0.0.1:9230/json 直到返回
  → 提取 webSocketDebuggerUrl
  → WebSocket 连接
  → Runtime.enable
  → Runtime.evaluate(hookCode)  // 一次性注入全部 hook
```

### require 方式
- 闭包内: `process.mainModule.require('electron')`
- 顶层 eval (需 `includeCommandLineAPI: true`): `require('electron')`

### 验证结果 (2025-07)
| 能力 | 状态 |
|------|------|
| autoUpdater monkey-patch | ✅ |
| session.webRequest.onBeforeRequest | ✅ |
| Menu.buildFromTemplate 重写 | ✅ |
| BrowserWindow.getAllWindows() | ✅ |
| app.getVersion() / getName() | ✅ |
| webContents.executeJavaScript() → renderer | ✅ |
| app.on('browser-window-created') 事件 | ✅ |

### 优点
- 完全不修改任何安装文件
- 完整主进程+渲染进程访问能力
- 更新后无需重新打补丁
- 与正版安装 100% 文件一致

### 缺点
- hook 时机晚 (~2-3s)，启动阶段的 autoUpdater 调用可能已触发
- 监听端口 (127.0.0.1)，本机其他程序理论上可连接
- 需要 WebSocket 库支持 (Rust 侧: tungstenite / tokio-tungstenite)
- 注入窗口期：从端口就绪到 evaluate 完成之间可能有竞态

### Rust 实现要点
- 使用 `tungstenite` 或 `tokio-tungstenite` 连接 WebSocket
- hook 代码作为字符串嵌入二进制 (现有 `include_str!` 模式)
- 随机端口避免冲突: `--inspect=0` (然后从 stderr 解析实际端口)
- 连接后可断开，hook 代码已在 V8 堆中运行

---

## 方案 B: Inspector 早期注入 — inspect-brk + 断点 (已验证 ✅ 推荐)

### 原理

方案 A 的增强版。使用 `--inspect-brk` 暂停 Electron 启动，设断点在 main.js
第一行，注入 hook 后恢复执行。**hook 在 main.js 运行前生效**。

### 启动命令

```bash
app-3.5.7\GitHubDesktop.exe --inspect-brk=9230
```

### 注入流程

```text
GDP CLI 启动 GH Desktop (--inspect-brk=9230)
  → GET http://127.0.0.1:9230/json → webSocketDebuggerUrl
  → WebSocket 连接
  → Debugger.enable + Runtime.enable
  → Debugger.setBreakpointByUrl(url=".../main.js", lineNumber=0)
  → Runtime.runIfWaitingForDebugger  (恢复 V8 bootstrap)
  → 等待 Debugger.paused 事件 (main.js 首行命中断点)
  → Runtime.evaluate(hookCode)       (在 main.js 上下文中注入)
  → Debugger.removeBreakpoint + Debugger.resume
  → 断开 WebSocket
```

### 验证结果 (2025-07)

| 能力 | 状态 |
| ---- | ---- |
| main.js 执行前暂停 | ✅ reason=ambiguous |
| autoUpdater 预注入 | ✅ blocked:1 (拦截到一次调用) |
| 恢复后 app 正常运行 | ✅ ready=true, wins=1 |

### 优点

- 完全不修改任何安装文件
- **hook 在 main.js 执行前生效** — 解决方案 A 的时序问题
- 注入完成后断开 WebSocket，不需要持久连接
- 更新后无需重新打补丁

### 缺点

- 启动略慢 (暂停 + 注入 + 恢复 约增加 1-2 秒)
- 需要 WebSocket 库
- 端口监听安全性 (同方案 A)

---

## 方案 C: Shadow Directory — 影子目录 (已验证 ✅)

### 原理

在安装目录 **外部** 创建一个"影子"目录结构，通过 NTFS Junction 链接到
真实 Electron 文件，但用自定义 `main.js` 替换 `resources/app/main.js`。
从影子目录启动 Electron。原安装目录完全不动。

### 目录结构

```text
%TEMP%\gdp-shadow\
  ├── GitHubDesktop.exe        (复制)
  ├── *.dll, *.pak, ...        (复制)
  ├── locales\                 (junction → 原目录)
  └── resources\
      ├── Assets.car           (复制)
      └── app\
          ├── package.json     (复制)
          └── main.js          (自定义 wrapper!)
```

### wrapper main.js

```javascript
const { autoUpdater } = require('electron');
autoUpdater.checkForUpdates = () => {};  // hook
require('C:\\...\\app-3.5.7\\resources\\app\\main.js');  // 加载真实 app
```

### 验证结果

- 标记文件写入成功 ✅
- GH Desktop 正常启动 (4 个进程) ✅

### 优点

- 不修改安装目录
- hook 时机最早 (在 main.js 之前)
- 不需要 WebSocket / 端口监听
- 实现简单直接

### 缺点

- 需要复制/链接整个 Electron 运行时 (~200MB)
- 更新时需重建影子目录 (但可自动化)
- 路径感知: `__dirname`, `app.getPath()` 等可能指向影子目录
- Junction 创建可能需要管理员权限 (视 Windows 版本)

---

## 方案 D: ELECTRON_RUN_AS_NODE 自举 (已验证 ✅)

### 原理

利用 `ELECTRON_RUN_AS_NODE=1` 将 Electron 二进制当作 Node.js 运行器，
执行一个 launcher 脚本，该脚本通过 `child_process.spawn` 启动真正的
GH Desktop 并附加 `--inspect` 参数。

### 验证结果

- `ELECTRON_RUN_AS_NODE=1` 可执行任意 JS ✅ (Node v24.11.1)
- spawn 后的 GH Desktop 双端口正常工作 ✅

### 代码示例

```javascript
// launcher.js — 用 ELECTRON_RUN_AS_NODE=1 运行
const { spawn } = require('child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, ['--inspect=9230'], { env, detached: true });
child.unref();
```

### 优点

- 不修改安装目录
- 使用 GH Desktop 自身的二进制，无需外部 Node.js
- 可作为方案 A/B 的辅助启动方式

### 缺点

- 本身不是 hook 方案，只是启动方式
- 需要配合方案 A 或 B 才能完成 hook 注入

---

## 方案评估矩阵

| 方案 | 文件修改 | hook 时机 | 复杂度 | 端口暴露 | 推荐度 |
| ---- | -------- | --------- | ------ | -------- | ------ |
| A: Inspector 运行时注入 | 无 | 晚 (~3s) | 中 | 是 | ⭐⭐⭐ |
| B: Inspector 早期注入 | 无 | 最早 (main.js 前) | 中 | 是 | ⭐⭐⭐⭐⭐ |
| C: Shadow Directory | 无 (外部创建) | 最早 | 低 | 否 | ⭐⭐⭐⭐ |
| D: RUN_AS_NODE 自举 | 无 | N/A (辅助) | 低 | 否 | ⭐⭐⭐ |

---

## 已排除的方案

### ❌ NODE_OPTIONS=--require

- Electron Fuse `EnableNodeOptionsEnvironmentVariable` 虽为 ON
- 但 Electron 40 C++ 代码 (`shell/common/node_bindings.cc:483`) 硬编码阻断
- 错误: "Most NODE_OPTIONs are not supported in packaged apps"

### ❌ --require CLI 参数

- Electron packaged app 不处理 Node.js 的 --require 标志

### ❌ --app 重定向

- Electron packaged 模式忽略 --app 参数

### ❌ ELECTRON_EXTRA_LAUNCH_ARGS

- Electron 40 不读取此环境变量

### ❌ --load-extension (Chrome 扩展)

- Electron packaged app 忽略 Chrome 扩展加载标志

### ❌ NODE_PATH 模块路径劫持

- main.js 是 webpack bundle，不通过文件系统解析外部模块

### ❌ --inspect-brk 直接 eval

- V8 bootstrap 阶段暂停，`process`/`require` 均不可用
- 需要改用断点方式 (方案 B)

### ⚠️ IFEO 注册表 (未测试)

- `HKLM\...\Image File Execution Options\GitHubDesktop.exe\Debugger`
- 理论可行但需要管理员权限且修改系统注册表
- 可能被安全软件拦截

### ❌ 修改 main.js (非 0-path)

- 当前可工作方案，但修改了安装文件
- 更新后需重新打补丁
