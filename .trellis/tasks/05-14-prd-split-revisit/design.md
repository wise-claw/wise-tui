# Design · prd-split-revisit

## 设计目标

把"双向 Stepper + ClusterPlan 编辑"这两件事在 `useSplitWizardState` 内闭环，不污染纯函数层（`clusterPlanner.ts` / `trellisWriter.ts`），不动 Tauri 端，不引入新的持久化。下游消费方（`ClusterPlanStage` / `SplitsStage` / `ReviewStage`）通过既有的 `state.plan` 字段读"生效后的 plan"，无需感知编辑层。

## 数据结构

### 新增 `ClusterPlanEdits`

`src/components/PrdSplitWizard/types.ts`：

```ts
export interface ClusterPlanEdits {
  /**
   * 把某个 requirement 显式指派到指定 cluster（覆盖算法归属）。
   * key: requirementId；value: 目标 clusterId。
   * 撤回到算法默认：从该 map 中删除 key。
   */
  reassignedRequirements: Record<string, string>;
  /** 用户手工创建的 cluster（id 形如 `cluster-manual-<type>-<repoId>-<seq>`）。 */
  manualClusters: ClusterPlanItem[];
  /** clusterId → 自定义 title。 */
  titleOverrides: Record<string, string>;
}

export function emptyClusterPlanEdits(): ClusterPlanEdits {
  return { reassignedRequirements: {}, manualClusters: [], titleOverrides: {} };
}
```

### `WizardState` 扩展

```ts
interface WizardState {
  // ...既有字段
  /** 算法直接产出，不被编辑层污染；用于"撤回到默认"。 */
  basePlan: ClusterPlan | null;
  /** 既有字段；语义改为"生效 plan = basePlan + clusterPlanEdits 派生"。下游消费方读这个。 */
  plan: ClusterPlan | null;
  /** 新增：用户对 cluster plan 的编辑层。 */
  clusterPlanEdits: ClusterPlanEdits;
}
```

`emptyWizardState` 增补 `basePlan: null` 和 `clusterPlanEdits: emptyClusterPlanEdits()`。

> 关键不变量：每次 reducer 修改 `basePlan` 或 `clusterPlanEdits` 都必须同步重算 `plan = deriveEffectivePlan(basePlan, edits)`。reducer 内置一个 helper `withDerivedPlan(stateNext)` 统一处理。

### 派生函数

`src/components/PrdSplitWizard/clusterPlanEdits.ts`（新文件，纯函数）：

```ts
export function deriveEffectivePlan(
  base: ClusterPlan,
  edits: ClusterPlanEdits,
): ClusterPlan
```

算法（O(reqs + clusters)）：

1. 从 `base.clusters` 复制出 mutable 数组；附加 `edits.manualClusters`。
2. 应用 `titleOverrides`：clusterId 命中则覆盖 `title`。
3. 应用 `reassignedRequirements`：扫一遍所有 cluster 的 `requirementIds`，把已被显式指派到别处的 reqId 从源 cluster 移除，并 append 到目标 cluster；目标 cluster 不存在则忽略（防御性）。
4. 清洗 "算法 cluster + 空 requirementIds" 的悬空 cluster（PRD R2 约束）。手工 cluster 允许空。
5. 重算 `diagnostics`：`covered`/`orphan` 重新计算；`crossRepoRequirements` 来自 base（编辑层不重新打分）。
6. 返回新 `ClusterPlan`，cluster 顺序保持"基线 cluster 优先 + 手工 cluster 按创建顺序追加"。

### 派生失败 / 退化处理

- `reassignedRequirements[reqId]` 指向不存在的 clusterId → 视为未编辑，跳过；不抛错。
- `manualClusters` 中 id 与 base cluster 冲突 → manual 让位，跳过（理论上 id 规则保证不冲突，仍守一道）。
- 派生 plan 后若 `clusters.length === 0` → 返回 base（保护"不会因编辑卡死"）。

## 状态机扩展

### 新增 actions

```ts
| { type: "reassign-requirement"; requirementId: string; targetClusterId: string }
| { type: "undo-reassign"; requirementId: string }
| { type: "add-manual-cluster"; cluster: ClusterPlanItem }
| { type: "rename-cluster"; clusterId: string; title: string }
| { type: "reset-cluster-plan-edits" }
```

reducer 在每条上述 action 后调用 `withDerivedPlan`。

### 现有 actions 的调整

- `go-to-plan`（即 `parseAndPlan`）：写 `basePlan` 同时**重置** `clusterPlanEdits`。`plan` 由派生函数得出（此时等价于 basePlan）。
- `back-to-input`：可选两种语义——
  - **保留**：保留 `clusterPlanEdits`（让用户回去改 PRD 但保留 cluster 自定义）；
  - **清空**：与 `parseAndPlan` 一同清空。
  - 决定：**清空**。理由：PRD 文字一改，requirementId 的 hash 会变，reassignedRequirements 里的 key 大概率失效；保留只会产生悬空指针；同时 PRD 已明确这条约束。
- `set-existing-parents` / `refreshExistingParents`：消费 effective `plan`，不需要改逻辑。

### Cluster run 失效规则

新增内部 helper（reducer 内）：

```ts
function invalidateRuns(state, affectedClusterIds: string[]): WizardState
```

- 对每个 affected clusterId：若 `clusterRuns[cid].status ∈ {succeeded, failed, skipped-clean}`，重置回 `makeIdleRun(cid)` 并丢弃 `raw/normalized/validationIssues/errors/endedAt`。
- `dispatching / creating-parent` 状态不动（正在跑的任务用户应自己等完或显式取消，不在 MVP 范围）。

调用点：

- `reassign-requirement` → affected = `{源 cluster, 目标 cluster}`
- `add-manual-cluster` → affected = `{}`（新 cluster 没有 run）
- `rename-cluster` → affected = `{}`（重命名只动 title，不动归属）

### 受影响 cluster 的编辑确认

reducer 内不弹 UI；改由组件层在 `dispatch` 前调用 `peekAffectedClusterEdits(state, candidateAction)` 拿到"有 task 编辑的受影响 cluster 列表"，弹 `Modal.confirm`，用户确认后才真正 dispatch action。

`peekAffectedClusterEdits` 是纯函数，放在 `clusterPlanEdits.ts`。

### `reassign` 的"等同算法默认"自动清理

若用户把 reqId 移回到算法基线归属的 cluster，reducer 应主动从 `reassignedRequirements` 中删除该 key（避免 edits 越攒越多）。判断：`base.clusters.find(c => c.requirementIds.includes(reqId))?.id === targetClusterId`。

## UI 拆分

### `PrdSplitWizardModal.tsx`

- Steps 组件加 `onChange(idx)` 处理：
  - `idx < currentStepIndex` 且目标 stage 在 `{"input", "plan", "dispatch", "review"}`：允许跳转。
  - 跳到 `input` 弹 `Modal.confirm`：「回到 PRD 会清空 cluster 编辑 / splitter 输出 / 任务编辑（保留 PRD 文本）。继续？」用户确认才 dispatch `back-to-input`。
  - 其它跳转直接 dispatch 对应 `back-to-plan` / `back-to-dispatch`。
- 既有底部"返回"按钮保留（语义和点 Step 等价），不删除——为键盘 / 习惯用户保底。
- 不实现"跳到未到达的 step"。

### `ClusterPlanStage.tsx`

新增 3 个操作入口：

1. **移动 requirement**：每个 requirement Tag 加 `Dropdown`，菜单项 = 当前 effective plan 里除自身外的所有 cluster（label 含 title + repo 标签）。点击后：
   - 若目标 cluster 与源 cluster 都没有 task 编辑 / cluster run 产出，直接 dispatch `reassign-requirement` + 内部 invalidateRuns。
   - 若有 task 编辑 / cluster run 产出 → 经 `peekAffectedClusterEdits` 检查；有 task 编辑则弹 `Modal.confirm`，用户确认后 dispatch + 在 reducer 内调 `discardClusterEdits` for affected。
2. **新建 cluster**：cluster 列表底部"+ 新建 cluster"按钮 → `Modal.useModal` 弹简表：
   - title：必填（≥1 char）。
   - primary repository：从 `state.repositories` 选一个；下拉默认 first by type。
   - extra repositoryIds：可选多选。
   - 提交时生成 id：`cluster-manual-<repoType>-<repoId>-<seq>`，seq = `manualClusters.length + 1`（局部递增，足够区分）。
   - dispatch `add-manual-cluster`，cluster `requirementIds = []`。
3. **重命名 cluster**：title 行加 `EditOutlined` 按钮 → inline `Input.Group` 或 inline edit；Enter 提交，Esc 取消；dispatch `rename-cluster`。

新增 UI 时序约束：编辑 cluster 后 trigger debounced（300ms）的 `refreshExistingParents`，在 `ClusterPlanStage` 内用 `useEffect + setTimeout` 实现，依赖 `state.clusterPlanEdits`。

### 不动的部分

- `SplitsStage.tsx`：通过 `state.plan` 读 effective plan，无改动。
- `ReviewStage.tsx`：同上。
- `clusterPlanner.ts` / `trellisWriter.ts` / `splitterDispatch.ts` / `verifierDispatch.ts`：纯函数，无改动。
- `existingParentScanner.ts`：现有扫描行为不变。
- `diffReplay.computeDirtyClusters`：消费 effective plan 的 clusters，无改动。

## 兼容性

- `WizardState` 字段名兼容：`plan` 语义从"算法 plan"变为"effective plan"，对所有现存读 `state.plan?.clusters` / `state.plan?.diagnostics` 的代码透明（依然是 `ClusterPlan` 结构）。
- 新增字段 `basePlan` / `clusterPlanEdits` 默认值确保旧 reducer 路径不影响。
- 既有测试 `anchorEdits.test.ts` / `taskEdits.test.ts` / `clusterPlanner.test.ts` / `diffReplay.test.ts` 不应改。
- 项目目前没有 wizard state 持久化，状态变更不需要迁移。

## 风险与权衡

| 风险 | 缓解 |
|---|---|
| `deriveEffectivePlan` 在每个 reducer step 都跑 → 频繁 React 重渲染 | 派生是 O(reqs+clusters)，PRD 体量上限 ~24 reqs/cluster × 几个 cluster，单次 <1ms；不需 memo。 |
| 用户编辑 cluster 后 splitter run 残留 dispatching → 状态不一致 | MVP 不处理；UI 显示"派发中"时禁用 cluster 编辑（按钮 disabled，附 tooltip）。 |
| `refreshExistingParents` 在 modal 关闭后 fire | `ClusterPlanStage` `useEffect` 返回 cleanup 清掉 timeout。 |
| 用户重命名 cluster 后回到 input 重 parse，title 被清空 | 已在 PRD R3 / 本设计中确认行为，且重命名"会丢"在确认弹窗里写明。 |
| manual cluster 的 id 与 base cluster 冲突 | id 规则强制带 `manual-` 段；derive 时还有冲突防御。 |

## Rollout / Rollback

- 纯前端改动，无 IPC / Rust / DB / 文件系统接触。
- 无 feature flag——MVP 直接落，UI 入口默认可见。
- 回滚方式：`git revert <commit>`；无数据迁移。
- 部署后若发现 derive 有 bug → 旧 wizard 流程仍可用（只要不点新按钮）。
