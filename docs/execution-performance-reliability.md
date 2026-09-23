# 执行性能与稳定性优化（2026-09-23）

本轮针对 Agent 发现、模型目录查询、短命令生命周期、IPC 主线程阻塞与 Claude 会话收尾，减少重复进程启动，避免外部命令卡住、界面冻结或会话卡在「运行中」。现有执行引擎、配置模型、档案、自定义 Agent、查找回退路径和全部 IPC 命令（名称与参数）均保留，没有删除后端能力。

## 第二部分：主线程、输出管道与会话收尾

| 场景 | 原有问题 | 当前行为与验证 |
| --- | --- | --- |
| Git 历史 / 图谱 / blame / 分支 / worktree / tag 等 19 个命令，shell 执行、外部终端、在 IDE 中打开、截屏、openspec 初始化、`claude agents`、磁盘会话列表与 jsonl 加载 | Tauri 2 的同步命令在 IPC 线程内联执行（已核对 tauri-macros 2.6.2 源码），macOS 上即主线程；大仓库 `git_graph` 全历史拓扑排序、AppleScript 固定 `delay 1.0`、`screencapture -i` 框选期间、`npx` 下载期间整个界面冻结 | 改为 `async` 包装 + `spawn_blocking`，同步实现保留为 `*_blocking`；命令名和参数不变，前端无需修改。新增 `ipc_thread_guard_tests`：同步命令体中出现 `.output()`、`open_repo(`、`run_git_command(` 等即失败 |
| `run_claude_cli_command`、插件市场安装/卸载 | 子进程输出为管道，却只在退出后读取；输出超过管道缓冲（约 64 KiB）时 claude 卡在写入，直到 120 s / 600 s 超时才报错；250 ms 轮询 | 共用 `blocking_output_with_timeout`：运行期间并发排空 stdout/stderr，10 ms 轮询，超时结束子进程；CLI 拉起的后台进程继承管道时最多再等 500 ms |
| `claude agents` | 直接执行 `claude`，从 `.app` 启动时 PATH 不含安装目录；无超时 | 与会话启动相同的二进制解析与 PATH 合并，30 s 超时 |
| Claude 会话结束 | stdout EOF 后先 `try_wait` 检查进程；tokio 在观察到退出后 `Child::id()` 永久返回 `None`，随后按 pid 识别自身时误判为「已被顶替」，跳过 complete 事件以及 registry、stdin 映射清理（stdin 管道 fd 泄漏，无 result 行的失败退出在界面上一直显示运行中）；最终等待持锁 `wait()`，进程关闭 stdout 后仍存活时，取消与新 spawn 永久拿不到槽位 | 保留 reader 在 pid 匹配时亲自观察到的退出码；最终等待改为 `wait_owned_child`，轮询间隙释放锁。主动结束进程的路径（取消、同会话重跑、常驻模式替换）都在同一把锁内 `kill` 并清空槽位，「被顶替的旧 reader 不发 complete」的约束不变 |
| 后台启动命令、打开 IDE / 终端 / 文件 | `spawn()` 后丢弃 `Child`，每次退出留下一个僵尸进程，直到 Wise 退出 | 12 处分离启动统一交给回收线程 `wait()` |
| 登录 shell 查找 | 程序不在常见目录时（如旧版安装器的 `~/.claude/local/claude`），每次启动会话都重新运行 zsh/bash 登录 shell，最坏约 4 s | 命中结果复用（使用前校验仍可执行），未命中 30 s 后重试，不同 CLI 的查找互不串行 |

### 可重复测量

输出 1 MiB 的子进程，3 s 超时（Python 复现两种读取方式，与 Rust 实现的系统行为一致）：

| 方式 | 结果 |
| --- | --- |
| 退出后再读（原实现） | 管道写满，3,043 ms 后超时被杀 |
| 并发排空（当前实现） | 16 ms 正常退出，读到 1,048,576 字节 |

对应单元测试 `cli_probe::tests::blocking_capture_drains_large_output_and_bounds_hangs` 断言 1 MiB 输出在 5 s 内完成（超时设为 20 s）。会话收尾由 `child_slot_wait::tests` 覆盖：退出码正确上报、`try_wait` 后 pid 失效、reader 等待期间取消可在 1 s 内拿到槽位并结束进程、槽位被替换时判定为被顶替。

## 第一部分：Agent 发现与模型目录

| 场景 | 原有问题 | 当前行为与验证 |
| --- | --- | --- |
| Codex 选择模型并启动任务 | 选择器和执行前校验各自启动 CLI；目录查询没有超时，失败时连续重试 | 共用模型目录缓存；32 个并发请求只调用一次加载器；已配置的模型仍直接放行，目录失败仍保留原有放行行为 |
| OpenCode / Qoder 模型查询 | 重复打开选择器重复启动进程 | 复用同一缓存机制；成功保留 60 秒，空结果仅保留 5 秒，之后自动重试；配置文件中的模型在缓存外按请求合并 |
| CLI 查询超时、调用被取消 | 丢弃 `Command::output()` future 不会默认终止进程 | 统一设置 `kill_on_drop` 和空 stdin；真实本地进程测试分别确认超时、取消后 PID 被回收，并确认 stdout、stderr、退出码保留 |
| 登录 shell 查找程序 | 初始化脚本可能永久等待、输出填满管道，或后台任务继承 stdout 导致一直等不到 EOF | Claude / Codex / Cursor / DeepSeek / OpenCode / Qoder 共用 Unix 探测器；每个 shell 最多等待约 2 秒，非阻塞读取并仅保留末尾 64 KiB；结束时清理探测进程组；覆盖挂起、连续输出、140 KiB 启动横幅和继承 stdout 的后台进程 |
| Agent 列表并发刷新 | 同时遇到空缓存会重复探测，并可能交错覆盖列表 | 共享刷新锁并二次检查缓存；32 个并发读取只执行一轮探测；强制刷新仍生效，缓存命中不等待正在进行的强制刷新；取消后锁可继续使用 |
| 异步任务中的程序发现 | 同步 shell 查找阻塞 Tokio 工作线程 | 模型目录探测，以及注册表的 Codex / DeepSeek / Cursor 路径发现，转移到 blocking 线程池 |

Codex / OpenCode / Qoder 的模型 CLI 自身使用 4 秒超时；这不包含程序路径发现时间。Cursor 保留原有各操作的超时，仅补齐取消和超时清理。成功目录缓存意味着 CLI 提供的新模型最多延迟约 60 秒可见，本地配置与档案仍按请求读取。

### 可重复测量

本机 macOS 上，使用 `/bin/sh` 启动一个等待 20 ms 后输出模型名的本地探测进程，连续查询 32 次：

| 方式 | 总耗时 | 子进程启动次数 |
| --- | ---: | ---: |
| 每次启动 | 1,024.85 ms | 32 |
| 共享缓存 | 31.08 ms | 1 |

这是探测开销的合成基准，约减少 97% 的总等待；不代表模型生成、网络响应或完整任务执行速度。计时没有作为单元测试的硬阈值，避免机器负载造成偶发失败。

复现命令：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib cli_probe::tests::benchmark_repeated_model_probes -- --ignored --nocapture
```

## 验证结果

- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=4`：656 通过，0 失败；1 个手动基准默认忽略，已单独执行通过。git 相关测试会在系统临时目录建仓库，需要在沙箱外运行。
- `cargo check --lib`：本轮改动文件无新增 warning。
- `bun run test`：4,080 通过，0 失败，覆盖 564 个文件（本轮未改前端代码）。
- `bun run build`（第一部分时执行）：TypeScript、生产构建、启动资源性能检查通过；Mermaid 保持延迟加载。第二部分未改前端，未重复执行。
- `git diff --check`：通过。

第一部分全量检查中修正了两项 Agent 测试读取本机真实安装状态的问题：路径回退纳入 Probe 接口，测试使用替身，并补测回退路径仍可正常使用。另外，空 env 测试改用不会自动生成 effort env 的用户设置（ultracode 的专门测试保留），迁移顺序断言补齐已经存在的第 053 项迁移。这些修改没有改变对应的配置或迁移行为。

本轮验证覆盖本地命令、并发和取消行为，未测量数小时真实 AI 会话的内存曲线，也未进行 Windows / Linux 实机验证，未在打包应用中手动点测界面。Unix shell 保护通过条件编译接入，Windows 原有路径发现保留。

同步命令改为异步后，原先被主线程顺带串行化的 git 写操作（切换分支、建删 tag 等）可能与状态刷新并发执行；git 自身的 `index.lock` 会拒绝冲突写入，而不是损坏仓库，与既有异步 git 命令（stage、commit、push）的行为一致。

## 后续可选项

- ~~应用退出时没有统一结束仍在运行的 Claude / Codex 子进程。~~ 已在 `src-tauri/src/app_shutdown.rs` 处理，见 `docs/memory-session-lifecycle-audit.md` 第二轮。
- 守卫测试只检查命令体本身，不追踪其调用的辅助函数；新增命令仍需按「会等待进程或 libgit2 就用 async + spawn_blocking」的约定编写。
