# Design · prd-split-entry-model-p0

## 入口模型

`PrdSplitWizardModal` 现在只接 project；本次新增 `WizardTargetKind = "project" | "repository"`，UI 顶部加单选切换。

### Project mode（保留）

- 用户从下拉选 `ProjectItem`，要求 `rootPath` 非空。
- 沿用 `ensureProject` 现有逻辑。

### Repository mode（新增）

- 用户从下拉选 `Repository`。
- 合成 `ProjectRef`：
  - `id`: `repo-${repo.id}`
  - `name`: `repo.name`
  - `rootPath`: `repo.path`
- `repos` 数组只含该 repo 一项（用 PlannerRepo 投影）。
- `TaskSplitContext`：
  - `mode: "repository"`
  - `repositoryId: repo.id`
  - `repositoryName: repo.name`
  - `repositoryType: repo.repositoryType`

### 切换语义

- 切 target kind → `api.reset(null, [], null)`，wizard 回到 input 阶段。
- 切完后选择新 target → `api.reset(synthetic ref, repos, context)`。

## 组件改动

### 新组件 `TargetPicker`（替代 `ProjectPicker`）

- 顶部 Radio.Group：项目 / 单仓库。
- 子区域：当前模式对应的 Select。
- 模式切换不需要 useState 维护选择字段；通过 `state.context?.mode` + `state.project?.id` 推断当前选中态。

### 在 `Host.tsx` 中

- 已有 `repositories` 数据加载。无改动。

## 类型变更

`TaskSplitContext` 类型在 `src/types.ts` 应该已支持 `mode = "repository"`；只需确认字段命名匹配。若不存在，扩展为可选字段。

## 兼容性

- 现有 project 路径无回归（默认 mode = "project"）。
- 单仓项目走 project 路径，照样能 split（已支持）。游离仓走 repo 路径。
- Tauri 端 `validate_project_root` 已能处理任意带 `.trellis/scripts/task.py` 的路径，无需修改。
- 没有 `.trellis/` 的游离仓 → Tauri 命令拒绝 → wizard 显示错误。这一行为可接受作为 MVP。

## Rollback

纯前端改动 + 类型变更；`git revert` 即可。
