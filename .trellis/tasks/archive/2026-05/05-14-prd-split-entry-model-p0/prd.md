# PRD · prd-split-entry-model-p0

## Goal

把"需求拆分"的入口从"仅多仓项目"扩到三种一等公民：
1. 多仓项目（既有路径，保留）
2. 单仓项目（既有路径，已支持但入口未暴露）
3. 游离仓库（当前完全被排除）

底层 `planClusters` 已支持单仓（`clusterPlanner.ts:87`），P0 修的是入口模型 + UI。

## Requirements

- R1. wizard 顶部加 target 类型切换：「项目」/「单仓库」。
- R2. 选「项目」时沿用现有 ProjectPicker 行为。
- R3. 选「单仓库」时列出所有 `repositories[]`（含游离 + 项目内仓），每条标注 repo 类型；点击后构造合成 ProjectRef：
  - `id = "repo-${repo.id}"`
  - `name = repo.name`
  - `rootPath = repo.path`
- R4. context 字段：`mode = "repository"`、`repositoryId`、`repositoryName`、`repositoryType`。
- R5. 单仓模式下 cluster planner 走 `planSingleRepo`（已有），最终产出一个 cluster。
- R6. 单仓模式下，wizard 内不再显示"多 cluster"相关教学语言。
- R7. 失败兜底：选了未含 `.trellis/` 的仓位 → Tauri `validate_project_root` 已经会拒绝；wizard 把该错误优雅显示到 `globalError`。

## Acceptance Criteria

- [ ] 打开 wizard 默认 target 类型为 'project'；切换到 'repo' 显示 repo 下拉。
- [ ] 选游离仓后能完整走完 input → plan → dispatch → review。
- [ ] 单仓模式下 plan 阶段只生成 1 个 cluster。
- [ ] 切换 target 类型时 wizard 状态全清。
- [ ] `bun test` + `bunx tsc --noEmit` 全绿。

## Out of Scope

- P0#2 入口整合（legacy taskSplitMode 与 wizard 入口合并）—— 另开。
- 在游离仓上自动 init `.trellis/` —— 另开（属于 Ask 2a）。

## Notes

- 关联：本任务交付后，P0#2 入口整合更容易做（不再有"项目限定"假设）。
