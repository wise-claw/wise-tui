# 项目 Trellis 集成

## Goal

把"项目"概念真正接到 Trellis 工作流：项目卡能看到 `.trellis/` 就绪状态、能编辑该项目的 `.trellis/spec/**`、并把 PRD-split 的产出接到 `workflowGraph` 编排。

## 当前状态

- `Host.tsx:202-208` 的项目下拉只显示 `name + rootPath` 字符串，不告诉用户 `.trellis/` 是否就绪。
- `.trellis/spec/` 完全没有 UI 入口（只能命令行编辑）。
- `src/components/workflowGraph/` 存在，但与 PRD-split 完全断开（派发完不能自动接到 workflow 节点）。

## 三个子方向（Phase 1 决定是否再拆）

### 2a. `.trellis/` 状态显示 + 一键 init（小）
- 项目卡显示 badge：`Trellis ✓`/`未初始化`
- 未初始化时显示「Init Trellis」按钮 → 后端执行 `python3 .trellis/scripts/task.py` 引导脚本或等价 Rust 实现

### 2b. spec 编辑面板（中）
- 入口：项目设置 / 侧栏新增「Spec」面板
- 列出 `.trellis/spec/**/*.md`，按目录折叠
- 用 `MilkdownViewer` 等富文本预览，编辑用 textarea 或 Milkdown 编辑器
- 落盘走现有 `repository_files.rs` IPC

### 2c. workflow 编排接入（中-大）
- wizard `state.writeResults` 落盘后产出 cluster→tasks 映射
- workflowGraph 接收映射，自动建节点 + 依赖边
- 用户可在 graph 上调整后再触发 dispatch chain

## Open Questions

- 2a 的 Init 行为：是否需要让用户先选 monorepo package？
- 2b 的 spec 编辑是否要支持 split-view（preview vs source）？
- 2c 的 workflow 模型与现有 graph schema 是否对得上？需要先看 `services/workflow/`。

## Out of Scope

- spec 内容的语法 lint / schema 校验。
- workflow 节点的执行调度（属于 trellis-implement 子代理职责）。

## Notes

- 依赖：2c 强依赖 `05-14-split-output-trellis-shape` 完成（implement.md 是 workflow 调度的输入）。
- 建议执行顺序：2a → 2b → 2c。Phase 1 规划时讨论是否真要拆为 3 个独立任务。
