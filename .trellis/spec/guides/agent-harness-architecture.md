# Agent Harness 产品架构（Wise 之所以是 Wise）

> **目的**：在 "Claude Code 套壳" 与 "全自动研发驾驶舱" 之间画一条清晰的产品边界。每一个新功能、新面板、新入口，都必须能在本文的骨架上找到位置；找不到位置的，就先别加。

> **状态**：本文档是 Wise 产品的**宪法层**。涉及顶层布局、ViewMode 状态机、域分层、Trellis 与 Mission 的契约绑定的改动，需要先更新本文档，再写代码。

---

## 0. 一句话定位

Wise 是一个 **Trellis-native 的研发自动驾驶舱（Agent Harness）**，把 PRD → Plan → Split → Dispatch → Run → Verify → Spec 反哺这条 Loop 包成一个可见、可中断、可追溯的工作台。Claude Code 是它跑代码的**引擎**之一，不是它的**外壳**。

---

## 1. 核心 Loop

整个产品都围绕这条 Loop 转。任何功能必须能映射到 Loop 的某个节点；映射不上的，要么是配置态（Author），要么不该做。

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
          ┌──────────────────┐                            │
   PRD ──►│  Plan            │  Trellis Brainstorm         │
          │  (Brainstorm)    │  ➜ prd.md / design.md       │
          └────────┬─────────┘                            │
                   │                                     │
                   ▼                                     │
          ┌──────────────────┐                            │
          │  Split           │  trellis-splitter           │
          │  (Splitter)      │  ➜ tasks + clusters         │
          └────────┬─────────┘                            │
                   │                                     │
                   ▼                                     │
          ┌──────────────────┐                            │
          │  Dispatch        │  Mission Control            │
          │  (Assignments)   │  ➜ assignments + sessions   │
          └────────┬─────────┘                            │
                   │                                     │
                   ▼                                     │
          ┌──────────────────┐                            │
          │  Run             │  trellis-implement /        │
          │  (Agents)        │  Claude sessions / OMC      │
          └────────┬─────────┘                            │
                   │                                     │
                   ▼                                     │
          ┌──────────────────┐                            │
          │  Verify          │  trellis-check /            │
          │  (Evidence)      │  trellis-verifier           │
          └────────┬─────────┘                            │
                   │                                     │
                   ▼                                     │
          ┌──────────────────┐                            │
          │  Reflect         │  trellis-update-spec /      │
          │  (Spec 反哺)      │  trellis-break-loop         │
          └────────┬─────────┘                            │
                   │                                     │
                   └────────────► spec / hook / skill ────┘
                                  下次 Loop 直接受益
```

**关键性质**：

1. **Loop 是事实，不是宣传语**。每条边都对应代码里实际发生的写入：`mission_runs` / `mission_agent_assignments` / `trellis_agent_runs` / `trellis_runtime_events` / `trellis_spec_revisions`。
2. **Trellis 是 Loop 的"语义层"，Mission 是 Loop 的"运行时实例"**。两者必须双写并共享 ID（见 §5）。
3. **Loop 上的每一步都可以被人工接管**。"自动驾驶" ≠ "黑盒"，用户在任何节点都可以暂停、追加指令、改派、重跑。

---

## 2. 三域分层（Operator / Author / Inspector）

任何 UI 入口必须先归类到下面三域之一，否则不允许加。

### 2.1 Operator 域 —— "我现在要跑活"

用户在跑 Loop。主屏给这个域用。

| 表面 | 干什么 |
|------|--------|
| **Cockpit**（默认主屏） | 看 Mission 全貌：PRD 树 + 任务泳道 + 子代理活动摘要 |
| **Chat**（沉浸子模式） | 与主会话/某个子代理深度对话；从 Cockpit 展开 |
| **Mission Control**（即将合并入 Cockpit，见 §3） | PRD split 流程的全屏向导 |

### 2.2 Author 域 —— "我要配置规则 / 模板 / 角色"

用户在改 Loop 的契约和供给。**和 Operator 域时空错开**，不应在主屏抢戏。

| 表面 | 干什么 |
|------|--------|
| Repositories & Projects | Workspace / Standalone Repo 的注册（见 §6） |
| Agents | 员工配置（原 EmployeeConfigModal）|
| Workflows | 团队工作流模板（原 WorkflowConfigModal + Workflow Studio）|
| MCP | MCP 服务器列表与启用 |
| Skills | 项目/全局 skills.sh 目录 |
| Hooks | Claude/IDE hook 编排 |
| Prompts | Prompt 模板库 |
| Trellis Spec | `.trellis/spec/` 编辑器（新） |

**全部进同一个 Author 入口**（齿轮 / 项目设置），内部用 Tab 区分。**不允许**每加一项就在顶栏多一个图标。

### 2.3 Inspector 域 —— "我要临时看一个透镜"

短时打开、看完就关。**永远以右栏抽屉或叠层形式出现**，不抢主屏。

| 表面 | 干什么 |
|------|--------|
| Code Knowledge Graph | 代码图谱（gitnexus）|
| Git Panel | 当前仓库的 git 状态/diff/历史 |
| File Editor | 临时打开仓库文件 |
| Task Detail Drawer | Mission 中的任务详情 |
| Progress Monitor Drawer | 实时监控某个 employee/team |
| Session History | 历史会话查询 |

**判定标准**：如果一个面板用户只看 1-2 分钟就关，它就属于 Inspector，不应该常驻侧栏。

---

## 3. 顶层 ViewMode 状态机（替代 6 个布尔）

当前 `AppImpl.tsx` 用 6 个互斥布尔表达模式，每加一个功能就新增一个布尔，是产品骨架失控的最直接征兆。

**替换方案**：用一个 discriminated union 表达"用户当前处于哪个 View"。

```ts
// src/types/viewMode.ts
export type ViewMode =
  | { kind: "cockpit"; missionId?: string }
  // 默认主屏：Mission 全貌 + 上下文 Inspector
  | { kind: "chat"; sessionId: string }
  // 沉浸对话子模式（从 Cockpit 展开）
  | { kind: "author"; pane: AuthorPane }
  // 配置域（齿轮入口；内部 Tab 切换）
  | { kind: "inspect"; tool: InspectTool };
  // 临时透镜叠层（不离开当前 View）

export type AuthorPane =
  | "workspaces"
  | "agents"
  | "workflows"
  | "mcp"
  | "skills"
  | "hooks"
  | "prompts"
  | "trellis-spec";

export type InspectTool =
  | { kind: "code-graph"; repositoryId?: number; projectId?: string }
  | { kind: "workflow-studio"; sessionPath: string }
  | { kind: "task-detail"; taskId: string }
  | { kind: "monitor-drawer"; target: MonitorDrawerTarget }
  | { kind: "session-history"; sessionId: string };
```

**约束**：

1. `kind: "cockpit" | "chat"` **互斥**：用户要么看全貌，要么沉浸单线。
2. `kind: "author"` 进入时**离开 Operator 主流**：Mission/Chat 仍然在后台跑，不丢状态。
3. `kind: "inspect"` 是**叠层**：在 Cockpit/Chat 之上以 Drawer/Modal/Overlay 出现，关闭后回到原 View。
4. **没有 nested mode**：不允许 "Cockpit 套 Mission Control 套 Modal"。如果嵌套需求出现，先回来改本文档。

**实施位置**：`src/hooks/useViewMode.ts`（新）+ `src/components/ViewModeRouter.tsx`（新），从 `AppImpl.tsx` 抽出 600+ 行模式管理代码。

---

## 4. 默认主屏：Cockpit（不是 Chat）

> **当前问题**：默认主屏是 ClaudeSessions（聊天），Mission Control 是要点开的全屏 Modal。这是 Wise 看起来像 "Claude Code 套壳" 的根本原因。

### 4.1 Cockpit 三栏

```
┌──────────────────────────────────────────────────────────────────────┐
│ Cockpit Header: Mission 标题 / 阶段 stepper / 子代理活动 / CTA           │
├─────────────────┬─────────────────────────────┬──────────────────────┤
│ Workspace 树    │  Mission 主画布              │ Inspector            │
│                 │                             │                      │
│ - 项目 (与仓库)  │  - PRD 需求树（左列）       │ 跟随用户在主画布点击：  │
│ - Standalone    │  - 任务泳道（中列）         │  - 任务点击 → 任务详情  │
│   Repos         │  - SVG 依赖连线              │  - PRD 点击 → 锚点预览  │
│ - Active Mission│  - 子代理状态 chip           │  - Agent 点击 → 实时   │
│   Indicator     │                             │    stdout / runtime    │
│                 │                             │  - 默认: Mission 概览   │
│  ~240px         │  flex-grow                  │  ~360px (可拖拽)       │
└─────────────────┴─────────────────────────────┴──────────────────────┘
```

### 4.2 Inspector（右栏）取代 RightPanel 的混排

当前 `RightPanel.tsx` 把 GitPanel + ProgressMonitorPanel + ClaudeCodeToolsPanel 三件并列。这三件不是同一时空的需求：

- **GitPanel** 是 Verify 时刻才看
- **ProgressMonitorPanel** 是 Run 全程都想看
- **ClaudeCodeToolsPanel** 是 Author 域配置查看

**重构方向**：Inspector 根据 View 的语义决定显示什么：

| Cockpit View 的 Inspector 内容 | 触发 |
|-------|------|
| Mission 概览（默认） | 进入 Cockpit |
| 任务详情 + 关联会话 | 点任务卡 |
| PRD 锚点预览 | 点 PRD 节点 |
| Agent 实时 stdout + runtime event | 点 agent 状态 chip |
| Git Diff (任务范围) | 点任务的 "证据" tab |
| Code Graph 局部视图 | 点任务的 "影响" tab |

### 4.3 Chat 退化为子模式

从 Cockpit 任意位置可以一键展开 "Chat 沉浸"：临时让某个会话占满中央 + 右栏，左栏 Workspace 树保留。**不是删掉 Chat 能力，是把它从默认主屏降级**。

---

## 5. Trellis ↔ Mission 双写契约

> **当前裂缝**：Trellis 跑自己的 spec/skill/hook，Mission 跑自己的 `mission_*` 表。Splitter 写了 `mission_agent_assignments` 但没写 `trellis_agent_runs`（05-16 F1 已经在修）。这种裂缝会随功能继续增加而扩大。

### 5.1 ID 共享

每一次 agent 调用都同时写 Mission 侧和 Trellis 侧，**共享 ID**：

```
mission_agent_assignment.assignment_id
   ≡ mission_agent_assignment.agent_run_id
   ≡ trellis_agent_runs.agent_run_id
```

ID 由 `missionAssignmentId(missionId, clusterId, role)` 派生，**不允许**另起 ID。

### 5.2 阶段映射

| Trellis Phase | Mission Stage | 写入 |
|---|---|---|
| Phase 1 Plan (brainstorm) | `mission.stage = "planning"` | `mission_runs` create + `trellis_spec_revisions` (如果改了 spec) |
| Phase 1.4 task.py start | `mission.stage = "in_progress"` | `mission_events: mission.activated` |
| Phase 2.1 implement | `assignment.role = "implement"` | `mission_agent_assignments` + `trellis_agent_runs` 双写 |
| Phase 2.2 check | `assignment.role = "check"` | 同上 |
| Phase 3.1 verify | `assignment.role = "verify"` | 同上 + `mission_evidence` |
| Phase 3.3 spec update | n/a | `trellis_spec_revisions` |
| Phase 3.4 commit | `mission.stage = "completed"` | `mission_events: mission.completed` |

### 5.3 Workflow.md 是 Mission 的契约源

Mission 创建时**快照**当前 `.trellis/workflow.md`：

```ts
mission_runs.workflow_snapshot_id  -> trellis_workflow_snapshots.id
                                       ├─ phases (JSON)
                                       ├─ steps (JSON)
                                       └─ committed_at
```

这样：

1. 即使 `workflow.md` 后续被改，老 Mission 仍然按它启动时的契约展示阶段
2. 用户在 Cockpit Header 看到的 stepper 不是 hardcode，是从 snapshot 读
3. 可视化 workflow 编排（未来）改的是 `workflow.md`，新 Mission 自动用新版本

---

## 6. Workspace vs Standalone Repo（命名修订）

> **当前问题**：代码里到处是 `floatingRepositories` 特例分支，但产品上没给用户讲清"项目 vs 游离仓库"的差异。新用户不知道选哪个。

**修订**：

| 旧名 | 新名 | 含义 |
|------|------|------|
| 项目 | **Workspace** | 一组共享 Trellis + 共享 Mission 的仓库（monorepo 或多仓） |
| 游离仓库 | **Standalone Repo** | 单仓快速接入，**不强制 Trellis**，**不进 Mission Control** |

**产品规则**：

1. **Standalone Repo 只跑 Chat 模式**。能用 Claude Code、git、文件编辑、code graph，但 Mission Control / Workflow / Author 域功能默认隐藏。
2. **Workspace 才是 Wise 的"主菜"**。Trellis 默认嵌入，Mission Control 是它的主屏。
3. **Standalone Repo 可以"升格"为 Workspace**（已有 `handlePromoteFloatingRepositoryToProject`），升格意味着接入 Trellis。
4. UI 不必立刻改名，但所有新写的代码、文档、注释统一用 Workspace / Standalone Repo。

---

## 7. 实施优先级（roadmap）

> 每一个 P 都是一个独立的 Trellis 任务。**不允许跨 P 顺手改**。

### P0 · ViewMode 状态机收口 `[1 周内]`

- 把 6 个布尔（promptsMode / missionControlMode / mcpHubMode / skillsHubMode / codeKnowledgeGraphMode / ccWfStudioMode）替换为 `useViewMode` 钩子 + `ViewMode` discriminated union
- 抽离 `ViewModeRouter` 组件替代 `AppWorkspaceLayout` 里的 if/else 分支
- 不改任何 UI 视觉，只改状态结构
- 验收：AppImpl.tsx 净减 200+ 行，所有现有路径行为不变

### P1 · Cockpit 取代默认主屏 `[2 周]`

- 启动时默认进入 Cockpit（即 Mission 主画布）
- Chat 降级为子模式
- 右栏 RightPanel 拆为 Inspector，按 ViewMode 上下文驱动
- 验收：新用户打开 Wise 第一眼看到的不是聊天

### P2 · 挂载 useMissionRunStore（来自 05-16 F3） `[配合 P1]`

- 把已写好但未挂载的 `useMissionRunStore` 接到 Cockpit
- 后台 PRD split 关闭窗口可继续，重开恢复
- 已在 05-16 F3 PRD 中描述

### P3 · Author 域统一入口 `[1 周]`

- 顶栏齿轮 → Author Drawer（Tab 化）：Repositories / Agents / Workflows / MCP / Skills / Hooks / Prompts / Trellis Spec
- 移除 LeftSidebar 顶部的 LeftSidebarTopNavStack
- 验收：侧栏只有 Workspace 树，导航集中在顶栏

### P4 · Trellis ↔ Mission 双写补全 `[2 周，含 05-16 F1/F4/F7]`

- F1：Splitter 写 trellis_agent_runs
- F4：主会话发消息绑定 active mission，记录 instruction / agent command
- F7：可视化 workflow.md（在 Author 域 Trellis Spec Tab 下）
- workflow_snapshot 机制（§5.3）

### P5 · 命名与心智收口 `[长期]`

- 内部代码逐步改 floatingRepositories → standaloneRepos（不打破存量数据，加 alias）
- 文档统一 Workspace / Standalone Repo
- 新用户引导（onboarding）按本文档骨架走

### Out of Scope（明确不做）

- 暗黑模式 / 主题切换
- 第二个 UI 框架
- AppImpl 的"渐进重构"（要做就单独立任务，冻结新增）
- 增量加新顶栏/侧栏入口（任何新功能必须先归到 Operator/Author/Inspector 三域）

---

## 8. 决策记录（持续更新）

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-05-17 | 默认主屏改 Cockpit，Chat 降级为子模式 | 把 Wise 从 "Claude Code 套壳" 拉回 "研发驾驶舱" |
| 2026-05-17 | 6 个 mode 布尔合并为 ViewMode 状态机 | 阻止 "加一个功能加一个布尔" 的失控扩张 |
| 2026-05-17 | Author 域统一入口（齿轮 + Tab） | Operator / Author 时空错开，主屏只服务跑 Loop |
| 2026-05-17 | Trellis 与 Mission 共享 agent_run_id | 把 Trellis 工作流契约和 Mission 运行时实例钉成一回事 |
| 2026-05-17 | 项目 → Workspace；游离仓库 → Standalone Repo | 让两类用户的入口和心智一目了然 |

---

## 9. 引用

- 05-15 mission-control-redesign PRD：左树 + 中泳道 + 右抽屉布局；本文档 §4.1 是它的产品级化身
- 05-16 mission-control-acceptance-closeout PRD：F1/F3/F4/F5/F6/F7 的具体工程项；本文档 P2/P4 是它们的归位
- `.trellis/workflow.md`：Trellis Phase 1/2/3 定义；本文档 §5.2 是它和 Mission 的映射

---

**核心原则**：每一次 PR 都问 "我的改动落在 §1 的 Loop 哪一步、§2 的哪个域、§3 的哪个 ViewMode"。三个问题答不上来，PR 就先不要交。
