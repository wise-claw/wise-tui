# Implement · prd-split-revisit

## 执行顺序

每个 step 都是可独立 commit 的小块。`bun test` 全绿才进下一步；任何步骤失败先回到 step 前的 HEAD 再修。

### Step 1 · 纯函数派生层 [无 UI / 无回归风险]

文件：

- 新增 `src/components/PrdSplitWizard/clusterPlanEdits.ts`
- 新增 `src/components/PrdSplitWizard/clusterPlanEdits.test.ts`

实现：

- 导出 `ClusterPlanEdits` 类型 + `emptyClusterPlanEdits()`。
- 导出 `deriveEffectivePlan(base, edits): ClusterPlan` 纯函数（见 design 算法）。
- 导出 `peekAffectedClusterEdits(state, action)` 纯函数，返回 `string[]`（有 task 编辑的受影响 clusterId）。
- 导出小 helper：
  - `applyReassign(edits, base, reqId, target)`：若 target 等同算法默认归属，删除 key；否则写入。返回新 edits 对象。
  - `nextManualClusterId(edits, repoType, repoId)`：根据 manualClusters 长度推 seq。

单测覆盖：

- 算法默认归属 + 无 edits → effective == base。
- 单条 reassign → 源 cluster 移除 reqId，目标 cluster 末尾追加。
- reassign 回算法默认 → effective == base，且 `applyReassign` 返回的 edits 不再保留该 key。
- manual cluster → effective.clusters 末尾追加，requirementIds 空。
- 算法 cluster 被移空（所有 reqId 重指派）→ 自动从 effective 中剔除；manual cluster 同条件下保留。
- titleOverride 命中 / 不命中。
- 防御：reassign 到不存在的 clusterId → 不抛错，结果与无 edits 等价。

验收命令：

```bash
bun test src/components/PrdSplitWizard/clusterPlanEdits.test.ts
bunx tsc --noEmit
```

### Step 2 · 扩展 WizardState 与 reducer [纯 state，UI 沉默]

文件：

- `src/components/PrdSplitWizard/types.ts`：`WizardState` 加 `basePlan` 与 `clusterPlanEdits`；`emptyWizardState` 同步。
- `src/components/PrdSplitWizard/useSplitWizardState.ts`：
  - `Action` 联合加 5 个新 case：`reassign-requirement` / `undo-reassign` / `add-manual-cluster` / `rename-cluster` / `reset-cluster-plan-edits`。
  - reducer 内加 `withDerivedPlan(stateNext)`：每次写 `basePlan` 或 `clusterPlanEdits` 后用 `deriveEffectivePlan` 重算 `plan`。
  - reducer 内加 `invalidateRuns(state, affectedClusterIds)`：把对应 run 重置回 `makeIdleRun`。
  - `go-to-plan`：写 `basePlan = action.plan`、`clusterPlanEdits = emptyClusterPlanEdits()`，然后 `withDerivedPlan`。
  - `back-to-input`：清空 `basePlan / plan / clusterPlanEdits / clusterRuns / editsByCluster / writeResults`，保留 `prdMarkdown / project / repositories`。
- `UseSplitWizardStateApi` 加对应方法签名：
  - `reassignRequirement(reqId, targetClusterId): void`
  - `undoReassign(reqId): void`
  - `addManualCluster(cluster): void`
  - `renameCluster(clusterId, title): void`
  - `resetClusterPlanEdits(): void`

测试（新文件 `useSplitWizardState.test.ts`，若不存在）：

- 派遣 `reassign-requirement` 后 effective plan 反映变化、affected cluster 的 run 被清空。
- `undo-reassign` 还原。
- `back-to-input` 后 basePlan / plan / editsByCluster 全 null/空，prdMarkdown 保留。
- `parseAndPlan` 重算后 clusterPlanEdits 被清空。

验收命令：

```bash
bun test src/components/PrdSplitWizard
bunx tsc --noEmit
```

### Step 3 · Stepper 双向跳转

文件：

- `src/components/PrdSplitWizard/PrdSplitWizardModal.tsx`：
  - `Steps` 加 `onChange(idx)`。
  - `currentStepIndex` 已存在，无需新增。
  - 实现"只能跳到已到达 step"：维护 `maxReachedStep` 局部 state（每次 stage 推进到更高 step 时刷新）。
  - 跳到 `input`：用 `Modal.confirm` 弹确认，确认才 `api.backToInput()`。
  - 其它向后跳：直接调用对应 `backTo*`。
  - 不允许向前跳过未到达 step。

测试：

- 上述行为以组件级 React Testing Library 测试覆盖；若现有 wizard 没有 RTL setup，跳过测试，留 manual smoke 项验证。

验收命令：

```bash
bun test src/components/PrdSplitWizard
```

### Step 4 · `ClusterPlanStage` 编辑 UI

文件：

- `src/components/PrdSplitWizard/stages/ClusterPlanStage.tsx`：
  - 每个 requirement Tag 包 `Dropdown.Button`，菜单 = "移到 ..."列表 + "撤销移动"（仅当该 reqId 当前在 `state.clusterPlanEdits.reassignedRequirements` 中）。
  - 点击移动：
    - 调 `peekAffectedClusterEdits(state, {type:"reassign-requirement", requirementId, targetClusterId})`。
    - 若返回非空 → `Modal.confirm` "目标 / 源 cluster `<ids>` 有人工任务编辑，将一并丢弃。继续？"。
    - 确认后：调 `api.reassignRequirement(reqId, targetClusterId)`，并对每个 affected cluster 调 `api.discardClusterEdits(cid)`。
  - cluster 列表底部加"+ 新建 cluster"按钮 → 弹 `Modal` 表单（title / primary repo / extra repos），提交时构造 `ClusterPlanItem`，调 `api.addManualCluster(cluster)`。
  - cluster 卡 title 旁加 `EditOutlined` → inline `Input`：Enter 提交（调 `api.renameCluster(cid, title)`），Esc 取消。
  - "派发中"（任意 `clusterRuns[*].status === "dispatching" | "creating-parent"`）时所有编辑入口 `disabled` + Tooltip "等待派发完成"。

测试：

- 组件级测试视既有覆盖度决定；最少在 manual smoke 项里验证 3 个交互。

验收命令：

```bash
bun test src/components/PrdSplitWizard
bunx tsc --noEmit
```

### Step 5 · 去抖刷新 `existingParents`

文件：

- `src/components/PrdSplitWizard/stages/ClusterPlanStage.tsx`：
  - `useEffect(() => { ... }, [state.clusterPlanEdits])` 内 `setTimeout(api.refreshExistingParents, 300)`；cleanup 清 timeout。
  - 初次进 plan 时已有的 effect 不变。

验收：纳入 manual smoke。

### Step 6 · 文档 / spec 索引

文件：

- 不动 `.trellis/spec/frontend/index.md`（除非新增可复用 spec 章节，目前判断不需要）。
- `implement.jsonl` / `check.jsonl` 视下面 sub-agent 章节决定是否填。

### Step 7 · 整合验收

最终命令清单：

```bash
bun test
bunx tsc --noEmit
# 如果改了 Rust（本任务预期不改），追加：cargo test --manifest-path src-tauri/Cargo.toml
```

**Manual smoke（由用户在 dev server 上跑）**：

1. 打开 wizard，粘贴含跨仓需求的 PRD，到 plan 看到误判 → 用"移到"把 requirement 挪到目标 cluster → diff badge 在 ~500ms 内更新。
2. 派发一个 cluster → 进 review → 改两条 task → 点 Steps 的"Cluster" → 弹确认 → 拒绝 → state 不变。
3. 重复 2，确认 → cluster run 与受影响 edits 清空，回到 plan 阶段。
4. 在 plan 阶段点"+ 新建 cluster" → 创建空 cluster → 移一条 requirement 进去 → 派发只该 cluster → review 正常。
5. 重命名 cluster title → 派发 → 父任务 slug 仍按 trellisWriter 规则（不被 UI title 污染）。
6. 在 Review 点 Steps 的"PRD" → 弹确认 → 确认 → 回到 input，PRD 文本仍在，下游全清。

## 校验门 / 复核点

每 step 完成后：

- `bun test` 全绿。
- `bunx tsc --noEmit` 全绿。
- `git diff --stat` 看是否只动了预期文件（防止误改其它模块）。
- 不 commit 任何 dirty 改动；commit 信息按项目 conventional commits 风格。

## 回滚点

- Step 1 ~ Step 2 完成后：纯 state 增量，无 UI 入口，回滚仅 `git revert` 一次。
- Step 3 ~ Step 5 任一步出问题：单独 `git revert` 该 commit；前置 step 仍可用。
- 落地后发现严重 UI bug：`git revert` 整 PR；无数据 / 文件残留。

## Sub-agent 上下文（可选）

如果决定派 `trellis-implement` 跑实现，curate：

- `implement.jsonl`：
  - `src/components/PrdSplitWizard/types.ts`
  - `src/components/PrdSplitWizard/useSplitWizardState.ts`
  - `src/components/PrdSplitWizard/clusterPlanEdits.ts`（待新增）
  - `src/components/PrdSplitWizard/stages/ClusterPlanStage.tsx`
  - `src/components/PrdSplitWizard/PrdSplitWizardModal.tsx`
  - `src/services/prdSplit/clusterPlanner.ts`（只读 / 参考）
  - `.trellis/spec/frontend/index.md`（read on demand）
- `check.jsonl`：
  - `src/components/PrdSplitWizard/clusterPlanEdits.test.ts`（待新增）
  - `src/components/PrdSplitWizard/useSplitWizardState.test.ts`（待新增）
  - 现有 `taskEdits.test.ts` / `anchorEdits.test.ts`（确认未受影响）

不派 sub-agent 直接由我手动写也可以——本任务改动集中、文件不多，可控。
