# P1 · Cockpit 取代默认主屏：把 Mission Control 提到默认主屏并降级 Chat 为子模式

## 1. 背景

当前 Wise 启动 → 默认主屏是 `ClaudeSessions`（聊天）；`MissionControl` 是要点开按钮才进入的全屏 Modal。

**这是 Wise 看起来像 "Claude Code 套壳" 的根本原因**。我们说 Wise 是"研发自动驾驶舱"，但用户第一眼看到的是聊天框。

宪法（`.trellis/spec/guides/agent-harness-architecture.md` §4）定义了纠正方向：默认主屏 = Cockpit（项目级 Mission 全貌 + 上下文 Inspector），Chat 退化为子模式。

## 2. 前置条件

- **必须先合并 P0**（`05-17-view-mode-state-machine`），本任务依赖 ViewMode 状态机
- 如果 P0 还没合并，先做 P0

## 3. 目标

让默认主屏是 Cockpit，Chat 是从 Cockpit 展开的沉浸子模式，RightPanel 重组为按 ViewMode 上下文驱动的 Inspector。

## 4. 范围

### 必做

#### 4.1 默认主屏切换

- 启动应用（无任何选中）：ViewMode 默认 = `{ kind: "cockpit" }`，主区显示 `MissionControl` 组件
- 用户在侧栏选中"项目（Workspace）" → ViewMode 仍为 cockpit；Mission Control 自动定位到该项目最近的 mission
- 用户在侧栏选中"游离仓库（Standalone Repo）" → ViewMode 自动切换到 `{ kind: "chat", sessionId: <主会话> }`（Standalone Repo 不进 cockpit，宪法 §6）

#### 4.2 Chat 沉浸子模式入口

- Cockpit Header 增加"展开沉浸对话"按钮：当前 missionId / activeSessionId 不空时可点
- 点击后 ViewMode → `{ kind: "chat", sessionId }`
- chat 子模式的 Header 上有"返回 Cockpit"按钮，点击 → `{ kind: "cockpit", missionId }`

#### 4.3 RightPanel 重组为 Inspector

把 `src/components/RightPanel.tsx` 改名/重写为 `src/components/Inspector/Inspector.tsx`，根据 ViewMode 上下文决定显示什么：

| ViewMode | Inspector 内容 |
|---|---|
| `cockpit`（默认无选中） | Mission 概览 + 子代理活动摘要 |
| `cockpit` + 选中任务 | 任务详情 + 关联会话 + Git Diff 预览（仅当任务范围有 diff） |
| `cockpit` + 选中 PRD 节点 | PRD 锚点预览（来自 `trellis_list_requirement_workspace`） |
| `cockpit` + 选中 Agent 状态 | 实时 stdout + runtime event |
| `chat` | 当前 Inspector（GitPanel + ProgressMonitorPanel + ClaudeCodeToolsPanel）—— 保持现状 |
| `author` | 隐藏（Author 域占满主屏） |
| `inspect` | 叠层；Inspector 仍按底层 view 决定 |

**重要**：Inspector 在 `chat` 模式下保持现状，不要在本任务中改动 GitPanel / ProgressMonitorPanel / ClaudeCodeToolsPanel 的内部行为。**只是把它们从"永远显示"变成"仅 chat 模式显示"**。

#### 4.4 LeftSidebar 调整（最小改动）

- LeftSidebar 在 `cockpit` 模式下保持显示
- 仅去掉 LeftSidebar 中的 `MissionIndicator`（已被 Cockpit Header 替代）和 `AgentAssignmentsPanel`（已被 Inspector 替代）
- 其他组件（ProjectRepositoryList / ActiveRepositoryFilesPanel / SystemResourceInline / TaskCardsNav）保持原样
- LeftSidebarTopNavStack（MCP / Skills / Workflow Studio）暂保留，由 P3 统一移除

#### 4.5 onboarding 兜底

- 用户没有任何项目时（`projects.length === 0 && floatingRepositories.length === 0`），cockpit 主区显示空态：引导创建 Workspace 或导入 Standalone Repo
- 用户有项目但没 mission 时：cockpit 主区显示"创建第一个 Mission"的引导

### 不做

- 不改 MissionControl 内部组件树（`canvas` / `header` / `engineering` / 等保持原样）
- 不改 Mission 数据写入逻辑（已被 05-16 完成）
- 不动 ClaudeSessions 内部
- 不改任何 Tauri 命令
- 不引入 onboarding 教程动画 / driver.js（保留现有用法）

## 5. 关键设计决策

### 5.1 missionId 来源

Cockpit 进入时取 missionId 优先级：

1. ViewMode 显式传入的 `missionId`（如 P0 中 `setMissionControlMode(true)` 携带的 initial target）
2. 当前选中项目的 `mission_list_recent({ projectId, limit: 1 })` 返回的最新非 done mission
3. null（显示项目空态：引导创建 mission）

### 5.2 RightPanel 拆分边界

把 `RightPanel.tsx` 的 props 切成两部分：
- **Inspector 通用**：dark / collapsed / siderWidth / repositoryPath / repositoryName / projectId
- **chat-only**：monitorStats / monitorPanelSessions / employeeMonitorItems / 等所有 monitor 相关

新组件 `Inspector` 在 `chat` 模式下渲染原 `RightPanel` 的全部内容；在 `cockpit` 模式下只渲染按上下文驱动的 Mission 视角。

具体接什么数据由 design.md 描述。

### 5.3 命名

文件改名：`RightPanel.tsx` → `Inspector/Inspector.tsx`，保留旧路径的 re-export 一段时间避免大量 import 改动。**不强求 P1 一次性消除所有旧 import**，让 P5 的 rename 任务一并处理。

## 6. 验收标准

### 视觉与行为

- [ ] 全新安装 / 清空 `~/.wise/` 后启动 Wise → 主屏是 cockpit 空态（引导创建 Workspace）
- [ ] 已存在项目时启动：主屏是 cockpit，自动定位最近 mission
- [ ] 选中 Standalone Repo：自动切到 chat 模式
- [ ] 选中 Workspace：保持 cockpit
- [ ] cockpit Header 有"沉浸对话"按钮，点击进入 chat
- [ ] chat Header 有"返回 Cockpit"按钮，点击回 cockpit
- [ ] cockpit 模式下 Inspector 显示 Mission 视角；chat 模式下显示 GitPanel + monitor + tools

### 代码

- [ ] `AppImpl.tsx` 减少 ≥ 80 行（默认 view 的初始化与切换被简化）
- [ ] `RightPanel.tsx` 改名为 `Inspector/Inspector.tsx`，旧路径仅保留 re-export
- [ ] `LeftSidebar` 中 `MissionIndicator` / `AgentAssignmentsPanel` 移除
- [ ] 新增 `src/components/Inspector/` 目录，按 ViewMode 派发的子组件分文件
- [ ] `bun test` 通过；新增组件单测：cockpit 空态、cockpit 选中任务的 Inspector 切换、chat-cockpit 互切
- [ ] `bunx tsc --noEmit` 通过

### 不破坏

- [ ] 所有 05-16 的 Mission Control 验收点（13 条）回归仍通过
- [ ] @-mention 派发 / Mission 会话绑定 / Splitter 后台运行 / Heartbeat / Workflow 可视化 全部不受影响

## 7. 给主对话方的话

P1 涉及主屏装配的边界判断比较多（特别是 Inspector 拆分、Standalone Repo vs Workspace 的视图选择），不建议交给 GPT 独立做。建议主对话方先写 design.md 把 Inspector 的数据流确定下来再动手。

## 8. 引用

- 宪法 §4（默认主屏：Cockpit）：`.trellis/spec/guides/agent-harness-architecture.md`
- P0 任务（前置）：`.trellis/tasks/05-17-view-mode-state-machine/`
- 已完成的 Mission 能力：`.trellis/tasks/archive/2026-05/05-16-*`
