# 阶段 4：MVP 实现说明

> 最小可行实现的使用指南与代码说明

---

## 1. 快速开始

```bash
cd github-desktop-plus

# 安装依赖
npm install

# 构建
npm run build

# 检测 GitHub Desktop 安装
node dist/cli/index.js detect

# 启动增强版
node dist/cli/index.js launch
```

全局安装后可直接使用 `gdp` 命令：

```bash
npm link
gdp launch
```

## 2. 项目结构与文件说明

```text
github-desktop-plus/
├── package.json              # 项目配置
├── tsconfig.json             # TypeScript 配置
├── tsup.config.ts            # 构建配置（3个入口：cli/hook/preload）
├── config/
│   └── default.json          # 默认配置
├── locales/
│   └── zh-CN.json            # 中文翻译字典（~100 条）
├── src/
│   ├── cli/index.ts          # CLI 入口 — 启动包装器
│   ├── hook/
│   │   ├── index.ts          # --require 入口
│   │   ├── update-blocker.ts # 更新拦截
│   │   ├── telemetry-blocker.ts  # 遥测拦截
│   │   ├── log-filter.ts     # 日志过滤
│   │   └── preload-injector.ts   # preload 注入
│   ├── preload/
│   │   ├── index.ts          # preload 入口
│   │   └── i18n/engine.ts    # i18n 替换引擎
│   └── shared/
│       ├── config.ts         # 配置加载/保存
│       └── platform.ts       # 平台路径检测
└── docs/                     # 分析与设计文档
```

## 3. 核心实现原理

### 3.1 启动流程

```text
gdp launch
  → 检测 GitHub Desktop 路径
  → spawn("GitHubDesktop.exe", ["--require=dist/hook/index.js"])
  → 配置通过环境变量 GDP_CONFIG 传递
```

`--require` 是 Node.js/Electron 原生支持的参数，会在主脚本执行前加载指定模块。

### 3.2 更新拦截 (update-blocker.ts)

通过 `Module._load` hook 拦截 `require('electron')` 调用，将返回对象中的 `autoUpdater` 替换为 noop 实现：

```javascript
// 核心逻辑
Module._load = function(request) {
  const result = originalLoad(request)
  if (request === 'electron') {
    result.autoUpdater = {
      setFeedURL() { /* noop */ },
      checkForUpdates() { /* noop */ },
      quitAndInstall() { /* noop */ },
      // 保留事件系统
      on: originalAutoUpdater.on.bind(originalAutoUpdater),
    }
  }
  return result
}
```

GitHub Desktop 中 `AppWindow.checkForUpdates()` 调用 `autoUpdater.setFeedURL()` 和 `autoUpdater.checkForUpdates()` → 被替换为空操作。

### 3.3 遥测拦截 (telemetry-blocker.ts)

多层拦截策略：

1. **`https.request` hook** — 拦截 Node.js 原生 HTTPS 请求
2. **`http.request` hook** — 拦截 HTTP 请求
3. **`electron.net.request` hook** — 拦截 Electron 网络 API

对匹配以下端点的请求返回 fake 200 响应（不报错）：

- `central.github.com/api/usage/*` — 统计上报
- `central.github.com/api/desktop/exception` — 致命异常
- `central.github.com/api/desktop-non-fatal/*` — 非致命异常

### 3.4 日志过滤 (log-filter.ts)

Hook `require('winston')` 的 `createLogger`，强制设置日志级别。可选禁用文件 transport。

### 3.5 Preload 注入 (preload-injector.ts)

Hook `electron.BrowserWindow` 构造函数，在 `webPreferences.preload` 中注入我们的 preload 脚本。
由于 GitHub Desktop 设置了 `contextIsolation: false`，preload 与页面共享全局上下文。

### 3.6 i18n 引擎 (i18n/engine.ts)

1. 加载翻译字典（JSON 格式）
2. `DOMContentLoaded` 后遍历全部文本节点进行替换
3. `MutationObserver` 持续监听 React 的 DOM 更新
4. 支持模板变量：`"Commit to {branch}"` → `"提交到 {branch}"`
5. 翻译属性：`placeholder`, `title`, `aria-label`

## 4. 配置说明

配置文件位置：
- Windows: `%APPDATA%\github-desktop-plus\config.json`
- macOS: `~/Library/Application Support/github-desktop-plus/config.json`

```json
{
  "updates": { "disabled": true },
  "telemetry": { "disabled": true, "blockExceptions": true },
  "logging": { "level": "warn", "disableFileLog": false },
  "i18n": { "enabled": true, "locale": "zh-CN" },
  "desktop": { "path": "auto" }
}
```

## 5. CLI 命令

```bash
gdp launch                      # 启动增强版 GitHub Desktop
gdp launch --desktop-path <path>  # 指定 Desktop 路径
gdp config show                 # 显示当前配置
gdp config path                 # 显示配置文件路径
gdp config reset                # 重置配置
gdp detect                      # 检测 Desktop 安装位置
```

## 6. 自定义翻译

将翻译文件放置在：
- Windows: `%APPDATA%\github-desktop-plus\locales\zh-CN.json`
- macOS: `~/Library/Application Support/github-desktop-plus/locales/zh-CN.json`

用户翻译会覆盖内置翻译。格式：

```json
{
  "English text": "翻译文本",
  "Text with {variable}": "带 {variable} 的翻译"
}
```

## 7. 后续扩展方向

- [ ] Windows 快捷方式自动创建（替代原始快捷方式）
- [ ] 更完整的中文翻译覆盖（菜单栏、对话框、错误消息）
- [ ] 自定义主题注入（CSS 注入）
- [ ] 插件系统
- [ ] GUI 配置界面
- [ ] macOS launchctl 集成
- [ ] 翻译贡献平台（在线协作翻译）
