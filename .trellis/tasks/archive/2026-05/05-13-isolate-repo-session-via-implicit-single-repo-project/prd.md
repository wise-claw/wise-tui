# Isolate Repo Session via Implicit Single-Repo Project

## Goal

让 wise 在数据模型与 UX 层支持"打开仓库"和"打开项目"两种入口的语义隔离。当用户只关联单个独立仓库时，UI 完全不暴露 "project" 概念；只有用户主动组合多 repo（wise_trellis 项目）或显式建项目时，project 概念才出现。

同时显式引入 `workspaceMode: "single_repo" | "multi_repo"` 抽象作为下游 UI / Trellis bridge / startup effect 的统一判断依据，避免后续模块靠 `project.repositoryIds.length` / `rootPath === repo.path` / `activeProjectId == null` 等隐式推断分叉。

这是把 wise 改造成 trellis 多模式 harness 的 **M0 地基**。后续 M1（Trellis Bridge：探测+读取+bootstrap+watch+IPC）、M1.5（Bootstrap Context Generation：多 repo researcher 编排）、M2（spec 可视化）、M3（workflow 可视化）、M4（闭环演示）都依赖此隔离与 `workspaceMode` 抽象的稳定。

## What I already know

### 当前数据模型
- `types.ts:56-71` `ProjectItem` 含 `repositoryIds[]` / `rootPath` / `ProjectSddMode = "wise_trellis" | "project_owned"`
- DB schema（`migrations/003_projects_and_settings.sql`）：`project_repositories` 是 **M:N 关联表**，`projects` 和 `repositories` 独立存在；**DB 层允许 repo 不属于任何 project**
- 后续 migration 给 `projects` 加了 `root_path` / `sdd_mode` / `main_agent` / `icon_*` 字段

### 当前 UX 强制 project-first
- "Add Repository" 入口（`LeftSidebar.tsx:1141-1158` `submitAddRepository`）必须传 `pendingAddRepositoryProjectId`，无 project 不让加 repo
- 启动 effect（`AppImpl.tsx:1184-1199`）依赖 `firstProject → firstRepoId`，无 project 完全不会启动会话
- `handleCreateRepositoryTask:1230-1232` 会找 owner project 并 setActive；找不到时只 setActiveRepositoryId（已为游离 repo 留了 fallback）

### 会话锚定已经隔离
- 仓库会话（`handleSidebarRepositorySelect:1165` / `handleCreateRepositoryTask:1238,1248`）：cwd = `repository.path`，**不读 project**
- 项目会话（`handleCreateProjectTask:1259`）：调 `resolveProjectMainSessionAnchor` 决定锚到 root 或 firstRepo
- `projectSessionAnchor.ts` 对单 repo project 天然退化到 repo path（行 60-66）

## Assumptions

- 多 repo `wise_trellis` project（commit 9c3dea5 的锚定行为）零改动
- 删除游离 repo 时 `.trellis/` 文件不被 wise 删除（trellis 自管）
- 现有 wise 自身项目（多 repo + rootPath 已配置）端到端体验不变
- 一个 repo 加入 project 后自动从游离区出栈（M:N 在数据层保留但 UI 不暴露共存）

## Open Questions

无 blocking question。具体 UI 摆放（顶部按钮位置、empty state 文案）在实现期由 designer 判断。

## Requirements

### workspaceMode 抽象（M0.5 合并进来）
- 显式引入派生状态 `workspaceMode: "single_repo" | "multi_repo"`，作为下游统一判断依据
- 派生规则：
  - `single_repo`：当前 active 是游离 repo，或所属 project `repositoryIds.length === 1` 且无 rootPath
  - `multi_repo`：当前 active 是 project 且 `repositoryIds.length >= 2`，或 project 已配置 rootPath
- 暴露为 hook（如 `useWorkspaceMode`）供 UI / bridge / startup effect 消费
- 禁止下游模块再用 `project.repositoryIds.length` 等隐式条件分叉

### 数据层
- 利用 DB 已有 M:N 关联，允许 repo 与 0 个 project 关联
- 新增（或复用）IPC `list_floating_repositories()`：返回不属于任何 project 的 repo 列表
- 加入 project 时若 repo 之前是游离态，UI 自动出栈；M:N 共存数据上允许但 UI 不渲染共存

### UX 层
- 侧栏顶层渲染两类节点：**游离 repo（平铺）** + **显式 project 卡**
- 顶层新增"添加游离仓库"入口（具体位置实现期决定，建议侧栏顶部 + 号或空状态引导）
- 现有的"项目内关联仓库"入口保留，作为往已有 project 加 repo 的路径
- 游离 repo 节点提供菜单：**升格为新项目**（创建 project + 加入）/ **加入现有项目**

### 会话与启动
- 仓库会话锚点稳定：游离 / project 内 repo 一律 cwd = `repo.path`
- 多 repo `wise_trellis` project：锚点保持 `resolveProjectMainSessionAnchor` 现行逻辑
- 启动 effect 修改：上次会话 repo 存在 → 恢复；否则按侧栏顺序选首项（游离区优先 / project 内首个，与侧栏渲染顺序一致）
- 启动恢复路径需处理"上次会话所在 repo 已删除"的清理

### 兼容性
- 现存 1-repo `wise_trellis` project：**不自动迁移**，保持 UI 上的 project 外框（接受短期 UI 形态割裂）
- `handleCreateRepositoryTask` / `handleSidebarRepositorySelect` 在 owner project=null 时清空 `activeProjectId`，避免 stale 状态污染右侧面板

## Acceptance Criteria

### workspaceMode 抽象
- [ ] 派生 hook `useWorkspaceMode` 返回 `"single_repo" | "multi_repo"`，无 ambiguity
- [ ] 游离 repo 选中时 → `single_repo`
- [ ] 单 repo project（无 rootPath）选中时 → `single_repo`
- [ ] 多 repo project / 已配置 rootPath 的 project 选中时 → `multi_repo`
- [ ] grep 全仓确认没有新增 `project.repositoryIds.length` / `rootPath === repo.path` 等隐式判断（旧代码可保留，新增禁止）

### 游离 repo 生命周期
- [ ] 在初始空状态下点"添加游离仓库"，选择目录后侧栏顶层立刻显示该 repo
- [ ] 单击游离 repo 节点 → 自动创建/恢复主会话，cwd = `repo.path`
- [ ] 删除游离 repo → 侧栏立即移除，DB 记录清理；trellis 文件保留
- [ ] 游离 repo 不显示任何 project 标签 / 外框 / breadcrumb

### 升格
- [ ] 游离 repo 菜单选"升格为新项目"→ 弹出建项目对话框 → 确认后 repo 出栈游离区，进入新 project 卡
- [ ] 游离 repo 菜单选"加入现有项目"→ 弹出 project 选择 → 确认后 repo 出栈游离区，进入目标 project 卡

### 多 repo wise_trellis 项目（回归）
- [ ] 现有 wise 自身项目打开 → 侧栏正常显示 project 卡 + 多 repo 列表（无回归）
- [ ] 项目主会话创建：`handleCreateProjectTask` 锚到 `project.rootPath`，行为同 commit 9c3dea5
- [ ] split 模式生成的 prompt 包含正确 `repoPath`

### 启动
- [ ] 启动时如有 lastSessionRepoId 且存在 → 恢复该会话
- [ ] 启动时如无有效 lastSession → 选侧栏首项（游离 repo 优先于 project，按渲染顺序）
- [ ] 启动时 DB 中 lastSession 引用的 repo 已删除 → 清理 lastSession，回退到首项策略

### 测试覆盖
- [ ] `projectSessionAnchor.test.ts` 新增游离 repo 场景（project=null）
- [ ] 新增 `floatingRepoLifecycle.test.ts`：添加 → 升格 → 加入现有 project → 删除
- [ ] 新增启动 effect 分支测试（恢复 / 选首 / 清理失效 lastSession）
- [ ] `useRepositoryList` 测试：游离 repo + project 内 repo 同时存在的列表展开

## Definition of Done

- Tests added for chosen approach (anchor + lifecycle)
- `bun test` / typecheck / lint green
- 现有 wise 项目端到端验证（打开 → 主会话 → split → 关闭）
- 单独仓库端到端验证（添加 → 自动选中 → 主会话 → 删除 → 清理）
- 不写文档（按规则，除非用户明确要求）

## Out of Scope (explicit)

- M1 trellis 读取服务（独立 task）
- M2 spec 可视化（独立 task）
- M3 workflow 可视化（独立 task）
- 编辑 trellis spec / task 内容
- 隐式 → 显式 project 的专门 UI 入口（如有，通过加第二个 repo 自然过渡，本期不做）
- 删除仓库时同时清理 `.trellis/` 文件

## Decision (ADR-lite)

**Context**: wise 的 DB 层（migration 003）已经把 `project_repositories` 设计为 M:N 关联表，repo 在数据层早就允许不属于任何 project；但 UX 层把 add repository 强绑在 project 卡的"+"按钮里，启动 effect 也依赖 `firstProject`。这造成单仓库用户必须先理解 project 概念才能开始干活。

**Decision**: 走 **Approach X（游离 repo）**。利用 DB 已有能力，UX 层新增"添加游离仓库"顶层入口；侧栏顶层渲染两类节点（游离 repo 平铺 + project 卡）；启动 effect 改为 `firstProject?.firstRepoId ?? firstFloatingRepoId`。不引入"隐式 project"概念，避免与已有 M:N 能力重复抽象。

**Consequences**:
- ✅ 零 DB schema 改动，无迁移成本
- ✅ 数据语义和 UI 显示一致："游离 = 游离"，无隐形状态
- ✅ 与 commit 9c3dea5 的 project rooting 完全解耦，互不干扰
- ⚠️ `useRepositoryList` 等 hook 需新增"游离 repo 列表"概念
- ⚠️ 下游消费 `activeProjectId` 的代码需处理 null 分支
- ⚠️ 侧栏 UI 需支持两种顶层节点类型，渲染逻辑稍复杂

## Feasible Approaches

> ✅ **已选定 Approach X**，见 Decision (ADR-lite)。B1 / B2 保留作为决策上下文。

### Approach X: 游离 repo（无 project 关联） — Selected

**How it works**:
- 利用 DB 已有的 M:N 关联，允许 repo `project_repositories` 为 0 关联
- "Add Repository" UX 拆出顶层入口（不挂 project）；现有的"在 project 内关联"入口保留作为多仓项目用
- 侧栏顶层渲染两类：游离 repo 平铺 + 显式 project 卡（带 repo 列表）
- 启动 effect: `firstProject?.firstRepoId ?? firstFloatingRepoId`
- 删除游离 repo → 直接删 `repositories` 记录，无 project 联动

**Pros**:
- 零 DB schema 改动（M:N 已支持）
- 语义直观："游离 repo 就是游离 repo"，UI 显示与数据一致
- 与 commit 9c3dea5 的 project rooting 完全解耦
- 改动面集中在 UI（侧栏、添加入口）+ 启动 effect

**Cons**:
- 侧栏需要支持两种顶层节点类型（游离 repo / project 卡）
- `useRepositoryList` 等 hook 需要新增"游离 repo 列表"概念
- 不存在 project 上下文时，`activeProjectId` 可能为 null，下游消费方需检查

### Approach B1: 隐式 project + DB 标记字段

**How it works**:
- `projects` 新增 `is_implicit BOOLEAN DEFAULT FALSE`（migration 008 或类似）
- 添加单仓库时自动创建隐式 project（name = repo 名，is_implicit=true）
- 加第二个 repo 进隐式 project 时自动翻转为 false（升格为显式）
- 删除最后一个 repo 时级联删除隐式 project
- 侧栏在 `is_implicit=true` 时只显示 repo，不显示 project 外框

**Pros**:
- 数据模型保持"所有 repo 都有 owner project"的不变式
- 现有依赖 `activeProjectId` 的代码改动小
- 隐式/显式状态明确，可在 UI 显示"升格"提示

**Cons**:
- 需要 DB migration + 新字段
- 升降格的边界条件多（删 repo、移 repo、改名、加 rootPath）
- 多了一层"隐式"概念，与 DB 已有的"M:N 0 关联"能力重复

### Approach B2: 隐式 project + 启发式判断

**How it works**:
- 与 B1 类似但不加 DB 字段，靠 "repos.length === 1 && !rootPath && name === repo.name" 启发式判断
- UI 在满足启发式时隐藏 project 外框

**Pros**:
- 零 DB 改动

**Cons**:
- 启发式不稳定：用户改 project 名后判断失效；rootPath 空也可能是显式 project 故意不填
- 与"显式但只有一个 repo"的项目无法区分
- 不推荐

## Decision (ADR-lite)

待 Q1 确认后填入。

## Technical Notes

### 关键文件
- `src/types.ts:56-71` `ProjectItem`
- `src/AppImpl.tsx:1184-1199` 启动 effect
- `src/AppImpl.tsx:1229-1257` `handleCreateRepositoryTask`
- `src/AppImpl.tsx:1259-1290` `handleCreateProjectTask`
- `src/utils/projectSessionAnchor.ts` anchor 决策
- `src/components/LeftSidebar.tsx:1141-1158` add repository UX 入口
- `src/hooks/useRepositoryList.ts` 仓库列表 hook
- `src/services/projectState.ts` project IPC 客户端
- `src/services/repository.ts:33` `create_repository_from_path`（已支持独立创建）
- `src-tauri/migrations/003_projects_and_settings.sql` projects + project_repositories 表
- `src-tauri/src/wise_db.rs` project / repository 持久化逻辑

### 约束
- `bun.lock` 为唯一锁文件
- 不引入新 UI framework（Ant Design 默认，Semi 限定 ClaudeChatInput）
- 不调用 `invoke` from components（走 `src/services/*`）
- 按 CLAUDE.md：组件不直接 `invoke`，纯逻辑放 hook/services
