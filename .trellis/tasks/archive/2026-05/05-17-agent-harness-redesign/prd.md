# Agent Harness 重构总览（编排锚点）

> **类型**：编排任务（不写代码），充当其他四个 P 级子任务的父锚点

## 1. 背景

`05-15` + `05-16` 已经把 Mission Control 的内里能力（splitter / ledger / runtime / 会话绑定 / heartbeat / workflow 可视化）补齐到 13 条产品验收全部满足。但产品**外壳**仍然是"Claude Code 套壳 + 一堆功能横向拼贴"：

- `AppImpl.tsx` 2557 行，6 个互斥 mode 布尔（`promptsMode` / `mcpHubMode` / `skillsHubMode` / `codeKnowledgeGraphMode` / `missionControlMode` / `ccWfStudioMode`），每加一个新功能就再加一个布尔 + 一段 if/else
- 默认主屏是 ClaudeSessions 聊天，Mission Control 是要点开的全屏 Modal —— Wise 看起来不像驾驶舱
- LeftSidebar 顶部塞了 7 个并列入口（MCP / Skills / Workflow Studio + 文件树 + 项目树 + 系统资源 + Mission Indicator），无信息层级
- RightPanel 把 GitPanel + ProgressMonitorPanel + ClaudeCodeToolsPanel 三件不同时空的需求横向并列
- 项目 / 游离仓库的产品语义在 UI 层完全不分

宪法文件 `.trellis/spec/guides/agent-harness-architecture.md` 已经把 Loop / 三域 / ViewMode 状态机 / Trellis-Mission 双写 / Workspace 命名等定下，所有 P 级子任务必须按宪法的 §7 优先级表落地。

## 2. 目标

把宪法 §7 落到代码：

| 优先级 | 子任务 | 状态 |
|---|---|---|
| P0 | ViewMode 状态机收口 | `05-17-view-mode-state-machine`（独立任务） |
| P1 | Cockpit 取代默认主屏 | `05-17-cockpit-default-main`（独立任务，依赖 P0） |
| P3 | Author 域统一入口 | `05-17-author-domain-entry`（独立任务，可与 P0/P1 并行） |
| P5 | Workspace / Standalone Repo 命名收口 | `05-17-workspace-standalone-rename`（独立任务，长期，可与所有其他并行） |

P2（挂载 useMissionRunStore）= 已归档的 `05-16-f3-mount-reconcile-background-runs` 完成。
P4（Trellis ↔ Mission 双写补全）= 已归档的 `05-16-f1` + `05-16-f4` + `05-16-f7` 完成。

本编排任务**自身不写代码**。它的产出是：

1. 把 4 个子任务 `task.json` / `prd.md` / `design.md` / `implement.md` 落齐
2. 通过 `task.py add-subtask` 把 4 个子任务挂在本任务下，建立父子关系
3. 跟踪 4 个子任务进度并在它们全部归档后归档本任务

## 3. 子任务依赖关系

```
P0 view-mode-state-machine  ←─── (前置) ──── P1 cockpit-default-main
       │
       │（同一会话内合并，避免重复改 AppImpl.tsx）
       │
P3 author-domain-entry      （独立，可并行）
P5 workspace-standalone-rename （独立，长期，可并行）
```

**给 GPT 分配建议**：
- GPT 可以独立做 **P0 / P3 / P5**（任务边界清楚、不依赖主屏改动）
- **P1** 建议主对话方做，因为它会触碰 RightPanel / LeftSidebar / ClaudeSessions 主屏装配，需要现场判断很多边界

## 4. 验收标准

- [ ] 4 个子任务全部 `task.py archive` 完成
- [ ] `AppImpl.tsx` 行数从 2557 降到 < 1500（P0 + P1 联合效果）
- [ ] 6 个 mode 布尔在代码中不再出现（被 ViewMode 替代）
- [ ] 启动时默认主屏是 Cockpit（不是 ClaudeSessions）
- [ ] LeftSidebarTopNavStack 移除（被 Author 域统一入口替代）
- [ ] 内部代码 / 注释 / 文档没有新写的 `floatingRepository`（旧引用走 alias 兼容）
- [ ] `bun test` 通过
- [ ] `bunx tsc --noEmit` 通过

## 5. 不做

- 任何超出宪法 §7 P0/P1/P3/P5 范围的改动
- 暗黑模式、主题切换、新 UI 框架（宪法已约束）
- 改 Tauri capabilities（宪法已约束）
- 在本任务下直接写代码（应在子任务中写）

## 6. 引用

- 产品宪法：`.trellis/spec/guides/agent-harness-architecture.md`
- 已完成的运行时基础：`.trellis/tasks/archive/2026-05/05-16-*`
