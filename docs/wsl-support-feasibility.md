# WSL 仓库支持可行性调研

> 目标：让 Windows 侧的 GitHub Desktop 能够管理放在 WSL 内部（ext4）的仓库，
> 类似 VS Code 的 Remote-WSL Server。
>
> 调研环境：Windows 11 Pro for Workstations 26340 · WSL2 (Ubuntu-24.04 / Debian) ·
> GitHub Desktop 3.6.4 · 全部数据为本机实测。

---

## 1. 结论摘要

| 路线 | 可行性 | 性能 | 工作量 | 建议 |
| ---- | ------ | ---- | ------ | ---- |
| **A. 直接用 `\\wsl.localhost` UNC 路径** | ✅ 今天就能用 | 比原生慢 ~8×，但绝对值可接受 | ~0.5 天 | **先做** |
| **B. 每条 git 命令转发给 `wsl.exe`** | ✅ 可行 | **比路线 A 更慢** | 1–2 周 | ❌ 不要做 |
| **C. WSL 内常驻代理进程（"小型服务器"）** | ✅ 可行 | 原生速度，比 A 快 15–60× | 3–6 周 | 值得做，但要接受长尾成本 |

三个关键发现：

1. **路线 B 是个陷阱。** `wsl.exe` 每次调用有约 **230ms 固定开销**，比整条 git 命令走 9P
   还慢。直觉上"最稳妥"的中间方案，实测反而是三条路里最差的。
2. **常驻进程的收益极大。** 保持一个 `wsl.exe -- bash` 长连接后，单次往返开销降到
   **0.2ms**，git 以原生 Linux 速度运行 —— 这正是 VS Code 要做 server 的原因。
3. **拦截点是现成的。** GitHub Desktop 的 git 调用跑在**渲染进程**，且 dugite 是通过
   `child_process` 模块的属性查找发起的，GDP 现有的 preload 注入可以直接接管。

---

## 2. 问题定义

GitHub Desktop 把仓库路径当作普通文件系统路径，用自带的 `git.exe`（`resources/app/git/`）
以 `cwd = 仓库路径` 执行命令。WSL 内的仓库对 Windows 而言只有一条通路：9P 协议映射出来的
`\\wsl.localhost\<发行版>\home\<用户>\<仓库>`。

于是有两个独立的问题：

- **文件访问**：GD 自己要读工作区文件（未跟踪文件的 diff、图片 diff、`.gitignore` 等）
- **git 执行**：谁来跑 git —— Windows 的 `git.exe` 还是 WSL 内的 `git`

这两件事**可以拆开**，这是路线 C 的关键设计前提。

---

## 3. 实测数据

测试仓库在 WSL 的 ext4 上（`/tmp`），两个规模：2000 个文件与 20000 个文件。

### 3.1 `git status --porcelain` 耗时

| 执行方式 | 2k 文件 | 20k 文件 |
| -------- | ------- | -------- |
| WSL 内原生 git（基准） | 20 ms | 20 ms |
| **A**：Windows `git.exe` 走 `\\wsl.localhost` | 132–180 ms | 165–182 ms |
| **B**：`wsl.exe -d Ubuntu --cd <path> -- git …` | 241–262 ms | 318–326 ms |
| **C**：常驻 `wsl.exe -- bash`，经 stdio 下发 | **2.3 ms** | **10 ms** |

### 3.2 固定开销

| 项目 | 耗时 |
| ---- | ---- |
| `wsl.exe -- true`（纯启动开销） | ~230 ms |
| 常驻 bash 通道单次往返（`true`） | **0.2 ms** |
| 9P 列出 500 项目录 | 50 ms |

路线 B 的 230ms 是**每条命令**都要付的。GitHub Desktop 刷新一次仓库状态会连续发出十几条
git 命令，这个开销会被直接放大成秒级卡顿。

### 3.3 正确性验证

- **`safe.directory` 会拦路。** Windows git 直接访问 `\\wsl.localhost\...` 会报
  `fatal: detected dubious ownership in repository`。必须写入
  `safe.directory`（`%(prefix)///wsl.localhost/...` 格式）才能用 —— 这是路线 A 唯一的
  硬阻塞，但可以由 GDP 自动写入。
- **交叉运行不脏工作区。** 同一个仓库先后用 Windows git 和 Linux git 执行 `status`，
  两侧都报告干净，索引 mtime 未发生反复重写。（注：本次未验证 `core.autocrlf` 打开时的
  行为，GD 在 Windows 上会设置它，属于待验证风险。）
- **9P 上收不到文件变更通知。** 在 `\\wsl.localhost` 上挂 `FileSystemWatcher`，从 WSL 内
  修改和新建文件，**收到 0 个事件**。
- **但这一条不构成阻塞** —— 查 GD 3.6.4 的 renderer sourcemap，全部源码里只有
  `app/src/lib/tailer.ts` 用到文件监听（用于日志跟随），**GD 根本不监听工作区**，
  它靠窗口获得焦点和显式操作来刷新。

---

## 4. 拦截点（已从发行包中确认）

GitHub Desktop 3.6.4 的 `resources/app/renderer.js.map` 里可以读到原始源码：

- git 跑在**渲染进程**：`app/src/lib/git/core.ts` 调 dugite，`main.js` 里没有 dugite。
- dugite 的两个入口都是**运行时属性查找**：

  ```js
  // node_modules/dugite/build/lib/spawn.js
  const spawnedProcess = (0, child_process_1.spawn)(gitLocation, args, { env, cwd: path })

  // node_modules/dugite/build/lib/exec.js
  const cp = (0, child_process_1.execFile)(gitLocation, args, opts, …)
  ```

也就是说，在渲染进程里改写 `require('child_process').spawn` / `.execFile`，就能拿到每一次
git 调用的 `gitLocation`、`args`、`env`、`cwd` 并决定如何执行。GDP 现有的 preload 注入
（`did-finish-load` 时 `executeJavaScript`）时机足够早，且渲染进程 `nodeIntegration: true`，
拿到的是同一个模块对象。**不需要改 GitHub Desktop 源码，也不需要新的注入机制。**

---

## 5. 三条路线的具体形态

### 路线 A —— 直接注册 UNC 路径（建议先落地）

GDP 需要做的：

1. 设置里加"添加 WSL 仓库"：列出发行版（`wsl -l -q`），列出该发行版内的 git 仓库，
   把 `\\wsl.localhost\<distro>\<path>` 加进 GD。
2. 自动写入 `safe.directory`，否则 GD 会直接报错。
3. 文档里说明局限。

代价：git 操作比原生慢约 8 倍（绝对值 130–180ms，日常可接受），Windows git 跑 Linux 的
`.git/hooks/*`（`#!/bin/bash`）会走 GD 自带的 MSYS bash，行为可能与 WSL 内不一致。

### 路线 B —— 每条命令转发 `wsl.exe`

实测更慢，**不建议单独实施**。它唯一的价值是作为路线 C 的降级兜底（常驻进程挂掉时）。

### 路线 C —— WSL 内常驻代理

核心设计：**仓库仍然以 UNC 路径注册**（GD 自己的 `fs` 读取继续走 9P，不用改），
**只把 git 的执行重定向到 WSL 内**。

```
渲染进程                                WSL (Ubuntu)
┌────────────────────────┐             ┌─────────────────────┐
│ dugite                 │             │  gdp-agent          │
│  child_process.spawn ──┼── 补丁 ────►│  (常驻，stdio 成帧) │
│                        │   stdio     │    └─ git (原生)    │
│ fs.readFile ───────────┼── 9P ──────►│  ext4               │
└────────────────────────┘             └─────────────────────┘
```

要点：

- 补丁只在 `cwd` 落在 `\\wsl.localhost\<distro>\…` 时接管，其余原样放行。
- 代理进程用 `wsl.exe -d <distro> -- <agent>` 拉起，**长驻**，用长度前缀成帧的协议
  （不能用 bash + 分隔符，`git show` 会输出二进制）。
- 返回一个仿造的 `ChildProcess`（`stdout` / `stderr` / `on('close')` / `exit code`），
  dugite 感知不到差别。
- 需要做**路径翻译**：入向 `cwd` 与参数里的 UNC 路径转成 Linux 路径；出向把 git 输出里的
  绝对路径转回 UNC（`rev-parse --show-toplevel` / `--git-dir`、submodule、`worktree list` 等）。

---

## 6. 路线 C 的待解决难点

按风险从高到低：

1. **认证。** GD 通过 `GIT_ASKPASS` 指向 `desktop-trampoline.exe` 完成凭据交互。转到 WSL 后
   这个环境变量指向的是 Windows 路径。WSL interop 允许从 Linux 执行 `/mnt/c/...` 下的 `.exe`，
   理论上可以映射过去（配合 `WSLENV`），**但本次未实测**。做不通就得在 WSL 侧自建一个
   credential helper 回调 Windows。
2. **路径翻译的长尾。** 绝对路径会从十几个不同的 git 子命令里漏出来，漏一处就是一个诡异 bug。
3. **二进制与大输出。** `git show` 取图片、`git diff` 取大文件都要走这条通道，协议必须支持
   二进制帧和背压，`maxBuffer: Infinity` 的语义要保留。
4. **进程生命周期。** `wsl --shutdown`、休眠唤醒、发行版被停止都会打断连接，需要健康检查、
   自动重连，以及降级到路线 B 或 A 的兜底。
5. **多发行版并存。** 每个发行版一个代理进程，按仓库路径路由。
6. **错误语义。** dugite 依赖 exit code 与 stderr 文本判定错误类型，必须原样透传。

另外注意：常驻代理跑在 WSL 虚拟机内，不占 GDP 承诺的「Windows 侧 < 10MB 常驻」预算，
但它要求 WSL VM 保持运行。

---

## 7. 建议的推进顺序

1. **先做路线 A**（约 0.5 天）。它今天就能用，能立刻验证"用 GD 管理 WSL 仓库"这件事本身
   是否符合预期，也顺带把 `safe.directory` 和发行版发现这些基础设施做掉。
   —— 本次已顺带落地了一半：右键菜单的「打开方式」已经能自动检测出
   `WSL (Ubuntu-24.04)` / `WSL (Debian)` 并用 `wsl --cd` 在仓库目录打开。
2. **再做一个最小验证**（约 2–3 天）：只补丁 `child_process.execFile`，把
   `git status` / `git log` 两条命令转发给常驻 bash，确认 dugite 无感知、认证路径可通。
   这一步能以很低成本证伪路线 C 最大的两个风险（伪造 ChildProcess、认证）。
3. **验证通过再投入完整实现**（3–6 周）。

---

## 附录：复现方法

```powershell
# 9P 路径（注意 safe.directory）
$git = "$env:LOCALAPPDATA\GitHubDesktop\app-3.6.4\resources\app\git\cmd\git.exe"
Measure-Command { & $git -c safe.directory=* -C "\\wsl.localhost\Ubuntu-24.04\tmp\repo" status --porcelain }

# 每命令 wsl.exe
Measure-Command { wsl.exe -d Ubuntu-24.04 --cd /tmp/repo -- git status --porcelain }
```

```js
// 常驻通道：spawn 一次 bash，用 stdio 下发命令并计时往返
const child = spawn('C:/WINDOWS/System32/wsl.exe', ['-d', 'Ubuntu-24.04', '--', 'bash'],
  { stdio: ['pipe', 'pipe', 'pipe'] })
child.stdin.write('cd /tmp/repo\ngit status --porcelain > /dev/null\necho __END__\n')
```
