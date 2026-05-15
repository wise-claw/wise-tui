# 设计：统一项目根、无日常加仓入口、重新初始化

本文档落实 `prd.md` 中的方向，并与当前 Wise 实现对齐，供实现与验收拆分使用。

---

## 1. 范围与边界

| 主题 | 边界 |
|------|------|
| 项目根 `rootPath` | SQLite `projects.root_path` ↔ 前端 `ProjectItem.rootPath`；语义为**磁盘上的工作区根**（可含 `.trellis/`，不要求根本身是 git 目录）。 |
| 成员仓库 | `project_repositories` 表 + `ProjectItem.repositoryIds`；全局仓库列表在 `repositories.json`（经 `load_repositories` / `create_repository_from_path` 维护）。 |
| 工作流图谱 | 存于 **应用 DB**（`get_workflow_graph` / `save_workflow_graph`，见 `src-tauri/.../workflow_graph_commands.rs`），**不是**项目根下单独文件。 |
| 项目层 spec | 产品语境下优先指 **`{rootPath}/.trellis/spec/`** 下由用户维护的 Markdown 树；与 DB 内工作流定义分离。 |

**不在本文档解决的细节**：按钮最终中文文案、进度条 UX、与 Trellis CLI 的二次集成。

---

## 2. 路径归属判定（硬性拦截）

**目标**：给定项目 `rootPath`（规范化后 `R`）与候选仓库路径 `P`，当且仅当 `P` 在 `R` 的目录树下才合法。

**建议规则**（实现须在前后端共用同一套规范化逻辑，或**仅后端裁决** + 前端展示错误）：

1. 使用平台路径规范化（解析 `.`、`..`、绝对化；macOS 上可考虑 **realpath** 与符号链接策略——在 `implement.md` 里二选一并写测例）。
2. 判定：`P === R` 或 `P` 为 `R` 的真子路径（常见实现：`P` 以 `R + 主分隔符` 为前缀，且避免 `/foo` 匹配 `/foobar`）。
3. **违背状态**：任一 `repositoryIds` 对应 `path` 不满足上述关系 → 触发 PRD 所述硬性拦截；**重新初始化**可在用户确认后尝试修复（见 §6）。

---

## 3. 根下新仓库的发现与绑定（替代「日常加仓」）

**场景**：用户已在 `{rootPath}` 下 `git clone` 新目录，但 Wise 尚未有 `Repository` 行、也未挂到 `project_repositories`。

**推荐算法（扫描）**：

1. 以 `R = normalize(rootPath)` 为根，**受限深度**地遍历子目录（需上限防止扫盘过慢，具体深度/忽略目录如 `node_modules`、`target` 在实现中配置）。
2. 对每个含 `.git` 的目录（或 `git rev-parse` 判定为 git 工作区），得到候选路径 `P`。
3. 若 `P` 不满足 §2 归属 → **跳过**（不应入库）。
4. 若全局 `repositories` 中已有 `path === P`（或规范化后相等）→ 若尚未在该 `projectId` 的 `repositoryIds` 中，则仅调用 **`add_repository_to_project`**（内部路径，无单独产品「加仓」弹窗）。
5. 若无对应 `Repository` → **`create_repository_from_path`**（类型默认 `frontend` 或与现有「从路径创建」一致）→ 再 **`add_repository_to_project`**。

**注意**：当前 `handleAddRepositoryToProject`（`useRepositoryList.ts`）是「弹文件夹 + 挂项目」合一；收敛产品入口后，上述逻辑应主要由 **「重新初始化」** 或 **启动时可选同步** 调用，而不是侧栏菜单。

**可选补充**（非 PRD 强制）：在「切换进项目」或「聚焦项目根」时做一次轻量增量扫描；若做，必须在 `implement.md` 写明防抖与性能，避免大 monorepo 卡死。

---

## 4. 移除 / 隐藏的 UI 与调用链（审计清单）

以下为实现阶段应核对并收敛的「向已建项目加仓」主路径（与 PRD「无日常加仓入口」一致）：

| 区域 | 线索 |
|------|------|
| 侧栏项目下「添加仓库」 | `ProjectRepositoryList.tsx`：`add-repo` 菜单项、`onAddRepositoryToProjectClick` |
| 关联仓库弹窗 | `RepositoryAssociateModal` + `useRepositoryAssociateModalController` → `onAddRepositoryToProject` |
| 跨项目拖放 | `repositoryRows.tsx` / `ProjectRepositoryList`：`onMoveRepositoryToProject` 从游离区拖入项目 |
| App 壳传参 | `AppImpl.tsx`：`handleAddRepositoryToProject`、`handleMoveRepositoryToProject` 等仍可由内部命令复用，但**不应**再暴露为默认用户路径 |

**保留讨论**：「移出项目」「删除仓库」是否与「仅从 Wise 列表拿掉但保留磁盘」区分——当前 `handleDetachRepositoryFromProject` 会 **全局 removeRepository**；若 PRD 期望「只解除项目绑定」，需单独立项，不在本任务默认改行为。

---

## 5. 「重新初始化当前项目」行为规格

### 5.1 触发

- 显式按钮或菜单项（建议放在**项目设置 / 项目卡片菜单**等低频区），带二次确认（说明会更新哪些派生物）。

### 5.2 **保留**（白名单 — 默认不得删除或覆盖）

以下在实现中**默认只读、不写**（除非 PRD 后续明确扩展）：

| 类别 | 路径或数据 |
|------|------------|
| 项目层 spec | `{rootPath}/.trellis/spec/**` 下已有文件内容 |
| Trellis 任务与脚本（建议保留） | `{rootPath}/.trellis/tasks/**`、`.trellis/scripts/**`（避免丢任务上下文） |
| 用户工作区 | `rootPath` 下非 Wise 托管的任意用户代码与 `.git` |

**明确不视为「spec 保留」约束的**：SQLite 里的工作流图、运行态缓存等（见下节）。

### 5.3 **允许更新 / 重新生成**（灰名单 — 需在确认文案中列举）

实现前与产品对一下最终列表；当前 PRD 已点名的包括：

| 类别 | 说明 |
|------|------|
| 工作流图谱 | 对「绑定到本项目的工作流」执行**重新生成或刷新**：例如基于当前 `employees` 与模板规则**重建画布拓扑**、或清除仅与旧成员仓相关的无效节点引用。具体算法依赖现有 `WorkflowConfigModal` / `saveWorkflowGraph` 能力；若「重建」定义为**覆盖 DB 中该 workflow 的 graph**，须在确认框写明。 |
| 项目 ↔ 仓库绑定 | 执行 §3 扫描，将新仓纳入 `repositoryIds`。 |
| 派生索引（若有） | 如存在「按仓库列表构建的缓存」，可一并失效重算（在实现中枚举）。 |

### 5.4 **禁止**（黑名单）

- 删除或截断 `{rootPath}/.trellis/spec/` 下已有文件作为默认行为。
- 无确认地删除 `wise.db` 中无关表的全库操作。

### 5.5 实现形态建议

- **方案 A（推荐）**：新增 Tauri 命令 `reconcile_project_workspace`（名称待定），入参 `projectId`，在 Rust 内完成：校验 `rootPath` → 扫描磁盘 → 更新 `repositories.json` 与 `project_repositories` → 返回新 `ProjectItem` 与变更摘要；图谱重建可同命令内顺序调用或拆子命令。
- **方案 B**：前端编排多次 `invoke`（扫描在 JS 不可行目录遍历则用 Rust）。 monorepo 大时优先 A。

---

## 6. 与现有会话锚点逻辑的关系

`resolveProjectMainSessionAnchor`（`src/utils/projectSessionAnchor.ts`）在 **wise_trellis + 多仓 + 非空 rootPath** 时将主会话锚到**项目根**。统一根与成员齐全后，该行为与 PRD 一致。

重新初始化后应刷新：`projects`、`repositories`、依赖 `activeRepositoryId` 的面板，避免侧栏与锚点 stale。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 扫描误把无关目录当 git 仓 | `.git` 检测 + 忽略列表 + 深度上限 |
| 图谱重建覆盖用户精心排版的画布 | 确认框 + 可选「仅登记新仓、不重建图谱」子选项（若产品同意） |
| 路径规范化不一致 | 核心判定单一实现（Rust 优先）、加集成测 |

回滚：实现前对 `wise.db` / `repositories.json` 的变更保持事务性或可逆日志（若已有备份策略则对齐）。

---

## 8. 验收映射（供 `implement.md` 拆解）

1. **路径**：根外路径不得写入 `project_repositories`（后端拒绝或前端预检，至少一端硬失败）。
2. **发现**：在 fixture 根下新增含 `.git` 的子目录后执行重新初始化 → `repositoryIds` 增加且全局列表存在对应 `Repository`。
3. **spec**：重新初始化前后对 `.trellis/spec/` 抽样文件做 hash 或 mtime+size 一致（或内容 diff 为空）。
4. **图谱**：对选定 `workflowId` 执行前后 `get_workflow_graph` 对比符合「重建」预期（由测试固定模板与种子数据）。

---

## 9. 与 `prd.md` 的同步说明

- 「无加仓入口」≠ 禁止调用 `add_repository_to_project`：**内部命令**（重新初始化、合规扫描）仍可使用。
- `prd.md` 中 Open questions 所指的「发现与绑定模型」已由 §3、§5 收敛；若实现阶段发现与「移出项目」行为冲突，单开子任务修订 `detach` 语义。

---

## Changelog

- 2026-05-14：初稿，对齐当前 `useRepositoryList`、`workflowGraphs`、侧栏加仓入口线索。
