# F6 heartbeat and stale propagation across assignment consumers

## Parent

`05-16-mission-control-acceptance-closeout/design.md §6` 与 `implement.md Step 2`。

## Scope

1. Rust 新增 `trellis_agent_heartbeat(agent_run_id)` 命令：5s throttle（SQL `WHERE ?now - last_heartbeat_at >= 5000`），更新 `trellis_agent_runs` 与同 agent_run_id 的 `mission_agent_assignments`，emit `trellis.agent.heartbeat`。
2. Rust 后端 background scanner：`tauri::async_runtime::spawn` 每 30s 跑：找 `trellis_agent_runs` 中 status=running 且 90s 无心跳的，调 `trellis_runtime_upsert_agent_run({ status:"stale", ... })`，同步 mission assignment status；emit `trellis.agent.stale`（同 agent 60s 节流，记忆体 HashMap）。
3. `services/missionControlBackend.ts.missionListAgentAssignments` wrapper 默认 `staleAfterMs: 90_000`。
4. `runMissionActions.runSingleCluster` await dispatch 期间 `setInterval(30000)` 调心跳，try/finally clear。
5. `RuntimeEventFeed.tsx` 新增 `trellis.agent.stale` 图标 + 文案；`TaskCard.tsx` status=stale 时灰色 chip + tooltip "上次心跳 N 秒前"。

## Out of Scope

- 不实现 trellis-implement / trellis-check 子代理的心跳（本期只覆盖 splitter）。
- 不修改现有 `mission_list_agent_assignments` 后端 stale 计算逻辑。
- 不引入持久化的心跳记忆（重启后 60s 节流 HashMap 清零可接受）。

## Acceptance

- [ ] dispatch 长跑 > 90s 时 assignment 与 agent_run last_heartbeat_at 持续刷新，不被误判 stale。
- [ ] 强制 kill splitter 进程后 90s 内 background scanner 把它标 stale，runtime feed 出现 `trellis.agent.stale` 事件。
- [ ] 任意 caller 调 mission_list_agent_assignments 都拿到 stale 计算后的状态（前端不必显式传 staleAfterMs）。
- [ ] heartbeat throttle：30s 调用 6 次只产生 1 次 emit / DB update。
- [ ] Rust 单测覆盖 throttle 与 scanner；TS 单测覆盖 setInterval 心跳。
- [ ] `cargo check` + `cargo test trellis_runtime` + `bun test` + `bunx tsc --noEmit` 通过。
