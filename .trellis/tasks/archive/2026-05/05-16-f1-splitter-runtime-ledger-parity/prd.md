# F1 runtime ledger parity for splitter dispatch

## Parent

`05-16-mission-control-acceptance-closeout/design.md §1` 与 `implement.md Step 1`。本任务沿用父任务约定，无独立 design / implement。

## Scope

1. Splitter dispatch 路径在每个 `upsertMissionAgentAssignmentSafe(...)` 旁并发 `trellisRuntimeUpsertAgentRunSafe(missionId, { agentRunId: assignmentId, agentType:"trellis-splitter", stage:"split", status, projectId, rootPath, repositoryPath, repositoryId, taskPath, metadata })`，让 mission `agent_run_id` ≡ trellis `agent_run_id`。
2. 终态（succeeded / failed）同步 update trellis agent run，并 `trellisRuntimeRecordEventSafe({ eventKind:"trellis.agent.completed", correlationId: assignmentId, payload:{ exitCode, stdoutPath, stderrPath, runDir } })`。
3. `useSplitWizardState` 新增 `activeMissionId: string | null` + reducer action `setActiveMissionId`；`runMissionClusters` 在拿到 mission.missionId 后写入。
4. 修复 `MissionControl.tsx` `handleRetryCluster`：调 `runSingleCluster(cluster, api.state, api, api.state.activeMissionId ?? null)`。

## Out of Scope

- 不引入新 Rust 命令。
- 不改变现有 `upsertMissionAgentAssignmentSafe` / `completeMissionAgentAssignmentSafe` 的语义。
- 不改 splitter prompt / dispatch_cluster_impl 行为。

## Acceptance

- [ ] 重试 cluster 时 mission_agent_assignments 与 trellis_agent_runs 均看到新 row / status 更新。
- [ ] `trellis_runtime_events` 看到 `trellis.agent.upserted`（status=running）→ `trellis.agent.upserted`（status=succeeded/failed）→ `trellis.agent.completed`。
- [ ] missionId 为 null（用户尚未创建 mission）时所有调用 no-op，不报错。
- [ ] `bun test src/components/PrdSplitWizard src/components/MissionControl` 与 `bunx tsc --noEmit` 通过。
