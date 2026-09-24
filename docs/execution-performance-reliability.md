# 执行性能与稳定性优化（2026-09-23）

本轮针对 Agent 发现、模型目录查询、短命令生命周期、IPC 主线程阻塞与 Claude 会话收尾，减少重复进程启动，避免外部命令卡住、界面冻结或会话卡在「运行中」。现有执行引擎、配置模型、档案、自定义 Agent、查找回退路径和全部 IPC 命令（名称与参数）均保留，没有删除后端能力。

## 第四部分：第三部分复核后的剩余项（2026-09-24）

| 场景 | 原有问题 | 当前行为与验证 |
| --- | --- | --- |
| `extensions_reload`、`chrome_page_monitor_download_extension`（及兼容入口 `chrome_page_monitor_open_extension_dir`）、`kill_claude_host_process` | 第三部分之后仍为同步命令：扩展目录重扫、导出扩展目录拷贝、等待 `kill` 子进程都在主线程执行 | 改为 `async` + `blocking_ipc::run_blocking`，命令名与参数不变 |
| 批量标记 OMC 通知已读、标签合并为会话后迁移工作流引用 | 循环 `UPDATE` 各自自动提交；迁移中途遇到损坏的 payload 会留下「任务已改、运行记录未改」的半迁移状态 | 放进 `in_write_tx` 单事务并复用预编译语句；失败整体回滚。测试 `migrate_claude_tab_session_references_is_atomic` 覆盖回滚与修复后重试 |
| `list_employees`、`list_stage_assignees` | 持全局数据库锁逐行 `prepare` + 查询（N+1） | 员工仓库关系一次查询后按员工分组；阶段查询语句只准备一次。测试 `list_employees_groups_repository_ids_per_employee_in_link_order` 确认分组与顺序不变 |
| 工作台配置中心首次打开 | `AuthorPanel` 静态引入约 20 个子面板（含 `@antv/x6` 工作流画布、插件市场、钩子编辑器），打开任一页都要加载全部 | 各子面板 `lazy`，`Suspense` 兜底；测试改用 `renderToReadableStream` + `allReady` 等待懒加载内容，断言不变 |
| 需求编辑弹窗 | `WorkspaceRequirementModal` 常驻挂载在工作区布局中，模块与需求面板样式进入工作区首屏 chunk | `DeferredWorkspaceRequirementModal`：首次打开时加载，此后保持挂载以保留关闭动画；侧栏需求列表自带样式，不依赖被延后的样式表 |
| 后台线程 panic 无记录 | 打包应用中 stderr 不可见，后台线程 panic 只在日志之外消失，排查「偶发卡住 / 功能失效」没有线索 | `panic_log::install()`：保留默认 hook，同时把时间、线程、位置、消息与回溯追加到 `~/.wise/logs/panic.log`，超过 1 MiB 轮转为 `panic.log.1` |

本部分验证（在第三部分改动之上执行）：

- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=4`：672 通过，0 失败，1 个手动基准默认忽略。
- `cargo check --lib`：0 warning。
- `bun run test`：4,089 通过，0 失败，覆盖 564 个文件。
- `bunx tsc -p tsconfig.app.json --noEmit`、`git diff --check`：通过。
- 同样未执行 `bun run build`，懒加载收益以静态依赖关系为依据，没有 chunk 体积前后数据；未在打包应用中手动点测。

复核时评估后未改动的项：`ClaudeSessions` 内的 `Topbar` 静态引用（工作区布局在启动时已并行预取同一 chunk，多窗格网格也静态使用它，改为懒加载不减少启动加载量）；多窗格布局读取旧 key（只在新 key 为空时发生一次迁移读取）；`useWiseHudBridge` 依赖 `sessions`（已有 80 ms 去抖与按内容去重，HUD 未激活时不带消息体，流式 token 走独立的 live store，不随每次 flush 触发）。

## 第三部分：剩余主线程阻塞、锁中毒、事务与前端启动（2026-09-24）

| 场景 | 原有问题 | 当前行为与验证 |
| --- | --- | --- |
| 42 个仍为同步的 IPC 命令：MCP 增删（内部等待 `claude mcp` CLI）、项目工作区同步（深度 12 的 `WalkDir`）、composer 图片 GC 统计/执行与数据清理（递归扫描 `~/.claude/projects/**/*.jsonl`）、FCC trace 列表/清空、仓库条目删除（`remove_dir_all`）、技能 / 子代理 / hooks / memory 枚举、我的扩展快照拷贝与删除、项目相对文件与本地图片（最大 20 MB）读写、外部技能路径探测/扫描/复制导入等 | 同步命令在 macOS 主线程内联执行；上一轮守卫只按词法检查命令体，经辅助函数间接等待进程或遍历目录的命令漏检，大仓库或大量历史会话时界面冻结 | 统一改为 `async` + `blocking_ipc::run_blocking`（`spawn_blocking`，panic 转为命令错误），同步实现保留为 `*_blocking`；命令名和参数不变。需要 `State<WiseDb>` 的命令改由注入的 `AppHandle` 在 blocking 线程取状态，前端调用不变。守卫新增 `WalkDir::new(`、`remove_dir_all(`、`run_claude_mcp_cli(`、composer GC 标记 |
| `stagehand_browse_probe`、`list_repository_explorer_children` | 已是 async，但在 tokio 工作线程上直接执行 `Command::output()` / `read_dir` | 同样转入 blocking 线程池 |
| 剪贴板读图、macOS 语音转写 | — | 有意保留同步：`NSPasteboard` 与 Speech 识别必须在主线程执行，移走不会减少卡顿 |
| `WiseDb` 单连接 `Mutex` | 任一线程持锁 panic 后锁中毒，约 170 处 `map_err("db lock poisoned")` 让所有数据库操作永久失败直到重启 | `wise_db::lock_conn` / `WiseDb::conn()`：恢复中毒锁、清除中毒标记，并回滚 panic 线程遗留的未提交事务 |
| 会话注册表、Codex / Cursor / OpenCode RPC 等待表、扩展注册表 `RwLock`、钉钉网关、远程通道、桌宠、推送、Agent 注册表与快捷键状态 | 67 处 `.lock().unwrap()` / `.read().expect()` / `map_err("lock poisoned")`：一次 panic 后同一把锁的后续访问全部级联 panic 或永久报错（扩展注册表的 `expect` 会直接打断命令） | 改为 `unwrap_or_else(\|e\| e.into_inner())`；这些锁保护的都是可自洽的映射或状态值。终端模拟器锁保留报错，它已由 `catch_unwind` 隔离，panic 后的 VT 状态不可信 |
| 数据库迁移 | 迁移 SQL 与 `_migrations` 记名分别自动提交；中途失败或进程被杀会留下半应用的 schema，下次启动在脏状态上重跑 | 每个迁移与其记名在同一 `BEGIN IMMEDIATE` 事务内提交，失败整体回滚且错误带迁移名；切换 `PRAGMA foreign_keys` 的迁移（事务内该 PRAGMA 无效）保持原自动提交方式 |
| 快捷操作 / 待办整表替换 | `DELETE` + 逐条 `INSERT` 各自自动提交：N 次 WAL 提交，中途失败留下被清空或半写入的列表 | `wise_db::in_write_tx`：单事务 + 预编译语句；已在外层事务中（种子迁移）时直接加入，不嵌套 |
| 外部技能路径探测 / 新增 | 持有全局数据库锁期间对每个路径做 `exists` 和子目录计数，同时阻塞所有其他数据库命令 | 只在读写行时短暂持锁，文件系统探测在释放锁后进行 |
| `agent_registry_list` | 6 个 `useAgentRegistry*Available` hook 在主窗口与工作区布局各挂载一次，冷启动最多 12 次 IPC | `listAgents` 并发调用共享同一个进行中的请求；失败后下次调用重新发起；刷新、安装等更新过注册表后，较早发出的列表响应不再覆盖新快照 |
| 会话标签恢复与流式监听初始化 | 读取 tabs → 默认连接方式 → 迁移标记三次 IPC 串行；三个流式事件 `listen` 串行等待 | 与 tabs 无依赖的两项提前并发发起；三个 `listen` 用 `Promise.allSettled` 并发注册，部分失败时等全部落定再统一释放，不遗漏迟到的监听 |
| HUD 桥接监听、Claude 批量调用监听 | `useWiseHudBridge` 冷启动串行 `await` 13 次 `listen`（13 次串行 IPC）；`services/claude.ts` 每次批量调用前串行注册 3 个监听。中途任一注册失败时，已注册的监听不会释放，外层 async 还会产生未处理的 rejection | 复用 `collectTauriListeners` 并发注册，任一失败时统一释放已注册项；HUD 注册失败记录错误日志 |
| 需求面板 / 快捷操作面板哨兵节点 | 稳定节点 `WORKSPACE_*_PANEL_NODE` 定义在面板模块内，工作区布局和会话模块为拿到节点而静态引入整个面板（含 `react-markdown`、`rehype-raw`），即使面板从未打开 | 节点移到 `components/workspaceAuxPanelNodes.tsx`，面板本体 `lazy` 加载；节点 identity 仍为模块级常量 |
| 局部错误隔离 | 侧栏（含 Git、文件树）、文件编辑器、进度监控、历史会话记录抽屉没有局部 ErrorBoundary，单个面板渲染异常会冒泡到全局兜底页 | 各自包裹 `ErrorBoundary type="local"`，只替换出错面板 |

新增测试：`wise_db::tests::lock_conn_recovers_poisoned_lock_and_rolls_back_open_transaction`（真实线程持锁 panic 后可继续读写，遗留事务被回滚）、`in_write_tx_rolls_back_on_error_and_joins_outer_transaction`、`blocking_ipc::tests`（内部错误原样返回、panic 转为带标签的错误）、`agentRegistry.test.ts` 中 12 个并发调用只发 1 次 IPC、失败不卡死后续调用、慢列表不覆盖新快照。

本部分验证：

- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=4`：669 通过，0 失败，1 个手动基准默认忽略（沙箱外执行，git 测试需要系统临时目录）。
- `cargo check --lib`：0 warning。
- `bun run test`：4,089 通过，0 失败，覆盖 564 个文件。
- `bunx tsc -p tsconfig.app.json --noEmit`、`git diff --check`：通过。
- 未执行 `bun run build`（项目规则不允许未经许可运行前端构建），因此没有 chunk 体积前后对比数据；懒加载的效果以静态依赖关系为依据。未在打包应用中手动点测。

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
