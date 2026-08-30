# CLAUDE.md

面向本仓库的开发约定。功能介绍和注入原理见 [README.md](README.md)，这里只写「改代码时会踩到的东西」。

## 目录职责

| 目录 | 放什么 |
| --- | --- |
| `apps/gdp/` | Rust 二进制：CLI、0-path 注入、进程管理、hook 资源内嵌 |
| `apps/settings-ui/` | 设置弹窗的 React 应用，Vite workspace 包 |
| `apps/site/` | GitHub Pages 落地页，单个自包含 `index.html` |
| `crates/gdp-core/` | 不依赖 CLI 的纯 Rust 逻辑：配置模型、平台路径、GitHub Desktop 探测 |
| `packages/hooks/` | 私有 workspace 包；`src/` 是注入源码，tsdown 只输出 main / early / renderer 三个运行时 bundle |
| `packages/shared/` | 私有 source package；主进程 / 弹窗外壳 / 设置界面共用的 IPC 契约 |
| `scripts/` | 全部 Node 自动化，按 `checks/`、`i18n/`、`mock/` 分类 |
| `apps/gdp/resources/` | gdp 拥有的语言包源与 GitHub Desktop 字符串目录 |
| `docs/` | 跨应用、跨语言的仓库级设计和调研文档 |
| `target/` | Rust 和前端资源的构建产物，不要手改 |

新文件该放哪：Rust 二进制相关 → `apps/gdp`；Rust 纯逻辑 → `crates/gdp-core`；会被注入进 GitHub Desktop 的 TS → `packages/hooks`；三方共用的类型 → `packages/shared`；Node 自动化统一放 `scripts/`，再按职责进入对应子目录。

每个 JS workspace 都有标准的 `package.json` 与继承根配置的 `tsconfig.json`。第三方版本只在 `pnpm-workspace.yaml` 的 catalog 维护，包内仍声明自己的直接依赖；内部依赖统一写 `workspace:*`。`packages/shared` 直接导出 TypeScript 源码，作为私有 source package 使用，不产生一份没有运行价值的重复构建产物。

## 构建链路是严格顺序的

```
locales:prepare  →  pnpm -r build  →  cargo build
```

pnpm 按 workspace 依赖拓扑执行 Vite 与 tsdown，不再维护根级 `build:ui` / `build:hooks` 转发脚本。`apps/gdp/build.rs` 找不到产物时仍会内嵌 stub；排查时检查 `packages/hooks/dist/` 的三个 bundle 和 `apps/settings-ui/dist/gdp-settings-ui.js` 是否为真实构建产物。

改完东西跑 `pnpm run build`（release）或 `pnpm run check`（只校验），它们已经把顺序串好了。

## 必须手动同步的三处

1. **Vite 端口**：统一从 `apps/settings-ui/dev-config.ts` 读取，不要再复制常量。
2. **UI 全局名**：统一从 `@github-desktop-plus/shared` 导入 `GDP_SETTINGS_UI_GLOBAL`。
3. **改变三个运行时 bundle 的边界要同时改三个位置**：
   - `packages/hooks/src/entries/` 和 `tsdown.config.ts` 的入口声明
   - `apps/gdp/build.rs` 的 `embed_file` 调用（拷进 `OUT_DIR`）
   - `apps/gdp/src/hook_assets.rs` 的 `include_bytes!` 常量（内嵌进二进制）

   少改一个不会编译失败，只会静默内嵌 stub。

## 加一条 IPC channel

按顺序来，反了 dev 模式下的 postMessage 桥会直接拒掉这个信道：

1. 在 `packages/shared/src/index.ts` 加类型，并把 channel 名加进运行时白名单。
2. 在 `packages/hooks/src/ipc.ts` 实现 `ipcMain` handler。
3. 在 `apps/settings-ui` 里通过 `GDPBridge` 消费。

生产走 `ipcRenderer` 直连，开发走 iframe + postMessage RPC，两侧共用同一个 `GDPBridge` 接口——业务代码不需要知道自己在哪一侧。

## 常用命令

```bash
pnpm install                      # pnpm workspace
pnpm dev                          # Vite(5273) + hook 构建 + 拉起 GDP 和 GitHub Desktop
pnpm --filter @github-desktop-plus/settings-ui dev  # 只跑设置界面的 Vite
pnpm run build                    # 全链路 release 构建
pnpm run package:windows          # release 构建 + Velopack MSI/便携包/更新清单
pnpm run check                    # 前端构建、类型、测试、Rust fmt/check
pnpm run test                     # workspace 测试 + cargo test
pnpm run typecheck                # 全部 TS workspace + 零 JavaScript 策略
pnpm run self-check:desktop       # 端到端桌面自检（会真的起 GitHub Desktop）
pnpm run mock:ai                  # 本地 mock 的 OpenAI 兼容接口
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
```

提交前跑 `pnpm run check`；发布前再跑 `pnpm run package:windows`，正式 Windows 资产位于 `target/velopack/releases/`。

## 代码风格

跟随所在文件，不要顺手统一：TS/TSX 多数是 2 空格 + 单引号 + 无分号，`scripts/checks/desktop.ts` 用双引号加分号。Rust 走 stable 兼容的 `.rustfmt.toml`。

`.gitattributes` 对所有源码强制 LF。在 Windows 上用脚本批量改文件时注意别写成 CRLF——`cargo fmt --check` 会因此失败。

## 不要做的事

- **不要再引入本地 HTTP 服务**。控制面板早期是 `127.0.0.1:7788` 上的 web 应用，已经全量迁到 Electron IPC，相关的 webui、hyper/tokio 依赖都已删除。
- **不要手改 `target/`**，Rust 产物和聚合语言包都会在构建时重写。
- **不要在 `crates/gdp-core` 里手写目录树或模块清单**。以前那份硬编码的 `PROJECT_TREE` 一次重构就过期了，已经删掉；架构信息写进 `docs/architecture.md`。
