# P5 · 命名收口：项目→Workspace、游离仓库→Standalone Repo

## 1. 背景

当前代码 / 文档 / UI 文案存在两套语言：

- **后端 / 内部代码**：`projects` / `floatingRepositories`
- **UI 文案 / 用户引导**：「项目」/「游离仓库」

宪法（`.trellis/spec/guides/agent-harness-architecture.md` §6）规定的产品语言是：

| 旧名 | 新名 |
|---|---|
| 项目 | Workspace |
| 游离仓库 | Standalone Repo |

**症状**：

1. 新用户问"我应该建项目还是游离仓库？" —— 心智模型不清晰
2. 代码里到处 `floatingRepository` 特例分支，外人看不懂这个词的产品含义
3. 这两类用户的能力差异（Workspace 走 Trellis + Mission Control；Standalone Repo 只跑 Chat）没有名字承载

## 2. 前置条件

- 不强依赖任何 P 级任务（可与 P0/P1/P3 并行做）
- 但**强烈建议在 P3 合并后做**，因为 AuthorPanel 的 WorkspacesTab 是统一这两类入口的最佳场所

## 3. 目标

把"Workspace / Standalone Repo"作为产品的唯一语言，逐步收敛代码 / 文档 / UI 文案。**不破坏存量数据**。

## 4. 范围

### 必做

#### 4.1 类型层 alias

新增类型 alias，**不删旧类型**：

```ts
// src/types.ts 或新文件 src/types/workspace.ts
export type Workspace = ProjectItem;            // alias
export type StandaloneRepo = Repository;        // alias，仅当 projectId 为空时语义为 standalone
```

新代码使用 `Workspace` / `StandaloneRepo`，旧代码暂留 `ProjectItem` / 没限定的 `Repository`。

#### 4.2 服务层 alias

```ts
// src/hooks/useRepositoryList.ts
const { floatingRepositories, ...rest } = useRepositoryList();
// 加入 alias:
const standaloneRepos = floatingRepositories;
```

新写的 hook / service / component 用 `standaloneRepos`。

#### 4.3 UI 文案统一

侧栏、Modal、提示词、错误信息、引导文案中：

| 旧文案 | 新文案 |
|---|---|
| 「项目」 | 「Workspace」（or 「工作区」如果坚持中文，两者择一在 design.md 决定） |
| 「游离仓库」/「游离 repo」 | 「Standalone Repo」（or 「独立仓库」） |
| 「升格为新项目」 | 「升格为 Workspace」 |
| 「关联到当前项目」 | 「加入 Workspace」 |
| 「项目根目录」 | 「Workspace 根目录」 |

**design.md 必须先和用户确认中英混用策略**（用 Workspace 英文还是「工作区」中文？）。本 PRD 不做选择。

#### 4.4 产品规则落到代码

宪法 §6 的两条规则：

1. **Standalone Repo 不进 Mission Control / Author 域 / Workflow Studio**：仅暴露 Chat + Git + 文件编辑 + 代码图谱
2. **Standalone Repo "升格为 Workspace"**：保持现有 `handlePromoteFloatingRepositoryToProject` 行为，文案改名

UI 上：

- LeftSidebar 选中 Standalone Repo 时，AuthorPanel 入口禁用并 tooltip "Standalone Repo 不支持 Author 配置；升格为 Workspace 后启用"
- Cockpit 入口（P1 完成后）对 Standalone Repo 隐藏

#### 4.5 文档同步

- 更新 `README.md` / `CLAUDE.md` / `.trellis/spec/*` 中所有出现 "项目" / "游离仓库" / "floating" 的地方为新名（保留一次旧名作为 alias 提示，例如 "Workspace（项目）"）
- 宪法文件本身已用 Workspace 名词，无需改动

### 不做

- **不改数据库 / migration**：`projects` 表名保留，不要为了改名做 schema 迁移
- **不改 Tauri 命令名**：`mission_*` / `prd_split_*` 等保留原名
- **不改 `repositories.json` 文件结构**
- **不强行一次性消除所有 floatingRepository**：只让新代码用 alias；旧代码保留，长期清理

## 5. 验收标准

### 类型

- [ ] `src/types.ts` 或 `src/types/workspace.ts` 暴露 `Workspace` / `StandaloneRepo` alias
- [ ] 新代码（本任务以后）至少有 5 处用了新 alias
- [ ] `bunx tsc --noEmit` 通过

### UI

- [ ] LeftSidebar 中"项目" / "游离仓库" 文案统一切到新名（按 design.md 决定的中英方案）
- [ ] AuthorPanel WorkspacesTab 标题、空态文案使用新名
- [ ] 错误提示 / 确认框 / 引导提示统一新名
- [ ] Standalone Repo 状态下 AuthorPanel 入口禁用 + tooltip

### 文档

- [ ] README.md / CLAUDE.md 全文搜索"游离仓库" / "项目（指 ProjectItem 时）" 已替换或加 alias 说明
- [ ] `.trellis/spec/frontend/index.md`、`.trellis/spec/guides/index.md` 中相关条目同步

### 工程

- [ ] `bun test` 通过
- [ ] `gitnexus_detect_changes` 显示影响面集中在 LeftSidebar / AuthorPanel / 文档；无意外触碰 Mission/Trellis 逻辑

## 6. 给 GPT 的话

- 这是**长尾收尾**任务，不要尝试一次性 sed-replace 整个仓库
- 难点是中英文文案策略：开工前先在 design.md 写一份"全部中文 / 全部英文 / 混用三种方案对比"，让用户选
- 不要动 SQL / migration / 后端 Rust 命令名
- 提交前 grep 验证：`grep -r '游离仓库' --include='*.tsx' --include='*.ts' --include='*.md'` 应该只剩 alias 注释
