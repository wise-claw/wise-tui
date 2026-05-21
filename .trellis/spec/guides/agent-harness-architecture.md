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
| Delegation Protocol | 委派协议模板（原 WorkflowConfigModal + Workflow Studio）|
| MCP | MCP 服务器列表与启用 |
| Skills | 项目/全局 skills.sh 目录 |
| Hooks | Claude/IDE hook 编排 |
| Prompts | Prompt 模板库 |
| Trellis Spec | `.trellis/spec/` 编辑器（新） |

**全部进同一个 Author 入口**（齿轮 / 项目设置），内部用 Tab 区分。**不允许**每加一项就在顶栏多一个图标。

**AionUi 产品化借鉴规则**：

1. Wise 可以为 Hub / Channel / Automation / Artifact / Delegation Protocol 演进修改前端和后端。
2. 既有后端能力不删除；需要“合并入口”时，采用迁移、包装、聚合、重命名展示，不移除命令、数据和集成路径。
3. Author 域每个菜单必须回答“它在 AI 工作台闭环里负责什么”：供给生态、运行自动化、远程入口、产物检查、工作区契约或执行引擎。
4. 单平台配置（如钉钉）不应成为长期顶级入口；应并入平台无关的 Channel / Remote Access 工作台，再由卡片或折叠区承载具体平台。

**配置中心菜单审视表**：

| 菜单 | 工作台职责 | AionUi 借鉴方向 | Wise 交互方向 |
|------|------------|----------------|---------------|
| Hub 市场 | 生态总入口 | Agent Hub / 扩展市场 | 一屏展示扩展、助手、技能、MCP、执行引擎、远程入口、自动化、产物检查台，并可跳转到具体管理页 |
| 工作区 | Workspace 契约 | 项目入口集中化 | Workspace / Standalone Repo 注册、升格、绑定 Trellis 根目录；避免把项目级设置散在侧栏 |
| 智能体角色 | Agent 供给 | Local / Remote Agent tabs | Agent 角色、执行引擎、助手模板要有清晰来源和状态，后续支持模板市场 |
| 委派协议 | 任务委派协议 | 多 Agent 协作 | 流程模板、画布、阶段分派、异步邮箱和进度看板逐步合并 |
| 提示词模板 | Loop 语义契约 | 助手配置页 | PRD 拆分、会话提示词、平台默认提示词按作用域集中编辑 |
| Trellis 规范 | Spec 反哺 | 技能/规范生态 | `.trellis/spec/` 和反哺动作是一等配置，不作为隐藏文件编辑器 |
| 扩展市场 | 插件安装态 | Extension marketplace | 本地/远程索引、安装/更新/重试、贡献能力、SRI 校验逐步补齐 |
| 助手模板 | 可复用角色 | Assistant presets | 内置、自定义、扩展助手统一列表，后续做对话级启用 |
| 技能市场 | Skills 供给 | 三层技能模型 | 项目、用户、扩展技能统一管理，后续做技能包安装和启停 |
| MCP 工具 | 工具协议 | Tools / MCP settings | 推荐项、已安装项、扩展贡献 MCP 和连接测试集中 |
| 执行引擎 | Agent runtime | Local / Remote agents | Claude、Codex、自定义命令检测、健康检查、默认执行策略 |
| 定时自动化 | 24/7 工作台 | Cron + Agent session | 仓库 Cron 先收敛，后续升级为 Mission / Claude Session 级计划任务 |
| 远程入口 | 多平台远程控制 | Channels | 钉钉、飞书、企微、Telegram 都落到统一通道协议，禁止继续新增单平台顶级菜单 |
| 产物检查台 | Evidence / artifact review | 文件预览工作区 | Markdown、Diff、图片、HTML、PDF、Office 统一预览，多标签和 Git 回溯后续补齐 |
| Claude 运行目录 | 引擎环境 | System settings | 配置目录、settings.json、agents、hooks 的运行环境集中展示 |
| Hook 规则 | 工具链触发器 | Tools settings | Hook 搜索、导入、启停和作用域清晰化 |
| 快捷键 | 桌面效率 | System / About | 只保留为运行辅助页，不再和核心配置争主入口 |
| Claude 沙箱 | 权限边界 | System / Tools | 沙箱、权限、隔离策略集中说明；后续接权限批准流 |

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
  | { kind: "chat" }
  // 默认主屏：主会话 / 当前仓库工作流
  | { kind: "cockpit"; missionId?: string }
  // 助手 / Mission 工作台（从左栏显式进入）
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

### 3.1 CockpitSubMode（cockpit 内部状态，不挂 ViewMode union）

`cockpit` 内部由 `CockpitSurface` 维护一个**组件级**子状态，不抬升到 ViewMode union（避免破坏 §3 的 4-kind 约束）：

```ts
// 仅在 src/components/CockpitSurface 内部使用
type CockpitSubMode =
  | { kind: "hub" }
  | { kind: "conversation"; assistantId: string };
```

- `hub`：默认空态，渲染 **AssistantHub**（内置助手卡片 + 自建助手卡片 + 最近对话）。
- `conversation`：进入助手工作台。当前内置需求助手渲染 `AssistantHeader + PrdTaskSplitPanel`，左侧是 PRD 输入 / 导入 / Skills / MCP / 拆分配置，右侧在运行中展示 Claude subagent 过程，完成后展示拆分任务并可“重看过程”。
- 切换由 `CockpitSurface` 内 `useState` 管理，挂载策略见 `agent-harness-architecture` 引用文档（task `05-18-assistant-hub-builtin-prd-split`）。

**等价旧组件**：`MissionControl.tsx` 全屏壳不再保留。新助手入口复用 `PrdTaskSplitPanel`，运行能力保留在 headless mission actions、ledger hook 与 Inspector 透镜里，避免把助手页扩成新的 ChatPane / ArtifactPane 产品。

---

## 4. 默认主屏：Chat 优先，助手显式进入

> **2026-05-18 修订**：助手 Hub 不应比主会话优先级更高。应用默认仍进入主会话；用户从左栏“助手”显式进入 CockpitSurface。助手页必须提供“返回对话”入口。

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

### 4.4 Cockpit 默认空态 = AssistantHub（2026-05-18 修订）

> 修订动因：`MissionControl.tsx` 全屏壳被删除；Cockpit 主屏在没有 active mission 时不再渲染"Mission 概览空态"，改为渲染 **AssistantHub**（AionUI 风格的助手卡片网格 + 最近对话区 + AionUI 风格输入条）。

- 进入 Cockpit 且无 active mission → AssistantHub。
- 选择助手卡片或最近对话 → 切到 conversation 子态（见 §3.1）。
- conversation 子态内：`AssistantHeader + PrdTaskSplitPanel`。需求助手左侧承载 PRD 与资源选择，右侧承载运行过程 / 拆分任务结果。
- 助手工作台不显示右侧 Cockpit Inspector；`Mission 概览 / Git Diff / 子代理活动` 等透镜只在需要时作为后续 Inspector 入口打开，避免压缩需求拆分主工作区。
- §4.1 三栏的"中央 Mission 主画布"语义保持不变，只是其默认空态从"Mission 概览"换成 AssistantHub。

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
| 游离仓库 | **Standalone Repo** | 单仓快速接入，可在仓库路径上启用 Trellis；不再进入旧 MissionControl 全屏页 |

**产品规则**：

1. **Standalone Repo 是一等入口**。能用 Claude Code、git、文件编辑、code graph；检测到 `.trellis` 后同样可打开需求助手，但 Trellis root 使用仓库路径自身。
2. **Workspace 才是 Wise 的调度边界**。Trellis 默认嵌入，需求助手工作台以 Workspace rootPath 作为事实源，成员 repo 只是执行目标。
3. **Standalone Repo 可以"升格"为 Workspace**（已有 `handlePromoteFloatingRepositoryToProject`），升格意味着接入 Trellis。
4. **Workspace rootPath 是 Trellis/运行时根，不是成员仓库的物理边界**。手动关联仓库允许任意磁盘路径；`重新初始化` 只自动扫描 rootPath 下的 Git 仓库。
5. **Workspace 主会话属于 Workspace rootPath**。成员 repo 行打开的是 **Repo 执行会话**：cwd 是 repo path，继承 Workspace 的 Trellis 契约，但对话历史与 Workspace 主会话隔离，适合作为被指派后的局部实现窗口。
6. UI 不必立刻改名，但所有新写的代码、文档、注释统一用 Workspace / Standalone Repo。

---

## 7. 实施优先级（roadmap）

> 每一个 P 都是一个独立的 Trellis 任务。**不允许跨 P 顺手改**。

### P0 · ViewMode 状态机收口 `[1 周内]`

- 把 6 个布尔（promptsMode / missionControlMode / mcpHubMode / skillsHubMode / codeKnowledgeGraphMode / ccWfStudioMode）替换为 `useViewMode` 钩子 + `ViewMode` discriminated union
- 抽离 `ViewModeRouter` 组件替代 `AppWorkspaceLayout` 里的 if/else 分支
- 不改任何 UI 视觉，只改状态结构
- 验收：AppImpl.tsx 净减 200+ 行，所有现有路径行为不变

### P1 · 助手工作台显式入口 `[2 周]`

- 启动时默认进入 Chat 主会话
- 左栏“助手”显式进入 CockpitSurface / AssistantHub
- 助手 Header 和 Hub 都提供“返回对话”
- 右栏 RightPanel 拆为 Inspector，按 ViewMode 上下文驱动
- 验收：主会话不被助手抢占，需求助手打开后进入 PRD 拆分工作台

### P2 · 挂载 useMissionRunStore（来自 05-16 F3） `[配合 P1]`

- 把已写好但未挂载的 `useMissionRunStore` 接到 Cockpit
- 后台 PRD split 关闭窗口可继续，重开恢复
- 已在 05-16 F3 PRD 中描述

### P3 · Author 域统一入口 `[1 周]`

- 顶栏齿轮 → Author Drawer（Tab 化）：Repositories / Agents / Workflows / MCP / Skills / Hooks / Trellis Spec
- 移除 LeftSidebar 顶部的 LeftSidebarTopNavStack
- 验收：侧栏只有 Workspace 树，导航集中在顶栏

> 2026-05-18 修订：`Prompts` 与 `Trellis Spec` 两个 Tab 已从 Author Drawer 移除。
> - 提示词工坊（含 PRD 拆分提示词的项目层 / 仓库层 / 助手层覆盖）合并到 `AssistantSettingsDrawer` 的 `Prompts` Tab，按 scope 切换；存储统一到 `assistant_overrides` 表。
> - Trellis 规范编辑收敛到 Author 工作区里的 `ProjectTrellisCenter`，不再保留旧规范库兼容透镜。
> - 因此 Author Drawer 当前 Tab 集合为：Workspaces / Agents / Workflows / MCP / Skills / Hooks（外加生态与运行设置组的若干 Tab）。`AuthorPane` union 中 `prompts` 与 `trellis-spec` 已下线。

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
| 2026-05-18 | Cockpit 默认空态改为 AssistantHub；MissionControl.tsx 全屏壳删除 | PRD 拆分流程从"项目 FAB 触发的全屏黑盒"反转为助手宿主，对齐 AionUI 心智 |
| 2026-05-18 | Cockpit 内部新增 CockpitSubMode（hub/conversation），不挂 ViewMode union | 保留 §3 的 4-kind 约束；助手切换是组件级状态 |
| 2026-05-18 | D13 收敛：需求助手 conversation 先复用 `PrdTaskSplitPanel`，不实现独立 ChatPane / ArtifactPane | 先完成 AionUI 式助手壳与 Wise 现有需求拆分能力集成，避免一次性重写对话系统 |
| 2026-05-18 | 需求助手右侧运行过程化：运行中展示 Claude subagent 日志，完成后展示拆分任务并可重看过程 | 匹配“先看过程，结果生成后看任务”的助手工作台心智 |
| 2026-05-18 | 提示词覆盖统一到 `assistant_overrides(assistant_id, scope)` | 助手层 / 项目层 / 仓库层共用一表，删除 Author/prompts |
| 2026-05-18 | ProjectTrellisCenter 解体：Runtime/Workflow/SpecTimeline 降为 InspectTool；旧规范库兼容透镜后续收敛回 Author 工作区编辑中心 | Author 配置 Tab 不再混入运行态/观察态，符合 §2 三域分层 |
| 2026-05-18 | 三张审计表加 `assistant_id` 列，旧行 NULL = 前助手时代；mission_runs 加 task_dir | 不回填，UI 兜底显示"早期版本" |

---

## 9. 引用

- 05-15 mission-control-redesign PRD：左树 + 中泳道 + 右抽屉布局；本文档 §4.1 是它的产品级化身
- 05-16 mission-control-acceptance-closeout PRD：F1/F3/F4/F5/F6/F7 的具体工程项；本文档 P2/P4 是它们的归位
- `.trellis/workflow.md`：Trellis Phase 1/2/3 定义；本文档 §5.2 是它和 Mission 的映射

---

**核心原则**：每一次 PR 都问 "我的改动落在 §1 的 Loop 哪一步、§2 的哪个域、§3 的哪个 ViewMode"。三个问题答不上来，PR 就先不要交。
