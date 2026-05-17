# P0 · ViewMode 状态机：6 个 mode 布尔合并为 discriminated union

## 1. 背景

**根因**：`AppImpl.tsx`（2557 行）当前用 6 个互斥布尔表达"用户处于哪个全屏 / 叠层视图"：

```ts
const [promptsMode, setPromptsMode] = useState(false);
const [mcpHubMode, setMcpHubMode] = useState(false);
const [skillsHubMode, setSkillsHubMode] = useState(false);
const [codeKnowledgeGraphMode, setCodeKnowledgeGraphMode] = useState(false);
const [missionControlMode, setMissionControlMode] = useState(false);
const [ccWfStudioMode, setCcWfStudioMode] = useState(false);
```

**症状**：

1. 每打开一个新视图，要在 7-10 处地方写"先把其它 5 个 setXxxMode(false)"——典型坏味（参见 AppImpl 中 `openMissionControl`、`openCodeKnowledgeGraphAfterRepositorySelect`、`handleProjectSelectLeavingMcpHub`、`jumpToSessionLeavingMcpHub`、`handleOpenPromptsForProject` 等 8+ 个 callback）。
2. 模式互斥关系是分散的隐式约定，不是类型系统能保证的事实，加新模式时极易漏处理某个分支。
3. 这 6 个布尔同时还跨过 `useCcWorkflowStudioWorkspace` hook 边界传递（4 个 setter 当 props 传入），违反了"hook 不该耦合 6 个无关 setter"。
4. `AppWorkspaceLayout.tsx` 也吃了这 6 个布尔属性，里面用 `if/else` 决定主区放什么，而非由一个状态机驱动。

宪法（`.trellis/spec/guides/agent-harness-architecture.md` §3）已经定义了替换方案：用一个 `ViewMode` discriminated union 表达 4 个域（cockpit / chat / author / inspect）。

## 2. 目标

**等价替换**这 6 个布尔为一个 `ViewMode` 状态机。**不改任何 UI 视觉，不改用户行为**，只把状态结构换掉。

完成后可见效果：

- `AppImpl.tsx` 净减 ≥ 200 行
- 6 个 `setXxxMode(true|false)` 调用全部消失
- 新增 `useViewMode` hook，所有"切换视图"操作变成 `viewMode.enter({ kind: "cockpit" })` 之类的语义化调用
- 编译期保证模式互斥（discriminated union 的天然性质）
- 组件不再需要知道"我应该把其他模式置 false"——状态机的 reducer 自动处理

## 3. 范围

### 必做

1. 新建 `src/types/viewMode.ts`：定义 `ViewMode` discriminated union（按宪法 §3 的 schema）
2. 新建 `src/hooks/useViewMode.ts`：暴露 `viewMode` + `enter(next)` + `back()` + `isCockpit()` / `isAuthor()` / 等谓词
3. 重写 `AppImpl.tsx` 中 6 个 useState 的声明、所有 `setXxxMode` 调用、所有 mode 读侧
4. 重写 `useCcWorkflowStudioWorkspace.ts` 让它接受 `useViewMode` 而不是 4 个 setter
5. 修改 `AppWorkspaceLayout.tsx` 接受 `viewMode` 而不是 6 个布尔属性，内部用 switch 派发主区内容
6. 提供 4 个 `back()` / `enter()` 调用语义保持当前行为：从 author 退出回 cockpit，inspect 关闭回上一个 view，等

### 不做

- 不动 ViewMode 之外的 state（`searchOpen` / `dualPaneEnabled` / `terminalCollapsed` 等保持原样）
- 不动 6 个对应面板组件（McpHub / SkillsHub / MissionControl / 等）的内部
- 不引入 zustand / redux（用 useReducer 即可）
- 不改 Cockpit / Chat / Author / Inspect 内部的视觉

## 4. ViewMode 类型签名（来自宪法 §3）

```ts
// src/types/viewMode.ts
export type ViewMode =
  | { kind: "cockpit"; missionId?: string }
  | { kind: "chat"; sessionId: string }
  | { kind: "author"; pane: AuthorPane }
  | { kind: "inspect"; tool: InspectTool };

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
  | { kind: "code-graph"; repositoryId?: number; projectId?: string;
      lockToEntryRepository?: boolean; defaultProjectMultiRepo?: boolean;
      suppressIdleAutoReindex?: boolean }
  | { kind: "workflow-studio"; sessionPath: string }
  | { kind: "task-detail"; taskId: string }
  | { kind: "monitor-drawer"; target: import("../types").MonitorDrawerTarget }
  | { kind: "session-history"; sessionId: string };
```

## 5. 6 个布尔的等价映射表

| 旧布尔 | 新 ViewMode |
|---|---|
| 全部 false（默认） | `{ kind: "chat", sessionId: activeSessionId }` 或 `{ kind: "cockpit" }`（**本任务保持现状：默认 chat**，宪法 P1 才改默认为 cockpit） |
| `promptsMode = true` | `{ kind: "author", pane: "prompts" }` |
| `mcpHubMode = true` | `{ kind: "author", pane: "mcp" }` |
| `skillsHubMode = true` | `{ kind: "author", pane: "skills" }` |
| `missionControlMode = true` | `{ kind: "cockpit", missionId: missionControlInitialTarget?.missionId }` |
| `codeKnowledgeGraphMode = true` | `{ kind: "inspect", tool: { kind: "code-graph", ... } }` |
| `ccWfStudioMode = true` | `{ kind: "inspect", tool: { kind: "workflow-studio", sessionPath } }` |

**重要**：本任务**不改默认主屏行为**。宪法定义的"默认进 Cockpit"是 P1 的工作。本任务只做状态结构替换。

## 6. 验收标准

### 行为验证（必须等价）

- [ ] 启动应用：和现在完全一致（默认 chat 主屏，Mission Control 仍是要点击才打开）
- [ ] 点 LeftSidebarTopNavStack 的 MCP 入口：进入 MCP 叠层，左栏可见
- [ ] 在 MCP 叠层下点项目：自动收起 MCP，进入 chat（与现在 `handleSidebarRepositorySelectLeavingMcpHub` 行为一致）
- [ ] 点 Mission Control 入口：进入 cockpit 全屏，左栏隐藏
- [ ] Mission Control 内打开任务文件：cockpit 关闭，回 chat 并打开文件
- [ ] 关闭 Code Graph 叠层：回到之前的 chat 状态
- [ ] 仓库切换、项目切换、会话切换、提示词、技能、Workflow Studio 全部行为不变

### 代码质量

- [ ] `AppImpl.tsx` 行数减少 ≥ 200 行
- [ ] 全代码库 grep `setMcpHubMode|setSkillsHubMode|setMissionControlMode|setPromptsMode|setCodeKnowledgeGraphMode|setCcWfStudioMode` = 0 结果
- [ ] 全代码库 grep `mcpHubMode|skillsHubMode|missionControlMode|promptsMode|codeKnowledgeGraphMode|ccWfStudioMode` 仅在 `AppWorkspaceLayout.tsx` 老 props 兼容层（如果保留）出现，且该兼容层带 `@deprecated` 注释

### 工程

- [ ] `bun test` 通过；为 `useViewMode` 写单测覆盖：进入 / 退出 / 各 kind 之间切换
- [ ] `bunx tsc --noEmit` 通过
- [ ] `gitnexus_detect_changes` 显示影响范围限于 AppImpl / AppWorkspaceLayout / useCcWorkflowStudioWorkspace + 新增 2 个文件

## 7. 不做（再次强调）

- **不改默认主屏**（属 P1）
- **不改 LeftSidebar 的 7 入口拼贴**（属 P3）
- **不动 RightPanel**（属 P1）
- **不改任何 Mission/Trellis 写库逻辑**
- **不改名 floatingRepository**（属 P5）

## 8. 给 GPT 的话

- 本任务目标是**纯结构替换**，没有产品决策需要做
- 代码改动会触碰 `AppImpl.tsx`，建议先读完 §5 等价映射表再动手
- 由于影响面集中在 3 个文件 + 2 个新增文件，gitnexus 影响分析应该只显示 5-6 个 symbol；如果显示更多，多半是误改了别的逻辑，停下来检查
- 提交前必跑 `gitnexus_detect_changes` 验证范围
