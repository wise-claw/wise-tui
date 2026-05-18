# F3 mount and reconcile background PRD runs

## Parent

`05-16-mission-control-acceptance-closeout/design.md §3` 与 `implement.md Step 4`。

## Scope

1. 新增 Rust 命令 `prd_split_list_active_runs` 返回 `Array<{ runId, clusterId, runDir, startedAtMs, status, exitCode, stdoutTail, stderrTail, hasRunResult, projectRootPath, missionId }>`：扫 `~/.wise/prd-runs/*`，解析 `dispatch.meta.json` + `run-result.json`。
2. `useMissionRunStore` 改读新命令，类型对齐。
3. `MissionControl.tsx` 顶层 `useMissionRunStore()`，挂载 effect：把 backgroundRuns reduce 进 wizard state（`api.setClusterRun(clusterId, ...)`）。
4. orphan run（无 run-result.json 且 startedAt 距今 > 90s）→ `status:"failed"` + error.runDir，让 F2 的"从 runDir 重试"可见。
5. 沿用现有 splitter-output / splitter-progress 订阅；不引入新事件。

## Out of Scope

- 不做"未关联到当前 wizard 的孤儿 run 浮层"（cluster 已存在时才 merge，否则忽略）。
- 不做 PRD 自动 reparse。
- 不改 dispatch / runDir 落盘格式。

## Acceptance

- [ ] 关闭 Mission Control 时未完成的 run，重开后立刻显示为 `dispatching` 状态并继续接收 splitter 事件。
- [ ] 90s+ 无 run-result 的 orphan run 显示为 failed + error.runDir 不为空。
- [ ] Rust 单测覆盖 3 种状态（succeeded / failed / running）。
- [ ] TS 单测覆盖 useMissionRunStore 的 reduce 流程。
- [ ] `cargo check` + `cargo test prd_split_list_active` + `bun test` + `bunx tsc --noEmit` 通过。
