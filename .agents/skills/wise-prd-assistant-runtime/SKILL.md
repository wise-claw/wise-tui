---
name: wise-prd-assistant-runtime
description: "用于 Wise 需求拆分助手、PrdTaskSplitPanel、PRD sandbox、Trellis 任务落盘、Mission/Trellis runtime 双写、splitter/fanout 派发、运行透镜或 session record 相关改动。"
---

# Wise PRD Assistant Runtime

修改需求助手主链路时使用本 Skill。它覆盖从 PRD 输入到任务拆分、复核、落盘、派发、运行追踪和 spec 反哺的 Wise 产品主路径。

## 先读

1. 先用 `wise-before-dev`。
2. 读取 `.trellis/spec/guides/agent-harness-architecture.md`。
3. 当前主链路任务优先读：
   - `.trellis/tasks/05-21-prd-assistant-mission-runtime/prd.md`
   - `.trellis/tasks/05-21-prd-assistant-mission-runtime/design.md`
   - `.trellis/tasks/05-21-prd-assistant-mission-runtime/implement.md`

## 产品边界

- `PrdTaskSplitPanel` 是当前需求助手主 UI。
- `MissionControl` / `PrdSplitWizard` 旧 UI 不应复活；可复用其 headless state、actions、ledger、runtime lens。
- 拆分前阶段是 sandbox：PRD、requirements index、cluster plan、候选任务、锚点、依赖均可审查，不提前写 `.trellis/tasks`。
- 用户显式执行后，才创建或复用 parent task，dispatch splitter，写入 Mission assignment 与 Trellis runtime。
- UI 文案不能把 fanout handoff 表述成“实现完成”。派发后应表达为“主会话接管 / 派发状态 / 运行透镜”。
- 需求助手不直接调用 `.trellis/scripts/add_session.py`。session record 应由主会话或 Trellis runtime 接管。

## 代码地图

前端 UI：

- `src/components/CockpitSurface/`：助手 Hub 与内置助手会话入口。
- `src/components/PrdTaskSplitPanel/`：需求助手主界面。
- `src/components/PrdSplitWizard/`：可复用 headless 类型、target model、reducer；不要恢复旧向导 UI。
- `src/components/MissionControl/actions/`：Mission action / run orchestration 来源。

前端服务：

- `src/services/prdSplit/`：PRD 拆分、验证、持久化、派发辅助。
- `src/services/mission/`：Mission session binding 与运行态辅助。
- `src/services/trellis/`：Trellis / SDD mode 检测。
- `src/services/taskArtifact.ts`：`.trellis/tasks/<dir>/{prd,design,implement}.md` 读写 wrapper。
- `src/services/assistantPromptLayers.ts`：平台默认、内置、助手、项目、仓库 prompt layer 解析。

Tauri：

- `src-tauri/src/assistants/builtins/prd_split.rs`：内置需求助手 bundle、system prompt、工具表。
- `src-tauri/src/claude_commands/prd_split.rs`：PRD split 执行。
- `src-tauri/src/claude_commands/prd_split_pipeline.rs`：pipeline 编排。
- `src-tauri/src/prd_materialize.rs`：任务/资产落盘与路径规范化。
- `src-tauri/src/task_artifact.rs`：任务文档 IPC。
- `src-tauri/src/mission_control.rs`：Mission、assignment、evidence、trace。
- `src-tauri/src/trellis_runtime.rs`、`trellis_bridge.rs`、`trellis_bootstrap.rs`：Trellis runtime 事件与桥接。

## 运行流

```text
resolve TrellisTarget
  -> edit/import PRD
  -> build requirements index
  -> plan clusters
  -> review candidates and anchors
  -> explicit execute
  -> create/resume Mission
  -> create/reuse parent task
  -> dispatch trellis-splitter per cluster
  -> validate splitter output
  -> materialize reviewed child tasks
  -> optional fanout implementation waves
  -> expose runtime status and handoff in UI
```

## TrellisTarget 规则

- Workspace 有 `rootPath` 时，`rootPath` 是 `.trellis` 事实源。
- 单仓 Workspace 不退化成 Standalone Repo。
- Workspace 成员 repo 是 execution target，不展示 repo 级 Trellis root。
- Standalone Repo 用 repo path 作为 Trellis root，并生成 synthetic project ref。
- target 解析失败时，UI 展示明确阻断原因，不静默 fallback。

## 改动规则

- 保留 PRD 编辑、导入、候选任务编辑、手动任务、锚点能力。
- 预览阶段不写 `.trellis/tasks`。
- 执行阶段写入必须可追踪：parent task、child tasks、cluster、repo target、wave、active task path。
- splitter/fanout 的失败、retry、cancel、stdout/stderr 路径要能进入可见状态。
- 不要让 `PrdTaskSplitPanel` 直接维护互相竞争的 project/repository 语义；统一消费 `TrellisTarget`。
- 运行结束状态要区分“规划完成”“派发完成”“实现完成”“校验完成”。

## 验证

优先聚焦：

```bash
bun test src/components/PrdTaskSplitPanel
bun test src/services/prdSplit
bun test src/components/PrdSplitWizard
bunx tsc --noEmit --pretty false
```

不要启动 dev server。

