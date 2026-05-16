# Implement Plan — Mission Control 13-criterion closeout

## 执行原则

1. **顺序**：F1 → F6（共用 agentRunId 体系）→ F2（依赖 F1 的 runDir / assignment 关联）→ F3（依赖 F2 retry 入口）→ F5 → F4 → F7。
2. **每步完成后立即跑** `cargo check`（仅在 Rust 改动）+ `bun test`（影响目录）+ `bunx tsc --noEmit`。
3. **禁止** 启动 `bun run tauri:dev` 或 `bun run dev`。UI 验证留给用户。
4. **gitnexus 纪律**：每编辑一个 public symbol 前跑 `gitnexus_impact`；commit 前跑 `gitnexus_detect_changes`。
5. **无 commit**：除非用户显式要求。每步落代码后只跑测试，不 stage。
6. 子任务粒度允许 PRD-only（父任务的 design.md 已经覆盖技术细节）；除非子任务跑偏，否则不写额外 design / implement。

## Step 1 — F1 · Runtime ledger parity（Rust 0 行 / TS ~250 行 + 测试 ~120 行）

1.1 在 `src/services/trellisRuntime.ts` export `trellisRuntimeUpsertAgentRunSafe(missionId, input)`、`trellisRuntimeRecordEventSafe(input)`（missionId/必要字段缺时 no-op）。

1.2 在 `src/components/PrdSplitWizard/useSplitWizardState.ts` 给 state 加 `activeMissionId: string | null`，加 reducer action `setActiveMissionId`，在 `runMissionClusters` 拿到 `mission.missionId` 后 dispatch 一次。

1.3 修改 `runMissionActions.ts.runSingleCluster`：在每个 `upsertMissionAgentAssignmentSafe` 后并发 `trellisRuntimeUpsertAgentRunSafe`（参数构造见 design §1）。失败 / 成功路径每条都加。

1.4 修改 `MissionControl.tsx.handleRetryCluster`：`runSingleCluster(cluster, api.state, api, api.state.activeMissionId ?? null)`。

1.5 在终态调用 `trellisRuntimeRecordEventSafe({ eventKind:"trellis.agent.completed", correlationId: assignmentId, payload:{ exitCode, stdoutPath, stderrPath, runDir } })`。

1.6 测试：
- `runMissionActions.test.ts`：retry 路径携 missionId / no missionId 的两 case；trellisRuntimeUpsertAgentRunSafe spy 调用次数与 status 序列。
- `useSplitWizardState.test.ts`：新 action set/clear。

1.7 验证：
```bash
bun test src/components/PrdSplitWizard/ src/components/MissionControl/
bunx tsc --noEmit
```

## Step 2 — F6 · Heartbeat + stale propagation（Rust ~200 行 + TS ~150 行）

2.1 Rust `trellis_runtime.rs`：
- 新增 `trellis_agent_heartbeat(app, db, agent_run_id) -> Result<(), String>`：throttle 5s（SQL `WHERE ?now - last_heartbeat_at >= 5000`）。
- 新增 `pub(crate) fn run_stale_scanner(app: AppHandle, db: Arc<WiseDb>) -> ()`：spawn 30s loop；同 agent 60s 节流 stale event；用 `Mutex<HashMap<String, u64>>` 记忆最后 emit。
- 注册命令到 `lib_impl.rs`；setup 完成时 spawn scanner（用 `tauri::async_runtime::spawn` + `app.state::<WiseDb>().inner()`）。

2.2 TS：
- `services/trellisRuntime.ts` export `trellisAgentHeartbeat(agentRunId)`。
- `services/missionControlBackend.ts.missionListAgentAssignments` wrapper 默认 `staleAfterMs: 90_000`。
- `runMissionActions.runSingleCluster` await dispatch 期间 `setInterval(30000)` 调心跳；try/finally clear。
- `RuntimeEventFeed.tsx` icon/文案；`TaskCard.tsx` stale chip。

2.3 测试：
- Rust 单测：heartbeat throttle、scanner 90s 阈值。
- TS：`runMissionActions.test.ts` vi.useFakeTimers 推进时间断言心跳调用次数；`RuntimeEventFeed.test.tsx` stale 渲染。

2.4 验证：
```bash
cd src-tauri && cargo check && cargo test trellis_runtime
cd .. && bun test
bunx tsc --noEmit
```

## Step 3 — F2 · Failure evidence + retry-from-runDir（Rust ~180 行 + TS ~300 行）

3.1 Rust `prd_split_pipeline.rs`：
- 抽 `dispatch_with_prepared_prompt(prompt, cluster_id, project_root_path, mission_id, model, app, db, run_id_override) -> Result<DispatchClusterOutput, String>`，原 `dispatch_cluster_impl` 调用此 helper。
- 新增 `prd_split_retry_run(app, db, input: RetryRunInput) -> Result<RetryRunOutput, String>`：解析旧 run_dir、读 dispatch.meta.json、调用 helper 启动新 run、patch 旧 run-result.json 加 `superseded_by`。
- 注册命令。

3.2 TS：
- `services/prdSplit/splitterDispatch.ts` export `retryClusterFromRunDir(input)`。
- `runMissionActions.retryClusterFromRunDir(runId, clusterId, state, api, missionId)`：调命令后接管 splitter event stream（沿用 splitterStreamListener 已有逻辑，无需新订阅）。
- `details/FailureEvidenceBlock.tsx` 新组件：渲染 exitCode/stdoutPath/stderrPath/runDir + 打开/复制按钮。
- `details/TaskDetailDrawer.tsx` 失败分支挂 `FailureEvidenceBlock` + "从 runDir 重试"按钮。

3.3 capability 检查：若 `@tauri-apps/plugin-shell` 的 `open()` 未 allow，按最小 scope 加到 `capabilities/default.json`（`shell:allow-open`，scope 限 `~/.wise/prd-runs/**` + `~/.trellis/**`）。

3.4 测试：
- Rust：`prd_split_retry_run` 单测：dispatch.meta.json 缺失/cluster_id 不匹配/正常路径。
- TS：`runMissionActions.test.ts` retry 路径调用 splitter retry 命令；`FailureEvidenceBlock.test.tsx` 渲染。

3.5 验证：
```bash
cd src-tauri && cargo check && cargo test prd_split
cd .. && bun test
bunx tsc --noEmit
```

## Step 4 — F3 · Mount + reconcile background runs（Rust ~120 行 + TS ~150 行）

4.1 Rust `prd_split_pipeline.rs`：
- 新增 `prd_split_list_active_runs(app) -> Result<Vec<ActiveRunRow>, String>`：扫描 `~/.wise/prd-runs/*`，解析 `dispatch.meta.json` + `run-result.json`，返回详细字段。
- 注册命令。

4.2 TS：
- `useMissionRunStore.ts` 改 invoke 为新命令，类型对齐。
- `MissionControl.tsx` 顶层 `useMissionRunStore()`，挂载 effect：遍历 backgroundRuns，对每个找到的 cluster 调 `api.setClusterRun(clusterId, { status:"dispatching", parentTaskName:null, parentTaskPath:null, startedAt: startedAtMs, ... })`。
- 90s 阈值 stale 处理：当 backgroundRun 没有 run-result 且 startedAtMs 太老，标记 `status:"failed"` + error 含 runDir，便于 F2 retry。

4.3 测试：
- Rust：list_active_runs 单测覆盖 3 种状态。
- TS：`useMissionRunStore.test.ts` mock invoke 验证 reduce；`MissionControl.test.tsx` mount 时 setClusterRun 被调。

4.4 验证：
```bash
cd src-tauri && cargo check && cargo test prd_split_list_active
cd .. && bun test
bunx tsc --noEmit
```

## Step 5 — F5 · Reassign preview + commit（Rust 0 行 + TS ~250 行）

5.1 `services/missionControlBackend.ts` 确认导出 `missionPreviewRequirementReassign` / `missionCommitRequirementReassign`，缺则补 wrapper。

5.2 `useSplitWizardState` 加 `clusterNeedsResplit: Record<string, boolean>` + actions `markClusterNeedsResplit`/`clearClusterNeedsResplit`。

5.3 `MissionControl.handleMoveRequirement` 改写按 design §5。

5.4 新组件 `details/ReassignPreviewBlock.tsx`：列出 dirtyClusters / invalidatedTasks / affectedAgents。

5.5 `TaskSwimlane` / `MissionAgentSummary` 读 `clusterNeedsResplit` 渲染 badge；"生成任务"按钮在有脏 cluster 时禁用。

5.6 测试：
- TS：`MissionControl.test.tsx`（或抽 handler 到 hook 单测）覆盖 missionId null vs 非 null；mock missionPreviewRequirementReassign。

5.7 验证：`bun test && bunx tsc --noEmit`。

## Step 6 — F4 · Bind main chat to active mission（TS ~200 行）

6.1 新增 `services/mission/sessionBinding.ts`：`ensureSessionBoundToActiveMission`。

6.2 `AppImpl.tsx` Claude session 激活点（搜 `sessionId` 派生处）调一次 ensure（异步不阻塞 UI）。改动 ≤ 15 行，符合 E4。

6.3 `ClaudeChatInput/composer-region.tsx` 把 commit handler 中的 mention 解析抽到独立 helper `src/components/ClaudeChatInput/missionMentionHook.ts`，commit 完成后调用 helper 异步写 `mission_record_agent_command` + `mission_append_event`。

6.4 `MissionReplayPanel.tsx` 事件含 sessionId 时显示 sessionId 文本（不强求跳转，先做信息展示）。

6.5 测试：
- TS：`sessionBinding.test.ts`、`missionMentionHook.test.ts`。

6.6 验证：`bun test && bunx tsc --noEmit`。

## Step 7 — F7 · Workflow graph viz（TS ~250 行）

7.1 新增 `components/MissionControl/engineering/WorkflowGraphPanel.tsx`：调 `compileTrellisWorkflow`，渲染 phase/step/platform/validation。

7.2 在 `EngineeringDrawer` 加 "Workflow" tab；选 SpecRevisionTimeline 条目时 panel 高亮匹配 step。

7.3 测试：`WorkflowGraphPanel.test.tsx`。

7.4 验证：`bun test && bunx tsc --noEmit`。

## Step 8 — 最终汇总验证

8.1 全量：
```bash
cd src-tauri && cargo check && cargo test
cd .. && bun test
bunx tsc --noEmit
```

8.2 `gitnexus_detect_changes()` 输出变更面，对照 design §10 文件清单核对。

8.3 spec 更新（如必要）：检查 `.trellis/spec/frontend/index.md` 与 `.trellis/spec/tauri/index.md` 是否需要登记新命令 / 新组件；按 spec 现有风格补一条目（≤ 5 行）。

8.4 不 commit。把结果归纳给用户，等待 commit 指令。

## 关键回退点

| 步骤 | 回退方式 |
|---|---|
| Step 1 | 删除 trellisRuntimeUpsertAgentRunSafe 调用即可；activeMissionId 字段保留无副作用 |
| Step 2 | 删除 heartbeat / scanner；前端 setInterval 失败安全（catch 内 log） |
| Step 3 | 删除 prd_split_retry_run + retryClusterFromRunDir + FailureEvidenceBlock |
| Step 4 | 删除 prd_split_list_active_runs；useMissionRunStore 恢复读 legacy |
| Step 5 | handleMoveRequirement 改回直接 reassign |
| Step 6 | 删除 ensureSessionBoundToActiveMission 调用 + mention helper |
| Step 7 | 删除 WorkflowGraphPanel + EngineeringDrawer tab |

每步独立，可单独 revert。
