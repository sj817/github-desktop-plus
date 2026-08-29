# 架构设计：Rust 运行时核心

> 目标：以 **Rust 作为唯一运行时核心**，将常驻内存压到 **< 10MB**，同时保持秒开体验与跨平台能力。

> **阅读须知**：第 1、2、6、7、8、9 节描述当前实际架构。
> 第 3、4、5 节是当初的设计权衡记录，其中围绕 `gdp-web`、`hyper`、`rust/ui` 的部分**已经作废**——
> 控制面后来全量改成了 Electron IPC，本地 HTTP 服务和配套 web 应用已从仓库删除。
> 这几节保留下来是为了记录「为什么当时那样选、后来为什么推翻」，不要当作现状阅读。
> 现状的入口见第 9 节和 [`../CLAUDE.md`](../CLAUDE.md)。

---

## 1. 设计目标

### 硬约束

- **禁止 Node.js 作为运行时核心**：Node.js / Bun 仅允许继续承担构建辅助角色
- **内存占用优先级最高**：目标常驻内存 **< 10MB**
- **启动速度优先**：尽量做到单进程、少依赖、少初始化
- **跨平台**：Windows / macOS / Linux

### 结论

现有 `Electrobun + Vue` 方案适合作为原型，但不适合作为低内存长期主线：

- JS runtime 本身就会抬高 RSS 基线
- Vue + Vite 产物虽然易开发，但前端运行时仍有额外内存和启动成本
- Bun / Node Hook 方案对“核心常驻 < 10MB”的目标不友好

因此新的推荐形态是：

1. **Rust Core**：纯逻辑、纯库、零 UI、零网络副作用
2. **Rust CLI**：一次性进程，直接调用 core
3. **Rust Web Adapter**：超轻量 loopback HTTP，仅负责桥接 UI 与 core
4. **Web UI**：纯静态，无框架，无 hydration

---

## 2. 架构图（文本）

```text
┌───────────────────────────────────────────────────────────┐
│                       Rust Core                          │
│  gdp-core                                                │
│  - 配置模型                                              │
│  - 规则引擎                                              │
│  - GitHub Desktop 检测                                   │
│  - 更新/遥测/注入策略决策                                 │
│  - 运行状态汇总                                           │
└───────────────┬───────────────────────────────┬───────────┘
                │                               │
      进程内函数调用                            │ 进程内函数调用
                │                               │
                ▼                               ▼
      ┌────────────────┐              ┌─────────────────────┐
      │   Rust CLI     │              │   Rust Web Adapter  │
      │   gdp-cli      │              │   gdp-web           │
      │ - clap 解析    │              │ - hyper HTTP/1      │
      │ - stdout/stderr│              │ - JSON API          │
      │ - 可选 stdin   │              │ - 静态文件分发       │
      └────────┬───────┘              └─────────┬───────────┘
               │                                │
               │ stdin/stdout（脚本集成可选）   │ HTTP/JSON（127.0.0.1）
               │                                │
               ▼                                ▼
      ┌────────────────┐              ┌─────────────────────┐
      │ Shell / CI /   │              │     轻量 Web UI     │
      │ Automation     │              │  HTML + CSS + JS    │
      └────────────────┘              └─────────────────────┘
```

---

## 3. 模块边界与通信方式

### Core crate：`gdp-core`

职责：

- 维护核心配置模型与默认值
- 提供“禁用更新 / 屏蔽遥测 / 注入 UI / 路径探测”的策略判断
- 提供状态、预算、模块元数据等只读接口
- 严格避免 CLI / HTTP / 平台窗口等上层依赖倒灌

边界：

- **不依赖 tokio / hyper / clap**
- **不直接打印日志**
- **不直接创建线程**
- **不直接启动外部进程**

通信方式：

- 被 `gdp-cli` 和 `gdp-web` **以进程内函数调用**使用

### CLI crate：`gdp-cli`

职责：

- 参数解析
- 调用 core 执行命令
- 输出机器可读文本 / JSON

通信方式：

- 与 `gdp-core`：**进程内函数调用**
- 与脚本 / CI：**stdin / stdout / exit code**

### Web adapter crate：`gdp-web`

职责：

- 在 `127.0.0.1` 提供超轻量 HTTP/1 JSON API
- 分发静态 UI 资源
- 充当 Web UI 与 core 之间的最薄适配层

通信方式：

- 与 `gdp-core`：**进程内函数调用**
- 与 Web UI：**HTTP/JSON**（推荐 `GET /api/status`、`GET /api/modules`、`GET /api/tree`）

### Static UI：`rust/ui`

职责：

- 展示状态、模块职责、目录结构
- 触发只读 API 请求
- 零状态或极小状态，不做复杂缓存

通信方式：

- 与 `gdp-web`：**loopback HTTP/JSON**

---

## 4. 技术选型与理由

### 4.1 Rust Web 框架：选择 `hyper`

候选：`axum` / `actix-web` / `hyper`

最终选择：**`hyper`**

原因：

1. **依赖树最小化更容易**  
   `hyper` 是底层 HTTP 库，避免了 `axum` 的路由层、`tower` 中间件链和更多宏包装。

2. **更适合“本地 loopback + 少量路由”场景**  
   本项目只需要本地面板和少量 JSON 接口，不需要完整 Web 框架生态。

3. **更可控的内存行为**  
   手写少量路由能减少额外抽象层带来的常驻对象和初始化开销。

4. **启动更直接**  
   不需要应用容器、提取器、中间件栈即可完成服务启动。

为什么不选：

- **`axum`**：开发体验优秀，但对当前“极限压缩 RSS”目标来说，抽象层偏厚
- **`actix-web`**：性能强，但运行时与整体生态更重，不适合本项目的极简常驻目标

> 结论：若未来 API 规模显著扩大，可再评估 `axum`；在当前目标下，`hyper` 最合适。

### 4.2 CLI：选择 `clap`

最终选择：**`clap`（关闭默认特性，按需启用）**

原因：

1. **跨平台成熟**：Windows / macOS / Linux 参数行为稳定
2. **运行期开销几乎只在启动瞬间**：CLI 是一次性进程，不会抬高常驻内存
3. **用户体验更完整**：帮助信息、错误提示、子命令结构都成熟
4. **可通过 feature 裁剪**：仅启用 `derive/std/help/usage/error-context`

### 4.3 前端方案：选择“纯静态 HTML + CSS + Vanilla JS”

最终选择：**无框架静态前端**

原因：

1. **没有前端运行时常驻成本**
2. **首屏更快**：无 hydration、无虚拟 DOM
3. **分发最简单**：可直接由 `gdp-web` 分发
4. **内存更低**：对简单设置面板而言，框架收益远低于其成本

不建议：

- Vue / React / Svelte 作为默认 UI runtime
- 客户端状态管理库
- 前端路由库

---

## 5. 内存优化策略（重点）

### 5.1 避免 runtime 膨胀：Tokio 使用策略

`hyper` 需要 async runtime，但我们要把 runtime 压到最小：

#### 采用策略

- 使用 **`tokio` current-thread runtime**，避免 multi-thread scheduler
- 只启用最少 feature：`rt`、`macros`、`net`
- 只跑 **HTTP/1 + loopback**，不引入 TLS、WebSocket、tower 中间件栈
- 不启用 `fs`、`process`、`signal`、`time` 等无关模块

#### 明确避免

- `tokio/full`
- 多线程 runtime
- 大量后台 task
- 长连接推送模型（如 WebSocket）
- 广泛使用 `spawn_blocking`

#### 结果

- scheduler 常驻状态更少
- 线程栈更少
- 连接模型简单，稳定性高，RSS 更可控

### 5.2 静态分配 vs 动态分配

#### 优先静态分配的部分

- 路由表：使用 `match` 常量分发，而不是动态 HashMap 路由器
- 默认配置：使用 `const` / `'static` 数据
- UI 资源：可用 `include_str!` / `include_bytes!` 编译进二进制
- 规则字符串：尽量使用 `&'static str`

#### 允许动态分配的部分

- JSON 序列化返回体
- CLI 参数结果
- 少量配置覆盖项

#### 原则

- **把分配集中在边缘层（CLI/Web Adapter）**
- **让 core 尽量保持无堆分配或极少堆分配**

### 5.3 依赖最小化策略

#### Core 层

- 不依赖 async runtime
- 不依赖日志框架（先使用最小错误返回）
- 不依赖正则，优先 `match` / `starts_with`
- 不依赖重量级配置系统

#### Web 层

- `hyper` + `hyper-util` + `http-body-util`
- 不上 `axum` / `tower-http` / 模板引擎

#### CLI 层

- `clap` 仅按需 feature
- 不引入彩色输出、自动补全生成等额外依赖（除非确认需要）

### 5.4 构建优化

推荐 release 配置：

```toml
[profile.release]
opt-level = "z"
lto = "fat"
codegen-units = 1
panic = "abort"
strip = "symbols"
incremental = false
```

含义：

- `opt-level = "z"`：优先减小二进制体积，通常也有助于启动速度和内存映射成本
- `lto = "fat"`：全程序优化，进一步裁剪未使用路径
- `codegen-units = 1`：提升优化效果，代价是构建更慢
- `panic = "abort"`：避免 unwinding runtime
- `strip = "symbols"`：减小可执行文件体积

如果后续基准测试发现 `"z"` 对热点路径有影响，可切换到 `opt-level = "s"` 做折中。

### 5.5 启动速度策略

- 保持 **单二进制启动路径** 简单直接
- Web 仅绑定 `127.0.0.1`，不做网卡枚举
- 无数据库初始化
- 无插件系统自动扫描
- 无前端框架 hydration
- UI 静态资源尽量内嵌

---

## 6. 目录结构（tree）

```text
github-desktop-plus/
├── apps/
│   ├── gdp/                # Rust bin crate：CLI、0-path 注入、hook 资源内嵌
│   │   └── resources/      # 语言包源与 GitHub Desktop 字符串目录
│   ├── settings-ui/        # React 设置界面（Vite，pnpm workspace 成员）
│   └── site/               # GitHub Pages 落地页
├── crates/
│   └── gdp-core/           # Rust lib crate：配置、探测、平台、运行时元数据
├── packages/
│   ├── hooks/              # 私有 pnpm 包：src/ 源码 + tsdown 三入口构建
│   └── shared/             # 私有 source package：三方共用的 IPC 契约
├── scripts/                # 全部 TypeScript 自动化：开发、提取、mock 与检查
├── docs/                   # 跨应用、跨语言的仓库级文档
├── Cargo.toml              # Rust workspace
├── pnpm-workspace.yaml
└── package.json            # 构建辅助入口
```

---

## 7. 核心模块职责说明

### `gdp-core`

- `RuntimePlan`：统一描述运行时方案
- `ModuleInfo`：公开模块职责元数据
- `project_tree()`：导出当前推荐目录树
- `demo_pseudocode()`：导出最小运行示例

### `gdp-cli`

- `status`：输出当前架构计划
- `tree`：输出目录结构
- `demo`：输出最小 demo 伪代码

### `packages/hooks`

- 主进程 hook：更新拦截、遥测屏蔽、菜单 i18n、AI 提交接管
- `src/ipc.ts`：配置 / 语言包 / 日志 / AI 的 `ipcMain` handler
- `src/preload/`：渲染进程侧的 DOM 文本替换、打开方式菜单、设置弹窗外壳
- `tsdown.config.ts`：Node CJS 主入口 + early / renderer 两个 browser IIFE 入口

### `apps/settings-ui`

- React 应用，Vite library 模式打成单文件 IIFE（CSS 内联）
- 通过 `GDPBridge` 与主进程通信，不感知自己跑在生产还是 iframe 开发模式

---

## 8. 最小可运行 demo（伪代码）

### Core

```rust
pub struct RuntimePlan {
    memory_target_mb: u8,
    web_boundary: &'static str,
}

pub fn runtime_plan() -> RuntimePlan {
    RuntimePlan {
        memory_target_mb: 10,
        web_boundary: "Electron IPC (ipcMain/ipcRenderer), no HTTP server",
    }
}
```

### CLI

```rust
fn main() {
    let plan = gdp_core::runtime_plan();
    println!("target rss < {}MB", plan.memory_target_mb);
}
```

### 控制面（注入的主进程 hook）

```typescript
ipcMain.handle('gdp:get-config', () => readConfig())
ipcMain.handle('gdp:set-config', (_e, patch) => writeConfig(patch))
```

### 设置界面（渲染进程）

```typescript
const config = await bridge.invoke('gdp:get-config')
```

---

## 9. 当前落地状态

已经落地：

- Rust workspace：`crates/gdp-core` + `apps/gdp`，release 走体积优先的编译配置
- 0-path 注入：`--inspect-brk=0` + V8 Inspector，在 `main.js` 执行前注入 hook
- 控制面：全部走 Electron IPC，**不再有本地 HTTP 服务**
- 设置界面：`apps/settings-ui` 的 React 应用，生产内嵌为单文件 IIFE

早期设计里的 `gdp-web`（`127.0.0.1:7788` 上的 HTTP 控制 API）和配套的无框架静态 UI 已被放弃并从仓库删除——它多出一个常驻监听端口和一套认证面，而注入侧本来就能直接拿到 `ipcMain`。
