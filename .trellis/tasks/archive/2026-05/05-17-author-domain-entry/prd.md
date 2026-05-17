# P3 · Author 域统一入口：齿轮 Tab 替代分散的 Hub 导航

## 1. 背景

LeftSidebar 顶部目前并列了一组"Hub 导航"按钮（`LeftSidebarTopNavStack`）：

- MCP Hub
- Skills Hub
- Workflow Studio

加上侧栏其它已存在的入口：

- AppSettingsModal（设置）
- EmployeeConfigModal（员工配置，由 RightPanel / 内部多处触发）
- WorkflowConfigModal（团队工作流模板，由内部多处触发）
- PromptsPanel（全屏 Modal）
- 项目右键菜单中的 "Trellis 中心"
- 仓库右键菜单中的 "SDD Mode 配置"

这些都是**配置作者**（Author）需要的功能——你在改"将来跑 Loop 用的契约 / 模板 / 角色"。它们和**操作员（Operator）跑 Mission 跑 Chat** 是不同时空的需求。

宪法（`.trellis/spec/guides/agent-harness-architecture.md` §2.2 + §7 P3）规定：所有 Author 功能必须收拢到**一个齿轮入口**，里面 Tab 化容纳。LeftSidebar 不再背 Author 入口。

## 2. 前置条件

- **建议合并 P0 之后做**（`05-17-view-mode-state-machine`），这样可以直接产出 `{ kind: "author", pane: "..." }` 的 ViewMode 入口
- 不强制依赖 P1（不影响 cockpit/chat 默认主屏）

## 3. 目标

让 Author 域的 8 类功能统一从顶栏一个齿轮按钮进入，内部用 Tab 切换。LeftSidebarTopNavStack 移除。

## 4. 范围

### 必做

#### 4.1 新建 AuthorPanel

新增 `src/components/AuthorPanel/`：

```
src/components/AuthorPanel/
├── AuthorPanel.tsx          # 入口，Layout: 左 Tab 导航 + 右内容
├── AuthorPanelTabs.tsx      # 8 个 tab 定义
├── tabs/
│   ├── WorkspacesTab.tsx    # 项目+游离仓库管理（兼容 P5 的 Workspace 命名）
│   ├── AgentsTab.tsx        # 员工配置（mount EmployeeConfigModal 的内容，不再是 Modal）
│   ├── WorkflowsTab.tsx     # 工作流模板（mount WorkflowConfigModal 的内容）
│   ├── McpTab.tsx           # mount McpHub
│   ├── SkillsTab.tsx        # mount SkillsHub
│   ├── HooksTab.tsx         # mount ClaudeHooksConfigPanel
│   ├── PromptsTab.tsx       # mount PromptsPanel（去全屏）
│   └── TrellisSpecTab.tsx   # 新建：mount ProjectTrellisCenter（已存在）
└── index.ts
```

**关键约束**：每个 tab 内部**复用现有组件**，不重写。McpHub / SkillsHub / EmployeeConfigModal 等已经写好的 UI 直接 mount 进 tab 即可（必要时把 Modal 形态改成 inline）。

#### 4.2 接入 ViewMode

`{ kind: "author", pane: AuthorPane }` 触发 AuthorPanel 全屏渲染（占满主区，左栏保持显示，右栏隐藏）。

进入 AuthorPanel 的方式：

- **顶栏齿轮按钮**（新增）→ `viewMode.enter({ kind: "author", pane: "workspaces" })`
- AuthorPanel 内部切换 tab → 更新 `pane`
- AuthorPanel 顶部"返回"按钮 → `viewMode.back()`，回到上一个 view

#### 4.3 删除分散入口

- LeftSidebar 中的 `LeftSidebarTopNavStack` 整段删除
- LeftSidebar `mcpNavActive / skillsNavActive / workflowStudioNavActive` 相关 props 移除
- AppImpl 中触发 EmployeeConfigModal / WorkflowConfigModal / PromptsPanel 的所有路径，改为 `viewMode.enter({ kind: "author", pane: <对应 pane> })`
- `AppSettingsModal` 保留（它是真正"设置"，不是 author 配置；齿轮的旁边可以单独放一个"用户设置"图标）

#### 4.4 兼容现有触发场景

下列已有触发路径必须仍然能进入对应 Author Tab，且**保留原有上下文参数**：

| 触发场景 | 旧行为 | 新行为 |
|---|---|---|
| 项目 PRD 面板"配置员工" | 打开 EmployeeConfigModal，预填 PRD 项目 | enter author/agents tab，并把 PRD 项目预填透传给 AgentsTab |
| 项目 PRD 面板"配置工作流" | 打开 WorkflowConfigModal | enter author/workflows tab，预填项目 |
| 仓库右键"配置员工 Owner" | 打开 EmployeeConfigModal（owner-scope-only） | enter author/agents tab，scope=repository-owner |
| 项目右键"打开 Trellis 中心" | 打开 ProjectTrellisCenter（自定义浮层） | enter author/trellis-spec tab，预填项目 |

ViewMode 的 `inspect` 类型如果带参数还不够覆盖这些上下文，需要扩展 `AuthorPane` 让它能携带子参数（保留向后兼容，简单做法：拓展为 `AuthorPaneState` 对象类型，包含 `pane: AuthorPane` + 可选的预填上下文）。

### 不做

- 不重写 McpHub / SkillsHub / EmployeeConfigModal / WorkflowConfigModal 的内部
- 不动 AppSettingsModal
- 不动 PromptsPanel 的功能（只是把它从全屏 Modal 形态改为 inline tab 内容）
- 不改 Mission Control / Cockpit / Chat
- 不动 Trellis 后端任何命令

## 5. 验收标准

### 行为

- [ ] LeftSidebarTopNavStack 在代码中被删除（不是隐藏）
- [ ] 顶栏新增齿轮按钮（位置和 P0/P1 协调；如果 P1 已合并则放 cockpit header 右上角；否则暂放 LeftSidebarTopbar 现有"设置"图标旁）
- [ ] 点齿轮 → 主区显示 AuthorPanel，左 tab 导航有 8 项，默认进 workspaces
- [ ] 切换各 tab 显示对应内容（McpHub / SkillsHub / etc.）
- [ ] 项目 PRD 面板"配置员工" → 进入 author/agents tab，AgentsTab 能读到预填 projectId
- [ ] AuthorPanel 顶部"返回" → 回到原 view
- [ ] 关闭/重开应用不丢失"上次在哪个 tab"（持久化到 `~/.wise/wise.db` 或 settings store）

### 代码

- [ ] `AppImpl.tsx` 减少 ≥ 60 行（去掉若干 modal 触发 callback）
- [ ] LeftSidebar.tsx props 去掉 `mcpNavActive / onOpenMcpHub / skillsNavActive / onOpenSkillsHub / workflowStudioNavActive / onOpenWorkflowStudio`
- [ ] 新增 src/components/AuthorPanel/ 目录及文件
- [ ] `bun test` 通过；新增 AuthorPanel 单测：tab 切换、预填上下文透传、返回行为
- [ ] `bunx tsc --noEmit` 通过

### 不破坏

- [ ] 所有原触发路径（侧栏点 MCP、项目 PRD 配员工、仓库 owner 配置等）行为等价
- [ ] McpHub / SkillsHub 内部行为不变（包括各自的搜索、刷新、操作）

## 6. 给 GPT 的话

- 这是中等复杂度但**纯壳层重组**任务，没有产品决策需要做
- 难点在 §4.4 的兼容路径：每个原触发点的 props / 预填参数必须继续可用
- 建议先做一份"现有触发路径清单"研究文档放到 `research/`：grep `EmployeeConfigModal`、`WorkflowConfigModal`、`McpHub`、`SkillsHub`、`ProjectTrellisCenter` 找全所有 mount 点和 props
- 提交前 grep 确认 `LeftSidebarTopNavStack` 已不存在
- 不要在本任务里改名 floatingRepository → standaloneRepo（属 P5）
