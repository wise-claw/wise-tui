# Mission Control 13 项验收收口 - 串联 splitter / ledger / runtime / 会话 / 编排

## 1. 背景与准确事实复核

经第二轮证据核对，下列能力**已经存在**，本任务不重做：

- Mission Control 主入口、PRD 列表（active / archived / all 筛选）、TaskCard、TraceabilityPanel、MissionReplayPanel、RuntimeEventFeed、SpecRevisionTimeline
- 后端：
  - `mission_runs` / `mission_events` / `mission_agent_assignments`（migration 020）
  - `mission_reassign_previews` / `mission_session_bindings` / `mission_instructions` / `mission_agent_commands` / `mission_evidence`（migration 021）
  - `trellis_runtime_events` / `trellis_agent_runs` / `trellis_spec_revisions` / `trellis_workspace_snapshots`（migration 022）
- 后端命令：`mission_upsert_agent_assignment` / `mission_complete_agent_assignment` / `mission_attach_to_session` / `mission_record_agent_command` / `mission_preview_requirement_reassign` / `mission_commit_requirement_reassign` / `mission_list_agent_assignments`（已支持 `stale_after_ms`）/ `trellis_runtime_upsert_agent_run` / `trellis_runtime_compile_workflow` / `trellis_runtime_record_event` / `trellis_runtime_record_spec_revision`
- Splitter：`prd_split_dispatch_cluster(_background)` 完整 runDir 6 文件、`extract_split_payload_from_json_value` 兜底解析 tool_result、`tokio::spawn` 后台、`splitter-output` / `splitter-progress` / `splitter-complete` Tauri events
- Splitter 调度时调用了 `upsertMissionAgentAssignmentSafe`（`runMissionActions.ts:92`）和 `completeMissionAgentAssignmentSafe`
- PRD 扫描 `trellis_list_requirement_workspace` 支持 `includeArchived` 并跨项目根 / bound repos / floating repos
- `prd_split_list_legacy_runs` 命令已存在；前端 `useMissionRunStore`（`actions/useMissionRunStore.ts:20`）已经实现"挂载时扫描+订阅完成事件"——但**没有任何组件挂载它**
- 前端 service `compileTrellisWorkflow`（`services/trellisRuntime.ts:348`）已存在；UI 未消费

下列是**真正的能力缺口或断链**：

| 项 | 准确判断 | 关键证据 |
|---|---|---|
| F1 | Splitter dispatch 路径已写 `mission_agent_assignments`，但**未写 `trellis_agent_runs`**；重试路径在 `MissionControl.tsx:285` 调 `runSingleCluster(cluster, api.state, api)` 时**丢了 missionId**，导致重试期间所有 ledger 写入静默 no-op | `runMissionActions.ts:92` upsert assignment；`runMissionActions.ts:57-61` 函数签名第 4 参；`MissionControl.tsx:279-291` 只传 3 参 |
| F2 | `TaskDetailDrawer` 能读到 stdout/stderr/runDir，**但失败面板未直接显示 `exitCode` / `stdoutPath` / `stderrPath`**，无"按 runDir 重试"路径；现有 `handleRetryCluster` 把整个 cluster 从头跑 | `MissionControl.tsx:279`；`TaskDetailDrawer.tsx:74-90`；`prd_split_pipeline.rs:548-595` 已有 `prd_split_recover_run` 但仅用于查看 |
| F3 | `useMissionRunStore` 完整存在但**没被 MissionControl 挂载**，且其重建 cluster 状态时只用 `run_id` 而不合并到 `clusterRuns` | `useMissionRunStore.ts:20-73`；`rg useMissionRunStore` 无消费者 |
| F4 | 主会话发送消息时**没有绑定 active mission 也没写 instruction / agent command / mission event**；`mission_attach_to_session` / `mission_record_agent_command` / `mission_append_instruction` 后端就绪 | `services/missionControlBackend.ts:384`；ClaudeChatInput 提交链路无 mission 写入调用 |
| F5 | `handleMoveRequirement` 直接 `api.reassignRequirement`，**完全绕过** `mission_preview_requirement_reassign` 与 `mission_commit_requirement_reassign`，无影响预览 Modal | `MissionControl.tsx:267-273` |
| F6 | `mission_list_agent_assignments` 的 `stale_after_ms` 参数**所有前端 caller 都未传**；splitter 长跑期间**无心跳续租**（仅在 upsert 时刷新 `last_heartbeat_at`），90s+ 后该 assignment 会被任何 stale 扫描误判 | `mission_control.rs:773-796`；splitter dispatch loop 无周期性 heartbeat |
| F7 | `trellis_runtime_compile_workflow` Rust 命令与 `compileTrellisWorkflow` TS service 均存在，**Mission Control 中无 `WorkflowGraphPanel` 消费方** | `services/trellisRuntime.ts:348`；`MissionControl/` 下无 workflow 渲染组件 |

## 2. 7 个子任务（按修正命名）

### F1 · Runtime ledger parity for splitter dispatch

- 在 `runSingleCluster` 内（`runMissionActions.ts`），upsert mission assignment 的同一位置同步调用 `trellisRuntimeUpsertAgentRun({ agentRunId = assignmentId, projectId, rootPath, repositoryPath, repositoryId, agentType: "trellis-splitter", stage: "split", status: "running" })`，让 mission `agent_run_id` ≡ trellis `agent_run_id`，共享 `correlation_id`。
- 完成 / 失败时同步 update trellis agent run（status=succeeded/failed，complete event）并 `trellis_runtime_record_event` 写 `trellis.agent.completed`（payload 含 `exit_code` / `stdout_path` / `stderr_path` / `run_dir`）。
- 修复 `MissionControl.tsx:285`：`runSingleCluster(cluster, api.state, api, missionId)`，missionId 由 wizard state 的 `state.missionId` 或 `persistMissionSnapshot` 返回值提供（详见 design.md）。
- 满足产品验收 7、补足验收 12（task.create / agent.start / agent.complete / spec.revision / hook.run 五类齐全）。

### F2 · Failure diagnostics and retry-from-run-dir

- 在 `TaskDetailDrawer.tsx` 失败分支中渲染 `FailureEvidenceBlock`：直接显示 `exitCode` / `stdoutPath` / `stderrPath` / `runDir`，提供"打开文件"（`open()` Tauri plugin）与"复制路径"按钮。
- 新增 Rust 命令 `prd_split_retry_run`：接受 `{ runId, projectRootPath, missionId, clusterId }`；读取原 `runDir/dispatch.meta.json` + `prompt.md`，按相同 `clusterId` 复用 effective_prompt 创建新 `runId`，启动 Claude 子进程；旧 run 在新 run 启动后把 `run-result.json` 的 `status` 字段补写 `"superseded_by": <newRunId>`。
- 前端 `runMissionActions.retryClusterFromRunDir(runId, ...)` 调用新命令；UI 在失败卡片提供"从 runDir 重试"按钮（区别于现有"重新生成"全量重跑）。
- 满足产品验收 5。

### F3 · Mount and reconcile background PRD runs

- 修改 `useMissionRunStore`：从 `prd_split_list_legacy_runs` 改读新增的 `prd_split_list_active_runs`（或扩展现命令返回 `clusterId`、`startedAt`、`status`、`exitCode`、`hasRunResult`），通过 `dispatch.meta.json` 解析 cluster 关联。
- 在 `MissionControl.tsx` 顶层挂载 `useMissionRunStore`，把 `backgroundRuns` 合并到 `clusterRuns`（`api.setClusterRun`），让 in-flight runs 立刻显现为 `dispatching` 状态，并继续接收 `splitter-output` / `splitter-progress` 事件。
- 已退出的孤儿 run（无 `run-result.json` 也无活跃 Tauri event）按 `stale` 标记，UI 上提供 F2 的"从 runDir 重试"入口。
- 满足产品验收 6。

### F4 · Bind main chat dispatch to active mission

- 在主会话打开项目时（`AppImpl.tsx` / `ClaudeSessionPanel`）调用 `missionAttachToSession({ sessionId, missionId })`：missionId 取 `mission_list_recent({ projectId, limit:1 })` 中 stage != `done` 的最新条目；若无则不绑定（用户尚未在 Mission Control 创建任何 mission）。
- 在主会话消息发送时（`ClaudeChatInput` 的 commit handler）解析 `@仓库` / `@任务` / `@成员` 提及，对每个提及调用 `mission_record_agent_command({ missionId, commandType: "mention", targetKind, targetId, ... })`；同步 `mission_append_instruction({ missionId, sessionId, targetKind, targetId, instruction: messageText })`。
- 主会话消息提交完毕后 `mission_append_event({ missionId, eventType: "mission.session.message", payload: { sessionId, snippet, mentions } })`。
- `MissionReplayPanel` 每条事件新增 `sessionId` 字段并提供"跳到会话"按钮；主会话消息悬浮加"查看 Mission"链接（仅当 sessionId 已绑定 mission）。
- 满足产品验收 8。

### F5 · Consume reassign impact preview before cluster moves

- 在 `MissionControl.tsx` `handleMoveRequirement` 改为：
  1. 调用 `missionPreviewRequirementReassign({ missionId, requirementId, targetClusterId })` 拿 `MissionReassignPreview`
  2. 弹出 Ant Design Modal 展示 `dirtyClusterCount` / `invalidatedTaskCount` / `affectedAgents`
  3. 用户确认后调用 `missionCommitRequirementReassign({ missionId, requirementId, targetClusterId, previewId })`，再调 `api.reassignRequirement` 更新 reducer
- 若 preview 显示 `affectedAgents.length > 0`，commit 时通过 `mission_record_agent_command({ commandType: "cancel" / "reassign" })` 派对应指令。
- 受影响 cluster 在 reducer 中标记 `needs_resplit`，TaskSwimlane 加 badge，"生成任务"按钮禁用直到 resplit 完成或用户显式忽略。
- 满足产品验收 10。

### F6 · Heartbeat / stale propagation across assignment consumers

- 在 `runSingleCluster` 的 splitter dispatch await 期间，启动 `setInterval(() => upsertMissionAgentAssignmentSafe(missionId, { assignmentId, status:"running", lastHeartbeatAt: Date.now() }), 30_000)`，dispatch 完成 / 失败时 clear。等价于"心跳续租"。
- 所有 caller 在 `missionListAgentAssignments` 调用时强制传 `staleAfterMs: 90_000`（前端在 `services/missionControlBackend.ts` wrapper 中给默认值）。
- 前端 `RuntimeEventFeed` / `TaskCard.agentStatus` 显示 `stale` 状态：灰色 + "上次心跳 N 秒前"。
- 后端补一个"显式 stale"事件：`mission_list_agent_assignments` 在返回行时若其状态判定为 stale，emit 一次 `trellis.agent.stale` 事件（节流：同 assignment 60s 最多 1 次）。
- 满足产品验收 13。

### F7 · Visualize .trellis/workflow.md phases and hooks

- 新增 `src/components/MissionControl/engineering/WorkflowGraphPanel.tsx`：调用 `compileTrellisWorkflow({ projectId, rootPath })`，按 phase 折叠展示 step list、平台分支（platform block）、validation issue badge。
- 将该 panel 接到 `EngineeringDrawer`（已有抽屉）作为新 tab。
- 选中 `SpecRevisionTimeline` 中的一条 revision 时，对照 `compiled.phases[*].steps[*].filePath` 高亮影响到的 step（同一抽屉内的简单链路）。
- 满足功能需求 6.1。

## 3. 跨子任务共享约定

- `agent_run_id` 与 `mission_agent_assignments.agent_run_id` 保持一致（splitter 路径中用 `missionAssignmentId(missionId, clusterId, "splitter")` 派生）。
- `repository_path` 为 absolute path，不可仅传仓库名。所有跨仓库写入都必须含。
- Tauri command 错误使用 `String` 返回（沿用现有约定），失败 payload 推荐包含 `runDir` 用于 F2 跳转。
- Tauri event name 沿用现有前缀：`splitter-*` / `mission-*` / `trellis-*`（不引入新前缀）。
- 写表只走 `mission_control.rs` / `trellis_runtime.rs` / `prd_split_pipeline.rs` 中已有 helper，不在新代码中写裸 SQL。

## 4. 验收标准

### 产品验收（13 条原始规格）

- 1 / 2 / 3 / 4 / 9 / 11：已满足，本任务不回归。
- 5 ← F2
- 6 ← F3
- 7 ← F1
- 8 ← F4
- 10 ← F5
- 12 ← F1（补 trellis 侧 agent.start / agent.complete）+ F6（hook stale event）
- 13 ← F6

### 工程验收

- E1：`cargo check -p wise-app`（或现有 sub-tauri crate）通过。
- E2：`bun test` 通过；新增 Rust 单测覆盖 retry-from-runDir 复用 prompt、stale event 触发；新增 TS 单测覆盖 useMissionRunStore reconcile、F5 preview→commit 路径、F6 heartbeat throttle。
- E3：`bunx tsc --noEmit` 通过。
- E4：`src/App.tsx` / `src-tauri/src/lib.rs` 净增 ≤ 30 行；任何超出范围的新逻辑落到独立 module。
- E5：`gitnexus_detect_changes` 在落 commit 前给出受影响 symbol 清单。

## 5. 不做

- 不重构 `05-15-mission-control-redesign` 已完成的组件树。
- 不引入新 UI 框架（按 CLAUDE.md，Ant Design + ClaudeChatInput 的 Semi UI）。
- 不动 Tauri capabilities 边界（除非 F4 / F7 必须；最多扩 fs:read scope 到 `.trellis/`）。
- 不写多余 markdown 文档；不在代码堆多行注释。
- F1-F7 任一子任务发现需要重构既有大型模块的，停下来更新 design.md，不私自扩张范围。
