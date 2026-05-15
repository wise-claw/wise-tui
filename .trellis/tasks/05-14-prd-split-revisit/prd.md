# prd-split wizard 双向回看 + cluster 人工编辑

## Goal

让用户在 PRD-split wizard 派发 splitter 之前，能在 4 步 Stepper 中**双向**回看，并对 `ClusterPlan` 的归类结果**人工修正**。当前流程是单向递进 + cluster 全只读，跨仓需求只能靠改 PRD 文字命中关键词来兜底，污染源文档且修正成本高。

## Scope

涵盖：

1. `PrdSplitWizardModal` 的 Steps 改为可点击双向跳转，且每步保留下游状态的合理子集（详细规则见 Requirements）。
2. `ClusterPlanStage` 加最小可用编辑面，包括 3 个动作：
   - 把 requirement 从一个 cluster 移到另一个 cluster；
   - 手工创建新 cluster（选 primary repo + title）；
   - 重命名 cluster title。
3. 在 `useSplitWizardState` 加 cluster plan 编辑层，使其与现有 `editsByCluster`（task 编辑）解耦。

不涵盖（明确排除）：

- cluster 合并 / 拆分 / 删除（先用"移空 → 手工新建"路径绕开）。
- `dependencyClusterIds` 的可视化编辑。
- 落盘后回滚 / wizard 会话存盘。
- splitter / verifier 子代理行为本身。

## Requirements

### R1 · Stepper 可双向跳转

- Steps 当前只展示进度，无 onChange。**改为**：可以点击任何**已经达到过**的 step 跳回；未到达的 step 不响应。
- 跳转后必须满足"下游受影响的状态被显式处理"：

| 从 | 跳到 | 处理 |
|---|---|---|
| `plan` / `dispatch` / `review` | `input` | 弹确认：会清空 `plan / clusterRuns / editsByCluster / writeResults`，保留 `prdMarkdown`。用户确认才执行。 |
| `dispatch` / `review` | `plan` | `requirementsIndex` 不变时保留 `clusterRuns`；下面 R2 引入 cluster plan 编辑会按"受影响 cluster"局部清空。 |
| `review` | `dispatch` | 不动状态（等同现有 `backToDispatch`）。 |

- 不要"自动跳"——只在用户主动点击 Step 或现有"返回"按钮时切换。

### R2 · ClusterPlan 人工编辑

每张 cluster 卡片支持：

- **R2.1 · 移动 requirement**：点 requirement tag 弹出"移到 …"菜单，列出当前 plan 所有其他 cluster（标 title + 仓位），选中即从源 cluster 删 / 加到目标 cluster。同时刷新 diff、刷新 `state.diffByCluster`。
- **R2.2 · 手工新建 cluster**：cluster 列表底部加"+ 新建 cluster"按钮，弹简表（title 必填、primary repository 必选、可勾选额外 repositoryIds）。新建后 cluster `requirementIds` 为空，需要用户手动把 requirement 从其他 cluster 移过来。
- **R2.3 · 重命名 cluster**：title 行的"编辑"按钮 → inline input。

约束：

- 受 R2 影响的 cluster：若已存在对应 `clusterRuns[cid]` 中 status ≠ `idle` 的产出，**必须清空该 cluster 的 run**（避免用旧 splitter 输出对错 requirement 集合）。
- 受 R2 影响的 cluster：若已存在对应 `editsByCluster[cid]`，需要在 UI 给出"将丢弃 cluster `<id>` 已有任务编辑"的确认 toast / modal；用户确认后才清空对应 edits。
- 不允许 cluster 出现"零 requirement 且非 user-created"的悬空状态——若 R2.1 把最后一个 requirement 移走，且该 cluster 不是 R2.2 手工创建的，自动从 plan 里移除并提示。
- 手工新建 cluster 的 id 形如 `cluster-manual-<repoType>-<repoId>-<n>` 以与算法生成的区分；落盘父任务 slug 仍按现有 `trellisWriter` 规则。

### R3 · State 隔离

- 新增 `state.clusterPlanEdits`（与 `editsByCluster` 平行）：
  - `movedRequirements: Record<reqId, targetClusterId>` —— 仅记录变动，重新 `parseAndPlan` 后清空。
  - `manualClusters: ClusterPlanItem[]`
  - `titleOverrides: Record<clusterId, string>`
- 现有 `state.plan` 由"算法 plan + clusterPlanEdits"派生，保留 `state.plan` 作为"effective plan"读字段，让 ClusterPlanStage / SplitsStage / ReviewStage 都无需感知编辑层。
- 调用 `parseAndPlan`（即从 input 重出发）会重建算法 plan 并**重置** clusterPlanEdits；不要在 PRD 改动时静默保留 cluster 自定义。

### R4 · Diff & 历史父任务的交互

- cluster id 变化（R2.1 把 requirement 挪走 + R2.2 新增 cluster）会改变 `diffByCluster` 的状态：
  - 算法生成的 cluster 仍保留原 id → diff 按 requirement 集合差重新算（diffReplay 已能做到）。
  - 手工 cluster 的 id 在历史父任务里不存在 → 标 `new`。
- `refreshExistingParents` 必须在 R2 编辑后**自动触发一次**（去抖 300ms），保证 diff badge 与编辑同步。

## Acceptance Criteria

- [ ] 用户从 Review 点击 Stepper 的"PRD"项 → 弹出确认 → 确认后回到 Input 阶段，下游状态全部清空，PRD 文本保留。
- [ ] 用户在 ClusterPlan 阶段把 `req-X` 从 `cluster-frontend-1` 移到 `cluster-backend-2`：源 / 目标 cluster 的 `requirementIds` 立刻刷新；若两 cluster 之前都已有 `clusterRuns` 产出，两份 run 都被清空且 UI 给出提示。
- [ ] 用户点"+ 新建 cluster"创建 `cluster-manual-frontend-3-1`，title 自定义；下一步派发只会派出包含该 cluster 在内的所有非空 cluster。
- [ ] R2 操作触发 `refreshExistingParents` 去抖刷新（在 ≤500ms 内 diff badge 正确反映新归属）。
- [ ] 从 Input 重新 `parseAndPlan` 后，`clusterPlanEdits` 全清空，新算法 plan 完整覆盖旧 effective plan。
- [ ] `bun test` 全绿；新增 `useSplitWizardState` 单测覆盖：
  - 跨步跳转后下游状态的清理矩阵；
  - cluster plan edit 派生 effective plan；
  - R2 操作触发 cluster run 清空 + edits 清空的确认路径（mock 用户拒绝时不清空）。
- [ ] `cargo test`（如有改动 Rust 侧才需要；本任务预期不动 Rust）。
- [ ] 手工冒烟（dev server 由用户执行）：在 wizard 内完整走通"PRD → Plan → 编辑 cluster → Dispatch → Review"，并演示"从 Review 跳回 Plan 再回到 Review"不丢任务编辑。

## Constraints

- 不引入新的 UI 框架。Ant Design 为主，必要时复用现有图标 / 弹窗模式。
- 不在 `localStorage` 落盘 wizard 状态（违反项目存储策略）。
- 不影响现有 4 步流程的"一次过"路径（线性走完依然零额外点击）。
- 不动 `splitterDispatch` / `verifierDispatch` / `trellisWriter` / `clusterPlanner.ts` 的纯函数行为；编辑层只在 hook 与 UI 内闭环。

## Out of Scope

- Cluster 拆分（一个 cluster 切两半）/ 合并（多个 cluster 并入一个）。R2.1 + R2.2 已能模拟最常见路径。
- 落盘后撤销（`writeClusterTasks` 已写文件后回滚 .trellis/tasks/）。
- Wizard 会话存盘到 `~/.wise/prd-runs/<run>/state.json`。
- `crossRepoRequirements` 警告升级为可在 UI 内点选解决。
