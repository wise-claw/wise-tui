# Implement · prd-split-entry-model-p0

## Step 1 · 确认 `TaskSplitContext` 类型

读 `src/types.ts`，看 `TaskSplitContext` 是否已支持 `mode: "repository"`，否则补字段。

## Step 2 · `PrdSplitWizardModal` 加 target picker

- 抽 `TargetPicker` 组件，含 Radio + 两个 Select。
- 新增 hook 内 state：`targetKind: "project" | "repository"`。
- `ensureProject` 改名为 `ensureProjectTarget`；新增 `ensureRepositoryTarget`。
- onChange Radio 时：`api.reset(null, [], null)` + 清空本地 targetKind。

## Step 3 · 单仓模式的兜底文案

`ClusterPlanStage` 提示语：若 `state.context?.mode === "repository"`，提示语简化为「单仓模式：只会生成 1 个 cluster」。

## Step 4 · 单测

新增 `targetPicker.test.ts` 验证 ensureRepositoryTarget 合成 ProjectRef 的正确性，或在现有 `useSplitWizardState.test.ts` 加一个 reducer reset 的 case。

## Step 5 · 验收

```bash
bun test
bunx tsc --noEmit
```

## Step 6 · Commit

`feat(prd-split): treat single repository as a first-class wizard target`。
