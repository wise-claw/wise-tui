# Design — Mission Control 13-criterion closeout

## 0. 设计原则

- **不重做**已有后端命令与前端组件；只在断链处串。
- 任何需要新的 Rust 命令都必须沿用 `mission_control.rs` / `trellis_runtime.rs` / `prd_split_pipeline.rs` 的现有 helper（`mission_upsert_agent_assignment` / `trellis_runtime_upsert_agent_run` / `mission_append_event` / `insert_runtime_event` / `runs_base_dir` 等）。
- 任何新的前端 hook 都必须接到 `useSplitWizardState` 的 reducer 而不是引入新 store；UI 不直接 `invoke`，所有 IPC 走 `services/missionControlBackend.ts` / `services/trellisRuntime.ts` / `services/prdSplit/*`。

## 1. F1 — Splitter dispatch ↔ Trellis Runtime parity

### 接口变更

- 新增 `src/services/trellisRuntime.ts`：在已有 `trellisRuntimeUpsertAgentRun` 基础上 export `trellisRuntimeCompleteAgentRun(input)`（薄包装 `trellis_runtime_upsert_agent_run`，发送 status=`succeeded`|`failed`|`cancelled` 加 completedAt）。无需新 Rust 命令——`trellis_runtime_upsert_agent_run` 的 SQL 已经在 status ∈ {succeeded, failed, cancelled, completed} 时自动写 completed_at。
- `runMissionActions.ts` `runSingleCluster` 在 line 92 的 `upsertMissionAgentAssignmentSafe(...)` 后并发调用 `trellisRuntimeUpsertAgentRunSafe(missionId, { agentRunId: assignmentId, agentType:"trellis-splitter", stage:"split", status:"running", projectId, rootPath, repositoryPath, repositoryId, taskPath: parentTaskPath ?? null, metadata })`。该 helper 在 missionId 为 null 时 no-op。
- 完成 / 失败时同步调用 `trellisRuntimeUpsertAgentRunSafe(...status:"succeeded"|"failed", metadata:{ exitCode, stdoutPath, stderrPath, runDir })`。Rust 端的 upsert_agent_run 已经在每次 status 变化时 emit `trellis.agent.upserted` runtime event；本任务追加一次 `trellisRuntimeRecordEventSafe({ eventKind:"trellis.agent.completed", correlationId: agentRunId, payload:{ exitCode, stdoutPath, stderrPath, runDir }})` 让 RuntimeEventFeed 有显式终态事件。
- 修复 `MissionControl.tsx:285`：把 `runSingleCluster(cluster, api.state, api)` 改为 `runSingleCluster(cluster, api.state, api, api.state.activeMissionId ?? null)`。需要在 `useSplitWizardState` 暴露 `activeMissionId`（reducer 已经在 dispatch start 时由 `persistMissionSnapshot` 返回 missionId，只需把它存进 state.activeMissionId 并由 api 读出）。

### 数据流

```
[user click "重试 cluster"] → MissionControl.handleRetryCluster
   → runSingleCluster(cluster, state, api, state.activeMissionId)
      → upsertMissionAgentAssignmentSafe(missionId, ...)
      → trellisRuntimeUpsertAgentRunSafe(missionId, { agentRunId: assignmentId, status:"running" })
      → dispatchClusterSplit(...)
      → on success/failure:
         completeMissionAgentAssignmentSafe(assignmentId, ...)
         trellisRuntimeUpsertAgentRunSafe(missionId, { agentRunId, status })
         trellisRuntimeRecordEventSafe({ eventKind:"trellis.agent.completed", correlationId: agentRunId, ... })
```

### 测试

- TS：`runMissionActions.test.ts` 增 case：retry 路径携带 missionId 时 trellisRuntimeUpsertAgentRunSafe 被调用；missionId=null 时 no-op。
- Rust：`mission_control.rs` 已有 assignment 测试，无需新增；`trellis_runtime.rs` 单测覆盖 agent run lifecycle 已存在。

## 2. F2 — Failure evidence + retry-from-runDir

### 后端

- 新增 Tauri 命令 `prd_split_retry_run`，位于 `prd_split_pipeline.rs`：
  ```rust
  #[derive(Deserialize)]
  pub struct RetryRunInput {
      pub run_id: String,           // 旧 run_id
      pub mission_id: Option<String>,
      pub cluster_id: String,       // 必传，从 dispatch.meta.json 校验一致
      pub project_root_path: String,
      pub model: Option<String>,
  }
  pub struct RetryRunOutput {
      pub new_run_id: String,
      pub new_run_dir: String,
  }
  ```
  实现：
  1. 解析旧 `run_dir`，读 `dispatch.meta.json` + `prompt.md`；校验 `cluster_id` 一致，否则报错。
  2. 调用现有 `dispatch_cluster_impl` 的内部 entrypoint（重构出 `dispatch_with_prepared_prompt(prompt, cluster_id, project_root_path, model, app, db, …)`），返回新 `run_id` / `run_dir`。
  3. 在旧 `run_dir/run-result.json` patch `"superseded_by": <new_run_id>`，并在 `dispatch.meta.json` 添加 `"retried_from": <old_run_id>` 到新 run。
- 写入 `mission_events`（type=`mission.cluster.retried`，payload 含 `oldRunId`、`newRunId`、`clusterId`）。

### 前端

- `services/prdSplit/splitterDispatch.ts` 新增 `retryClusterFromRunDir(input)` wrapper。
- `actions/runMissionActions.ts` 新增 `retryClusterFromRunDir(runId, clusterId, state, api, missionId)`：基本流程同 `runSingleCluster` 但跳过 PRD 解析 / parent 创建 / planner 调用，直接调 Tauri 命令并接管 splitter 事件流。
- `details/TaskDetailDrawer.tsx` 失败分支新增 `FailureEvidenceBlock` 子组件：渲染 `exitCode` / `stdoutPath` / `stderrPath` / `runDir`，每行带"打开"/`copy()` 按钮。"打开"按钮使用 `@tauri-apps/plugin-shell` 的 `open(path)`。
- 失败卡片新增"从 runDir 重试"按钮（次级按钮，旁边保留"重新生成"全量重跑），调 `retryClusterFromRunDir`。

### Tauri capability 增量

- 检查 `src-tauri/capabilities/default.json` 已有 `shell:default` / `dialog:default` / fs read scope。若 `open()` 没批准，按最小 scope 加 `shell:allow-open`（限制 stdoutPath 等位于 `~/.wise/prd-runs/**`）。

### 测试

- Rust：`prd_split_pipeline.rs` 新增单测覆盖 `retry_run` 读 dispatch.meta.json 一致性校验、生成 superseded_by patch。
- TS：`runMissionActions.test.ts` 增 case：retryClusterFromRunDir 调用 splitter retry 命令并把新 run 接入 splitterStream。

## 3. F3 — Mount and reconcile background PRD runs

### 后端

- 新增 Tauri 命令 `prd_split_list_active_runs`（与 `prd_split_list_legacy_runs` 并列）：返回 `Array<{ runId, clusterId, runDir, startedAtMs, status, exitCode, stdoutTail, stderrTail, hasRunResult, projectRootPath, missionId }>`。
  - 实现：扫描 `~/.wise/prd-runs/*/`，解析 `dispatch.meta.json`（已含 `clusterId`、`runId`、`runDir`、`projectRootPath`、`missionId`、`model`）+ `run-result.json`（如存在）。
  - `status`：
    - `succeeded` / `failed` 来自 `run-result.json`
    - 无 `run-result.json` 且 `dispatch.meta.json` 存在 → `running`（注：本机重启后无法区分 running vs crashed，UI 按 90s 阈值判 stale）
- 复用 `read_repo_context` 与现有 helper，禁止重复实现 dir 扫描。

### 前端

- `useMissionRunStore` 改 invoke 名为 `prd_split_list_active_runs`；返回结构对齐新 schema。
- 在 `MissionControl.tsx` `useEffect`（挂载时）调用 `useMissionRunStore()` 并把结果 reduce 到 `api.setClusterRun(clusterId, ...)`（仅当 wizard state 已有该 cluster）。
  - 若 `hasRunResult === false` 且 `startedAtMs` 距今 > 90s 且无近期 splitter event → 标记 `stale`，error 字段含 `runDir`，让 F2 的"从 runDir 重试"可见。
- 监听 `splitter-output` / `splitter-progress` 事件时若 cluster 在 backgroundRuns 但不在 wizard state（用户没解析 PRD 直接重开），把它独立挂在 `MissionControl` 的"未关联运行"区域；本期范围仅在 cluster 已存在时合并。

### 测试

- Rust：`prd_split_list_active_runs` 单测覆盖三种状态（succeeded / failed / running）。
- TS：`useMissionRunStore` 测试用 vi.mock invoke 验证 list → reduce 流程。

## 4. F4 — Bind main chat dispatch to active mission

### 后端

- 无新增 Rust 命令（`mission_attach_to_session` / `mission_record_agent_command` / `mission_append_instruction` / `mission_append_event` 已就绪）。
- `mission_record_agent_command` 现已 emit `mission.agent_command.<commandType>` 事件，本任务沿用 `commandType="mention"`。

### 前端

- 新增 `src/services/mission/sessionBinding.ts`：
  ```ts
  export async function ensureSessionBoundToActiveMission(sessionId, projectId, rootPath): Promise<string | null> {
    const existing = await missionGetSessionMission(sessionId);
    if (existing) return existing.missionId;
    const recent = await missionListRecent({ projectId, limit: 5 });
    const active = recent.find(m => m.stage !== "done" && m.stage !== "archived");
    if (!active) return null;
    await missionAttachToSession({ sessionId, missionId: active.missionId, projectId });
    return active.missionId;
  }
  ```
- 在 `AppImpl.tsx` Claude session 创建 / 激活时（已有 sessionId 派生处）调用 `ensureSessionBoundToActiveMission`。
- 在 `ClaudeChatInput/composer-region.tsx` commit handler（搜 commit 路径）解析消息中的 `@xxx` token（已有 mention 解析？若没有，做最简：正则 `@\w+`），对每个 mention 调 `missionRecordAgentCommand({ missionId, commandType:"mention", targetKind:"text", targetId: mention })`；并 `missionAppendEvent({ missionId, eventType:"mission.session.message", payload:{ sessionId, snippet, mentions } })`。
- `MissionReplayPanel`：每条事件 payload 若含 sessionId，新增"跳到会话"按钮 → dispatch 现有 `WORKFLOW_UI_EVENT_OPEN_CLAUDE_SESSION` 或类似事件（若不存在则简化为只显示 sessionId 文本）。

### 测试

- TS：`sessionBinding.test.ts` 覆盖 attach 流程；`runMissionActions.test.ts` 已存在的事件 append 不需变。

## 5. F5 — Reassign impact preview before cluster moves

### 后端

- 无新增 Rust（`mission_preview_requirement_reassign` + `mission_commit_requirement_reassign` 已就绪）。

### 前端

- `services/missionControlBackend.ts` 已 export `missionPreviewRequirementReassign` / `missionCommitRequirementReassign`（确认；缺则补 wrapper）。
- `MissionControl.tsx` `handleMoveRequirement` 改为：
  ```ts
  const handleMoveRequirement = async (requirementId, targetClusterId) => {
    if (!api.state.activeMissionId) {
      api.reassignRequirement(requirementId, targetClusterId); // mission-less fallback
      return;
    }
    const preview = await missionPreviewRequirementReassign({
      missionId: api.state.activeMissionId, requirementId, targetClusterId,
    });
    Modal.confirm({
      title: "确认调整需求归属？",
      content: <ReassignPreviewBlock preview={preview} />,
      onOk: async () => {
        await missionCommitRequirementReassign({
          missionId, requirementId, targetClusterId, previewId: preview.previewId,
        });
        api.reassignRequirement(requirementId, targetClusterId);
        for (const agent of preview.affectedAgents) {
          if (agent.shouldCancel) {
            await missionRecordAgentCommand({ missionId, commandType:"cancel", targetKind:"assignment", targetId: agent.assignmentId });
          }
        }
        // 标记受影响 cluster needs_resplit
        for (const c of preview.dirtyClusterIds) api.markClusterNeedsResplit(c);
      },
    });
  };
  ```
- `useSplitWizardState` 新增 `markClusterNeedsResplit(clusterId)` action + `clusterNeedsResplit: Record<string, boolean>` state。
- `TaskSwimlane` / `header/MissionAgentSummary` 读 `clusterNeedsResplit`，渲染 badge；"生成任务" CTA 在有脏 cluster 时禁用并提示。
- 新增 `details/ReassignPreviewBlock.tsx`：渲染 preview 数据。

### 测试

- TS：`handleMoveRequirement` 路径单测：missionId null 时直接 reassign，missionId 存在时调 preview/commit + 派 cancel 指令。
- 实际 UI 交互（Modal 弹出）由用户验收，不在自动化测试范围。

## 6. F6 — Heartbeat / stale propagation

### 后端

- 新增 Tauri 命令 `trellis_agent_heartbeat(agent_run_id)`：
  ```rust
  #[tauri::command]
  pub(crate) fn trellis_agent_heartbeat(
      app: tauri::AppHandle, db: tauri::State<'_, WiseDb>, agent_run_id: String,
  ) -> Result<(), String> {
      // throttle: ignore if last heartbeat was < 5s ago
      // update trellis_agent_runs.last_heartbeat_at = now
      // also update mission_agent_assignments where agent_run_id matches
      // emit trellis.agent.heartbeat (throttled 5s/agent)
  }
  ```
  实现：直接 `UPDATE trellis_agent_runs SET last_heartbeat_at = ?1 WHERE agent_run_id = ?2 AND (?1 - last_heartbeat_at >= 5000)`，受影响行数 > 0 才 emit event。
- 后端 background scanner：在 `lib_impl.rs` setup 中 `tauri::async_runtime::spawn` 每 30s 跑一遍：
  - SELECT agent_run_id FROM trellis_agent_runs WHERE status='running' AND (?now - last_heartbeat_at) > 90000
  - 对每行调 `trellis_runtime_upsert_agent_run({ status:"stale", agent_run_id, ... })` 不变更其他字段
  - 在 mission_agent_assignments 同步标记 `status='stale'`（沿用现有 helper）
  - 节流 emit `trellis.agent.stale` 事件（同 agent 60s 最多 1 次，记忆体内 HashMap<agent_run_id, last_emit_ms>）

### 前端

- `services/missionControlBackend.ts` wrapper `missionListAgentAssignments` 增加默认值 `staleAfterMs: 90_000`，caller 不必显式传。
- `runMissionActions.runSingleCluster` 中 dispatch await 期间：
  ```ts
  const heartbeat = setInterval(async () => {
    if (missionId && assignmentId) {
      await trellisAgentHeartbeat(assignmentId); // assignmentId ≡ agentRunId per F1 contract
    }
  }, 30_000);
  try { ... } finally { clearInterval(heartbeat); }
  ```
- `RuntimeEventFeed` 增加 `trellis.agent.stale` icon 与文案（灰色 + "stale"）。
- `TaskCard.agentStatus` 在 status==`stale` 时显示灰色 chip + tooltip "上次心跳 N 秒前"。

### 测试

- Rust：`trellis_runtime.rs` 单测覆盖 heartbeat throttle、background scanner stale 转换。
- TS：`runMissionActions.test.ts` 用 vi.useFakeTimers 验证 30s 心跳；`RuntimeEventFeed.test.tsx` 渲染 stale 状态。

## 7. F7 — Visualize .trellis/workflow.md

### 后端

- 无变更。

### 前端

- 新增 `src/components/MissionControl/engineering/WorkflowGraphPanel.tsx`：
  - 调用 `compileTrellisWorkflow({ projectId, rootPath })`（已存在）。
  - 渲染：每个 phase 卡片 → step list（id + label + platform tag + validation badge）。
  - 错误状态：command 失败 → 空状态 + 重试按钮。
- 在 `EngineeringDrawer.tsx` 新增 "Workflow" tab，挂 `WorkflowGraphPanel`。
- `SpecRevisionTimeline` 选中条目时通过 props 把 `filePath` 传到 `WorkflowGraphPanel`，panel 内 highlight 同 filePath 的 step（简易匹配 step.filePath 含 selectedFilePath）。

### 测试

- TS：`WorkflowGraphPanel.test.tsx` 用 vi.mock service 验证 phase / step 渲染、错误状态。

## 8. 数据模型增量

- `useSplitWizardState` state 增加：
  - `activeMissionId: string | null`
  - `clusterNeedsResplit: Record<string, boolean>`
- 对应 reducer action：`setActiveMissionId`、`markClusterNeedsResplit`、`clearClusterNeedsResplit`。
- 持久化：不持久化到 localStorage（mission_runs 表已经是 source of truth）。

## 9. 风险与回退

| 风险 | 缓解 |
|---|---|
| F1 修复 retry 时 missionId 仍为 null（mission 创建失败） | retry 路径 fallback 到直接 dispatch（沿用现有 no-op 行为），UI 提示"无 mission，本次重试不会记录到 ledger" |
| F2 retry_run 重构 `dispatch_with_prepared_prompt` 改动面较大 | 设计上抽 thin helper 而不是大重构；保留原 entrypoint 函数体调用此 helper |
| F3 list_active_runs 全量扫描慢 | `~/.wise/prd-runs/` 目录有限（每 run 一目录，体量小）；按 mtime 倒序，可加 limit=50 |
| F4 ClaudeChatInput commit 路径耦合复杂 | mention 解析失败时不阻断 commit；事件 append 失败仅打日志 |
| F5 preview 命令需要 mission snapshot 是最新 | commit 失败时 toast 提示用户刷新 |
| F6 background scanner 影响启动时间 | spawn 在 setup 完成后 5s 启动；轮询失败仅 log，不 panic |
| F7 workflow.md 解析失败 | command 已 returns validation_issues；panel 容忍空 phases |

## 10. 改动文件清单（预计）

Rust（≤ 250 行净增）：
- `src-tauri/src/claude_commands/prd_split_pipeline.rs`：F2 retry_run、F3 list_active_runs
- `src-tauri/src/trellis_runtime.rs`：F6 heartbeat、F6 background scanner、F6 stale event
- `src-tauri/src/lib_impl.rs`：注册新命令 + setup scanner（≤ 15 行新增）

前端（≤ 1200 行净增）：
- `src/services/missionControlBackend.ts`：F5 / F6 wrapper（≤ 80 行）
- `src/services/trellisRuntime.ts`：F1 / F6 wrapper（≤ 60 行）
- `src/services/prdSplit/splitterDispatch.ts`：F2 retry wrapper（≤ 40 行）
- `src/services/mission/sessionBinding.ts`：F4 新（≤ 80 行）
- `src/components/MissionControl/actions/runMissionActions.ts`：F1 / F2 / F6（≤ 200 行修改）
- `src/components/MissionControl/actions/useMissionRunStore.ts`：F3 改写（≤ 80 行）
- `src/components/MissionControl/MissionControl.tsx`：F1 / F3 / F5 / F7 接线（≤ 120 行修改）
- `src/components/MissionControl/details/TaskDetailDrawer.tsx`：F2 失败块（≤ 100 行新）
- `src/components/MissionControl/details/FailureEvidenceBlock.tsx`：F2 新（≤ 120 行）
- `src/components/MissionControl/details/ReassignPreviewBlock.tsx`：F5 新（≤ 100 行）
- `src/components/MissionControl/engineering/WorkflowGraphPanel.tsx`：F7 新（≤ 150 行）
- `src/components/MissionControl/canvas/TaskCard.tsx`：F6 stale chip（≤ 40 行）
- `src/components/MissionControl/canvas/RuntimeEventFeed.tsx`：F6 stale 图标（≤ 30 行）
- `src/components/PrdSplitWizard/useSplitWizardState.ts`：F1 activeMissionId / F5 clusterNeedsResplit（≤ 60 行）
- `src/AppImpl.tsx`：F4 session-bind 调用（≤ 15 行，符合 E4 约束）
- `src/components/ClaudeChatInput/composer-region.tsx`：F4 mention hook（≤ 40 行，落到独立 helper）

测试（≤ 600 行新增）。
