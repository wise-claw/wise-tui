# 需求助手主链路收敛

## Goal

把 Wise 需求拆分助手收敛为 Trellis-native 的主链路：保留 `PrdTaskSplitPanel` 作为当前产品 UI，复用/抽离 Mission/Wizard 中更完整的状态机、账本、cluster run、retry/cancel 和 Trellis runtime 双写能力，形成“UI 好用、状态锋利、执行可追踪”的需求到任务编排工作台。

## Background

Wise 的定位已经收紧为 Trellis 编排壳。CLI Trellis 仍是文件与命令协议，Wise 的价值是 Workspace 级可视化编排、审查、派发、重试、中断和追踪。

当前现实：

- `PrdTaskSplitPanel` 是新的需求助手主入口，承载了 PRD 编辑、导入、候选任务、提示词、用户审查等最新需求。
- `MissionControl` / `PrdSplitWizard` 的 UI 已经废弃，但其状态模型和运行态能力更完整。
- `PrdTaskSplitPanel` 里存在直接执行链路，容易绕开 Mission/Trellis 双写账本。
- Workspace 与 Standalone Repo 已经都是一等入口，但需求助手仍存在 project/repository 模式分叉。

## Requirements

- 引入统一的 Trellis target 概念，覆盖 Workspace 与 Standalone Repo。
- Workspace 下 `.trellis` 以 Workspace root 为事实源，成员 repo 只作为 execution target。
- Standalone Repo 使用 repo path 作为 Trellis root，和 Workspace 享有同等需求助手能力。
- 不复活旧 MissionControl/Wizard UI；废弃 UI 可以删除，保留或迁移其 headless orchestration 能力。
- `PrdTaskSplitPanel` 继续作为需求助手产品界面，但执行链路必须接入 Mission/Trellis runtime。
- 拆分前阶段必须是 sandbox：PRD、requirements index、cluster plan、候选任务、锚点、依赖可审查，不应提前写 `.trellis/tasks`。
- 显式执行后才创建/复用 parent task，派发 `trellis-splitter`，写入 Mission assignment 与 Trellis agent run。
- cluster dispatch 支持并发、retry、cancel、失败展示和 stdout/stderr 路径追踪。
- materialize child tasks 后，后续 fanout 必须保留 active task path、repo target、wave 和 parent task 追踪信息。
- UI 表达应从“两个空白卡片”转为“需求编排工作台”：目标、阶段、候选任务、归属 repo、运行时间线要清晰。

## Acceptance Criteria

- [ ] 有一个纯函数或轻量服务统一解析 active Workspace / Standalone Repo 为 `TrellisTarget`，并有单元测试覆盖单仓 Workspace、多仓 Workspace、游离 repo、缺 rootPath 等情况。
- [ ] `PrdTaskSplitPanel` 不再自己维护互相竞争的 project/repository 执行语义，而是消费统一 target。
- [ ] Mission/Wizard 的 cluster run 与账本写入能力被抽成 headless API/hook，旧 UI 不再作为主入口依赖；无价值的废弃 UI 可以删除。
- [ ] 需求助手从 sandbox 到 execution 的边界清楚：预览阶段不写 `.trellis/tasks`；执行阶段才创建/复用 parent task 并 dispatch splitter。
- [ ] splitter dispatch 的结果能进入 Mission assignment、`trellis_agent_runs`、`trellis_runtime_events`，并能暴露到 `PrdTaskSplitPanel`。
- [ ] 保留现有 PRD 编辑、导入、候选任务编辑、手动任务、锚点相关能力，不做功能倒退。
- [ ] UI 至少完成第一波信息架构收敛：顶部目标/阶段状态明确，候选任务区不再表现为大片无意义空白。
- [ ] 相关纯逻辑有聚焦测试；不启动 dev server。

## Out Of Scope

- 不重写完整视觉系统。
- 不删除数据库表、Tauri 命令或可复用运行语义；废弃 UI/壳层可以删除。
- 不改变 Claude Code 作为执行引擎之一的事实。
- 不把 OMC/Workflow Studio 彻底清理出代码库；本任务只在需求助手主链路中弱化遗留命名影响。

## Open Decisions

- 第一波实现优先级：先做 Target + headless runtime adapter + `PrdTaskSplitPanel` 接入；旧 UI 不再作为兼容目标。
