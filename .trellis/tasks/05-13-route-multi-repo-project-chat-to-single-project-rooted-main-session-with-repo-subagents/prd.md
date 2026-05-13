# Route Multi-Repo Project Chat to Single Project-Rooted Main Session with Repo Subagents

## Goal

让多仓 `wise_trellis` 项目（`workspaceMode === "multi_repo"`）在「直接协作」场景下也对齐为 **一个项目级主会话**（cwd = `project.rootPath`） + **repo 作为 subagent 路由目标**，不再为每个 repo 创建独立的 per-repo session。

游离仓库 / 单仓项目（`workspaceMode === "single_repo"`）保持现状：repo 自身即一个 agent，click repo = 创建/恢复 per-repo session。

这是 commit `9c3dea5`（"anchor multi-repo wise_trellis project sessions at project rootPath"）的**完成态**：彼时只覆盖了「需求 / split」模式的项目级锚定；本期把「直接对话 / chat」也对齐到项目主会话语义。

## What I already know

### 已有基础设施

- `workspaceMode`（PR3）已经把 single_repo / multi_repo 的派生收敛为单一来源（`useWorkspaceMode` hook + `resolveWorkspaceMode`）。
- `resolveProjectMainSessionAnchor`（`src/utils/projectSessionAnchor.ts`）已经知道如何决定项目主会话 anchor：多仓 wise_trellis + rootPath 非空 → 锚到 rootPath；否则锚到首 repo。
- `handleCreateProjectTask(project, "chat")`（`src/AppImpl.tsx:1261`）已经实现了「以 anchor.path 创建项目主会话」的完整路径 —— **只是 UI 没暴露入口**（侧栏项目卡只有「需求 (split)」按钮，没有「对话 (chat)」按钮）。
- @-mention dispatch（`atMentionDispatch.ts` + 相关 hooks）已能把 `@<role-tag>` 路由到项目下对应 repo 的 subagent。
- 项目卡 repo 节点已经按 commit `9c3dea5` 之后的约定渲染（带 role tag、属于一个 project 卡）。

### 当前 per-repo session 行为（被改对象）

- `handleSidebarRepositorySelect(repoId)`（`src/AppImpl.tsx:1138`）：
  - 找 ownerProject、激活 owner（PR3 收敛到 `setActiveRepositoryWithOwner`）
  - 然后在 `repository.path` 上 bind / restore / create 一个 per-repo session
- `handleCreateRepositoryTask(repo, "chat")`：在 `repository.path` 创建会话
- 启动 effect：对 `activeRepositoryId` 触发 `handleSidebarRepositorySelect`，即默认进项目时也走 per-repo

这些路径在 `workspaceMode === "multi_repo"` 时与新意图冲突。

### 项目主会话锚定语义（保留）

- 多仓 wise_trellis + rootPath 非空 → 项目根；
- 单仓或缺 rootPath → 首 repo path（与 per-repo session 同 cwd，但语义是项目主会话）；
- 这条派生不动。

## Assumptions

- 多仓 wise_trellis 项目里每个 repo 已配置了 role tag（前/后/文/自定义），at-mention dispatch 链路已可用。
- 项目主会话一旦创建，绑定关系通过现有 `bindRepositoryMainSession(anchor.path, sessionId)` 持久化；同一项目重复进入要能 restore。
- 单仓项目 / 游离 repo 行为完全不变。
- workspaceMode 派生稳定，不再演化新分支。

## Open Questions

（逐题问，每问完一题就转入 Requirements / Out of Scope。）

## Requirements (evolving)

- workspaceMode === "multi_repo" 下，**进入项目** = 自动打开/恢复项目主会话（cwd = `resolveProjectMainSessionAnchor(project).path`）。
- workspaceMode === "single_repo" 下，repo 行为不变（per-repo session）。
- 项目主会话绑定通过 `bindRepositoryMainSession(anchor.path, ...)` 复用现有持久化层。
- 不引入新 IPC / 新 DB 字段（schema-neutral）。
- **多仓项目下点击 repo 节点 = 不切换会话**（A）：
  - 只更新 `activeRepositoryId`（侧栏高亮 / 文件浏览器跟随）
  - conversation 仍然是项目主会话
  - 不在 `repo.path` 上 bind / restore / create per-repo session
  - 不自动改写 composer 草稿（不主动插 `@<role-tag>`）
- **项目主会话「进项目即开」**（A）：
  - 任何把 active 切到多仓项目的动作（侧栏点项目卡 / 启动恢复 / 跨项目跳会话）→ 自动恢复或创建 anchor.path 上的主会话
  - 复用 `bindRepositoryMainSession(anchor.path, sessionId)` 持久化
  - 首次进项目立即创建一个 session（与 single_repo 行为对称）
- **多仓项目 repo 行隐藏「对话」按钮**（A）：
  - `LeftSidebar` 的 `RepositoryRow` / `RepositoryConversationAction` 在 multi_repo 项目内的 repo 行不渲染
  - 单仓 / 游离 repo 行不变
- **ClaudeSessions 面板：多仓项目只展示项目主会话**（A，自决策）：
  - 当 active 是 multi_repo 项目时，面板只渲染 `repositoryPath === anchor.path` 的会话
  - 遗留 per-repo session 在 DB 保留，但 UI 默认不渲染（可通过磁盘 jsonl 找回，单独 follow-up 不在本期）
  - 单仓 / 游离 repo 面板渲染规则不变
- **`handleCreateRepositoryTask(repo, ...)` 在 multi_repo 下重路由**（A，自决策）：
  - mode === "chat" / 默认模式：忽略 repo.path，改在 `anchor.path` 上 bind / restore / create 项目主会话；保证「程序化创建」（at-mention dispatch / panel 兜底）也不破坏单会话模型
  - mode === "split"：保持原状（已是项目级 split）
- **启动恢复**（A，自决策）：
  - `lastSessionRepoId` 仍持久化为 repo 维度（供侧栏高亮 + 文件浏览器 focus）
  - 路由层根据 owner project 的 workspaceMode 决定真正打开/恢复的 session：
    - lastSessionRepoId ∈ multi_repo 项目 → 恢复 / 创建 anchor.path 主会话
    - lastSessionRepoId 游离 / ∈ single_repo 项目 → 恢复 / 创建 per-repo session
- **`jumpToSessionWithRepository`（搜索 / 历史抽屉跳会话）**（自决策）：
  - 路径不动；保持现有 `setActiveRepositoryWithOwner` + `switchSession(canonicalId)` 语义
  - 跳会话本身就指向一个具体 sessionId，不再二次创建，故多仓 / 单仓行为一致

## Acceptance Criteria (evolving)

### 路由分支（核心）
- [ ] 多仓 wise_trellis 项目打开时只创建/恢复一个项目主会话（cwd = `anchor.path`），不开 per-repo session
- [ ] 多仓项目内点击 repo 节点：`activeRepositoryId` 切换，文件浏览器跟随；conversation 不变；不创建新 session
- [ ] 单仓项目 / 游离 repo click repo → 仍 per-repo session（无回归）
- [ ] `handleCreateRepositoryTask(repo, "chat")` 在 multi_repo 项目下重路由到项目主会话；mode === "split" 不变
- [ ] 启动恢复：lastSession ∈ multi_repo 项目 → 恢复项目主会话；∈ single_repo / floating → 恢复 per-repo
- [ ] grep 全仓没有为 multi_repo 项目内 repo 新建 per-repo session 的代码路径（除测试 fixture）

### UI 一致性
- [ ] 多仓项目 repo 行不显示「对话」icon；单仓 / 游离 repo 行不变
- [ ] ClaudeSessions 面板在 multi_repo active 时只列项目主会话（`repositoryPath === anchor.path`）
- [ ] 切换到 single_repo / 游离 repo 时面板恢复正常列表
- [ ] 不引入新 UI framework / 新顶层 panel

### @-mention 路由（不回归）
- [ ] 项目主会话内 `@<role-tag>` 仍能路由到目标 repo 的 subagent（at-mention dispatch 链路不动）

### 测试
- [ ] `resolveSidebarSelectionTarget`（或同等纯函数）针对 multi_repo / single_repo / floating / orphan owner 各分支单测
- [ ] 启动恢复分支测试：lastSession ∈ multi_repo / ∈ single_repo / 失效
- [ ] ClaudeSessions 面板过滤纯函数单测

## Decision (ADR-lite)

**Context**:
commit `9c3dea5` 把多仓 wise_trellis 的 split 模式锚到 `project.rootPath`，但「直接对话」入口仍走 per-repo session（`handleSidebarRepositorySelect` → `bindRepositoryMainSession(repo.path, ...)`）。PR3 引入了 `workspaceMode` 抽象但未消费它做路由分叉。

用户产品意图：**多仓项目 = monorepo**，repo 不是 agent，是 subagent 实现位置。直接对话也应该是项目级单一主会话 + @-mention dispatch 调度 repo。

**Decision**:
走 **Approach R（routing helper + 收敛 entry point）**：

1. 新增纯函数 `resolveSidebarSelectionTarget({ repository, ownerProject, repositories, workspaceMode })` → 返回 `{ kind: "project-main" | "per-repo", path, displayName }`
2. `handleSidebarRepositorySelect` 调用该 helper，决定 bind / restore / create 的 cwd
3. 项目卡 click（`handleSelectProject` / `handleProjectSelectLeavingMcpHub`）追加「进项目即开主会话」副作用（与 `handleSidebarRepositorySelect` 路由共用 helper）
4. `handleCreateRepositoryTask` 在 multi_repo 下早期重路由到 helper 结果
5. UI hide rules 直接读 `useWorkspaceMode`（不允许新建隐式判断）

**Consequences**:
- ✅ 零 DB / IPC 改动（schema-neutral）
- ✅ 单一来源：所有"会话路由 cwd"决策由 helper 输出，可纯函数单测
- ✅ workspaceMode 抽象终于被消费，PR3 投资落地
- ✅ 与 at-mention dispatch 链路完全解耦
- ⚠️ 多仓项目用户的 per-repo 历史 session 被隐藏（仍在 DB），少数高级用户可能不满 → 由后续 follow-up 处理（独立 task）
- ⚠️ `handleCreateRepositoryTask` 是 fan-in 函数（panel `onNewSession` / split / at-mention 兜底），需要 case-by-case 验证重路由不破坏调用方语义

## Feasible Approaches

### Approach R — Routing helper + entry-point 收敛（Selected）

见 Decision。把路由决策抽到 `src/utils/sidebarSelectionTarget.ts`（命名待定），所有 entry point 统一消费。

**Pros**: 单一来源、纯函数可测、PR3 抽象终于落地
**Cons**: 涉及 3 个 entry point 的 wiring；UI hide rules 散落 2 处（sidebar / sessions panel）

### Approach P — Project click 创建主会话，repo click 完全无副作用

只在「点项目卡」时创建主会话；repo click 在 multi_repo 下完全 no-op（不切 active, 不开会话）。

**Pros**: 极简
**Cons**: 文件浏览器无法跟随 repo；与「repo 作为导航锚点」直觉冲突；不满足 acceptance「点 repo → 文件浏览器跟随」

### Approach D — DB 层加 `project.directSessionMode` 字段

让每个项目持久化「per-repo vs project-main」首选；启动按字段路由。

**Pros**: 用户可控
**Cons**: 新增字段需 migration；用户实际只需要 monorepo / 非 monorepo 二分（workspaceMode 已能派生）；超工程化

## Implementation Plan (small PRs)

### PR1 — 纯函数 routing helper + 测试
- `src/utils/sidebarSelectionTarget.ts`（new）：`resolveSidebarSelectionTarget` 返回 `{ kind, path, displayName }`
- `src/utils/sidebarSelectionTarget.test.ts`：multi_repo / single_repo / floating / 缺 rootPath / orphan owner 分支
- 单纯派生，不动 React / IPC

### PR2 — 把 helper wire 到 entry point + 启动恢复
- `src/AppImpl.tsx`：`handleSidebarRepositorySelect` 用 helper 决定 cwd；`handleCreateRepositoryTask("chat")` 在 multi_repo 下重路由；startup effect 与 helper 配合
- `src/AppImpl.tsx`：`handleProjectSelectLeavingMcpHub` / `handleSelectProject` 追加「进项目即开主会话」副作用
- 复用 `bindRepositoryMainSession(anchor.path, ...)`
- 单元测试覆盖启动分支（重用 `startupRepoSelection` 输入 + helper）

### PR3 — UI hide rules + 面板过滤
- `src/components/LeftSidebar.tsx`：multi_repo 项目内 repo 行隐藏 `RepositoryConversationAction`
- `src/components/ClaudeSessions/*`（找到面板渲染入口后）：multi_repo active 时过滤会话列表到 `repositoryPath === anchor.path`
- 纯函数过滤 + 测试

## Out of Scope

- 引入新 UI framework / 新会话存储 schema
- 修改 split 模式 / 需求拆分流程（已对齐）
- 改造 at-mention dispatch 链路（已就绪）
- 多仓项目里 per-repo 历史 session 的清理 / 迁移（数据保留，UI 隐藏即可，独立 follow-up）
- 项目内多个主会话并存（本期硬约束「一个项目主会话」，多会话能力另开 task）

## Definition of Done

- 测试覆盖：`resolveSidebarSelectionTarget` 分支单测 + 启动恢复分支单测 + 面板过滤单测
- `bun test` / `bun x tsc --noEmit` 全绿
- 多仓 wise 自身项目端到端：启动 → 项目主会话 → 点 repo 节点不开新 session → `@<role-tag>` 路由不回归 → 切走再回来能 restore
- 游离 repo / 单仓项目端到端：行为完全不变
- 不写文档（除非用户明确要求）

## Technical Notes

### 关键文件
- `src/AppImpl.tsx:1126`-`handleSidebarRepositorySelect` (路由分支入口)
- `src/AppImpl.tsx:1212`-`handleCreateRepositoryTask` (chat / split / 默认模式)
- `src/AppImpl.tsx:1261`-`handleCreateProjectTask` (项目级 chat 已实现但无 UI 触发)
- `src/utils/projectSessionAnchor.ts` (anchor 决策，本期不动)
- `src/utils/workspaceMode.ts` + `useWorkspaceMode` (统一判定)
- `src/components/LeftSidebar.tsx`：repo 行点击 / 项目卡 click 触发位置
- `src/services/atMentionDispatch.ts`：@-mention 路由（不动）

### 约束
- 不动 IPC / DB schema
- 路由判定必须走 `useWorkspaceMode` / `resolveWorkspaceMode`，不允许新增 `repositoryIds.length` 隐式分支
- 多仓项目主会话绑定路径 = `anchor.path` (即 rootPath)，与 `handleCreateProjectTask` 一致
