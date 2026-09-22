# 长时间运行与会话回收检查（2026-09-22）

检查确认存在以下资源残留路径，已修复。它们可以造成后台进程、任务、事件回调或映射条目随使用累积；本次没有通过真实应用的连续 RSS/堆快照采样量化各问题对实际卡顿的贡献。

| 问题 | 触发与影响 | 修复位置 |
| --- | --- | --- |
| 定时回收只执行一次 | `finally()` 返回的新 Promise 与原 Promise 比较，导致 `reclaimInFlight` 永远不清空；即使首轮没有可回收进程，之后的周期扫描也一直跳过 | `src/hooks/useClaudeSessions.streamingReclaim.ts`：保存并返回同一个受跟踪 Promise，成功、异常均释放标记，排队的 spawn 回收保留自己的所有权 |
| Codex 断连后后台任务空转 | `.try_recv().ok()` 混淆暂时无消息与通道永久关闭；任务每 50 ms 继续轮询，持有会话和流状态，无法进入清理 | `src-tauri/src/codex_rpc_session.rs`、`codex_rpc_commands.rs`：显式区分断连，先消费缓冲中的完成事件，退出后关闭子进程；按 Arc 身份检查会话槽，防止旧任务摘掉替换后的会话 |
| RPC 等待记录残留 | 请求登记后发生 stdin 写入失败、超时或 Future 取消，原 sender 留在存活连接的请求表中 | `src-tauri/src/pending_rpc_request.rs` 及 Codex / Cursor / OpenCode ACP transport：由响应等待对象拥有登记，Drop 自动移除，覆盖写入阶段和等待阶段；DeepSeek 复用通用 ACP transport |
| 终端面板异步连接期间卸载泄漏 | DOM 事件、终端订阅、主题订阅和观察器先注册，清理函数却等 attach/open 返回才交给 effect；中途切换面板会跳过清理，后续连接失败还可能启动新 PTY | `src/hooks/useTerminalSession.ts`：IPC await 前登记幂等清理；取消后不继续启动，要求关闭时清理迟到的 PTY |
| 已完成执行的登记和路由持续累积 | 多种适配引擎完成后只更新状态，没有删除运行注册表项；invocation 到标签的映射主要在取消时移除，普通完成会残留 | `src-tauri/src/claude_events.rs`、`claude_commands.rs`：完成事件统一移除已完成运行登记和 invocation 路由；保留仍处于 running 的登记 |

磁盘会话、聊天记录、终端功能和各执行引擎接口均保留。清理对象是临时运行状态。

## 验证

- 相关前端测试：8 个文件、37 项通过，覆盖 100 次重复回收、异常与并发回收、终端连接中卸载、迟到 PTY、30 次隐藏/显示、会话 sidecar 和消息内存上限。
- 新增后端测试：11 项通过，覆盖 10,000 次取消请求/断连/已完成会话与 invocation 回收，以及锁竞争、缓冲完成事件、真实本地管道写入失败与取消。管道测试只启动本地 `/bin/cat`，不调用外部 AI 服务。
- `bunx tsc -p tsconfig.app.json --noEmit` 通过；`git diff HEAD --check` 通过。
- 全量 `cargo test --lib --manifest-path src-tauri/Cargo.toml`：632 项通过，4 项失败，全部新增测试通过。

全量失败项位于本次未修改的模块：

1. `agent_registry_failure_probe_can_synthesize_all_builtin_agents`：测试预期探测失败，本机仍发现可用 Codex。
2. `agent_registry_probe_failure_marks_agent_unavailable`：测试预期 unavailable，实际 available；Agent 测试单独串行运行也复现上述两项失败。
3. `build_spawn_settings_payload_user_only_omits_empty_env`：实际用户设置载荷包含 env，与测试预期不符。
4. `migration_registry_preserves_ordered_names`：运行注册表包含第 053 项迁移，测试预期名单止于 052。

## 验证边界

本次是代码路径检查和可重复生命周期测试，未执行数小时真实 Wise UI、多引擎和大历史会话的持续压力运行。因此不能据此断言所有内存增长或卡顿均已消除。后续真实运行采样应同时记录主进程/WebView/子进程内存、存活子进程数和关闭会话后的回落情况，区分缓存保留、系统分配器保留与持续泄漏。
