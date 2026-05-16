# F5 consume reassign impact preview before cluster moves

## Parent

`05-16-mission-control-acceptance-closeout/design.md §5` 与 `implement.md Step 5`。

## Scope

1. `services/missionControlBackend.ts` 确认/补齐 `missionPreviewRequirementReassign`、`missionCommitRequirementReassign` wrapper（命令已存在 Rust 端）。
2. `useSplitWizardState` 新增 `clusterNeedsResplit: Record<string, boolean>` + reducer actions `markClusterNeedsResplit` / `clearClusterNeedsResplit`。
3. 改写 `MissionControl.tsx.handleMoveRequirement`：
   - missionId == null → 直接 `api.reassignRequirement`（fallback）。
   - missionId != null → preview → Ant Modal 展示 dirtyClusters / invalidatedTasks / affectedAgents → 确认后 commit + `api.reassignRequirement` + 派 cancel 指令 + markClusterNeedsResplit。
4. 新组件 `details/ReassignPreviewBlock.tsx`：纯展示 preview 数据。
5. `TaskSwimlane` / `MissionAgentSummary` 读 `clusterNeedsResplit` 渲染 badge；"生成任务" CTA 在脏 cluster 存在时禁用 + 提示。

## Out of Scope

- 不在拖拽过程中实时显示 preview（仅 drop 后 Modal）。
- 不实现 cluster 之间的拖回操作（沿用现有 reducer 行为）。
- 不修改 `mission_preview_requirement_reassign` / `mission_commit_requirement_reassign` 后端实现。

## Acceptance

- [x] 拖拽需求到其他 cluster 时弹出 Modal，展示 3 类影响计数。
- [x] 确认后 `mission_reassign_previews` + commit 命令均被调，相关 agent 收到 cancel 指令（mission_agent_commands 有记录）。
- [x] dirtyCluster 上有 badge，"生成任务" CTA 禁用。
- [x] missionId null 时直接 reassign，无 Modal、无报错。
- [x] `bun test src/components/MissionControl` + `bunx tsc --noEmit` 通过。
