# 技术设计 — PRD 拆分 Artifact Pipeline

## 1. 系统边界

```
┌─ 用户操作 ──────────────────────────────────────────┐
│  AppWorkspaceLayout → 项目卡片 → 「需求拆分(Trellis)」│
└──────┬─────────────────────────────────────────────┘
       ▼
┌─ src/components/PrdSplitWizard/ (新) ─────────────────────────┐
│  InputStage → ClusterPlanStage → SplitsStage → ReviewStage    │
└──────┬────────────────────────────────────────────────────────┘
       ▼ 调用
┌─ src/services/prdSplit/ (新) ──────────────────────────────────┐
│  clusterPlanner → splitterDispatch → normalizer → trellisWriter│
│                   ↑                  ↑                          │
│                   |                  └ claudeSplitOutputNormalize (复用)
│                   └ buildSplitRequestPayload (复用)             │
└──────┬─────────────────────────────────────────────────────────┘
       ▼ Tauri invoke
┌─ src-tauri/src/claude_commands/prd_split_pipeline.rs (新) ─────┐
│  create_parent_task / dispatch_cluster / materialize_tasks /  │
│  compute_diff                                                  │
│         └ shell out to: python3 .trellis/scripts/task.py ...   │
│         └ persist runs:  ~/.wise/prd-runs/<runId>/ (复用既有)  │
└─ src-tauri/src/prd_materialize.rs (read-only reuse) ──────────┘
       ▼
.trellis/tasks/<父>/  (task.json with repositoryId / clusterId / parent)
       └─ <子>/       (task.json with parent = 父名)
```

**与并行重构隔离**：
- `src/components/PrdTaskSplitPanel/**` 与 `src/hooks/usePrdTaskSplit.ts` 在本任务**写禁区**。
- Stage 4 Review 阶段如要复用旧面板的展示组件（TaskCard 等），通过 import 调用，不修改源文件；适配通过 `PrdSplitWizard/adapters/` 一层包装兜底。

## 2. 数据契约

### 2.1 task.json schema 扩展（向后兼容）

新增字段（缺省 `null`）：

```ts
interface TrellisTaskJson {
  // ...既有字段
  repositoryId: number | null;   // 子任务归属仓库（cross-repo 父任务为 null）
  clusterId: string | null;      // cluster 标识，父任务持有；子任务冗余指向父 clusterId
}
```

落点：
- `.trellis/scripts/common/task_store.py` 读 / 写时把缺失字段补 `null`，已写入的旧任务首次 round-trip 时悄悄补字段。
- `.trellis/scripts/task.py create` 增加 `--repository-id` / `--cluster-id` 可选参数。
- 前端 TS 镜像类型在 `src/types/trellisTask.ts`（新文件，避免污染 `types.ts`）。

### 2.2 requirements-index.json schema v2

```ts
interface RequirementsIndexV2 {
  version: string;       // 整个 index 的稳定 hash（基于排序后 requirements 的 contentHash 串接）
  schemaVersion: 2;      // 区分旧版（旧版无该字段，视为 schemaVersion 1）
  requirements: Array<{
    id: string;
    content: string;
    bodyHash: string;    // 单条 content 的 SHA-256（前 16 字符 hex）
  }>;
}
```

- 旧版读取时 normalizer 自动升级：每条补 `bodyHash`，整体补 `version`，写回时同步落 v2。
- 校验沿用 `requirementsIndexValidate.ts`（增量兼容，不破坏旧 schema）。

### 2.3 Claude splitter 输出 schema（cluster-aware 增量）

在现有 `validateClaudeSplitPayloadStrict` 校验基础上，splitter prompt 要求**额外**字段（非必填，缺失时由 trellisWriter 兜底）：

```ts
interface ClusterAwareSplitTaskExtra {
  clusterId?: string;        // 自报告 cluster（用于跨 cluster 任务定位）
  repoTarget?: number;       // 自报告 repositoryId；缺失则由 trellisWriter 按 cluster 默认仓位填
}
```

现有 `sourceRequirementIds` / `taskAnchors` / `executionStatus` 等硬约束**全部沿用**，不放宽。

### 2.4 ClusterPlan（前端内存结构）

```ts
interface ClusterPlan {
  clusters: Array<{
    id: string;                       // 稳定标识，UUIDv4
    title: string;                    // 用户可编辑
    repositoryIds: number[];          // 一个 cluster 可以覆盖多仓（跨仓任务）
    primaryRepositoryId: number | null; // 默认仓位
    requirementIds: string[];         // requirements-index 中的 id 子集
    dependencyClusterIds: string[];   // 该 cluster 在其他 cluster 完成后才能跑
  }>;
  diagnostics: {
    requirementsCoverage: { covered: string[]; orphan: string[] }; // orphan: 未归类
    crossRepoRequirements: string[];                                // 多仓引用的 req id
  };
}
```

## 3. 服务接口（src/services/prdSplit/）

### 3.1 clusterPlanner.ts

```ts
export interface ClusterPlanInput {
  repositories: Array<{ id: number; name: string; type: "frontend"|"backend"|"document"; path: string }>;
  requirements: RequirementsIndexV2["requirements"];
  // 可选：仓库间已知依赖（如 frontend 依赖 backend），影响 dependencyClusterIds
  knownRepoDependencies?: Array<{ from: number; to: number }>;
  options?: {
    maxRequirementsPerCluster?: number; // 默认 24，超出按依赖切
    forceSingleClusterIfRepoCount?: number; // 默认 1
  };
}

export function planClusters(input: ClusterPlanInput): ClusterPlan;
```

**算法（纯函数，可单测）**：
1. 单仓 → 单 cluster，覆盖全部 requirements。
2. 多仓 → 按 requirement 文本对 repo 名 / 路径片段的匹配度聚类（首版用规则匹配，不调 LLM）。
3. 跨仓 requirement（匹配 ≥2 repo）→ 单独标记，但归到主匹配仓的 cluster（`crossRepoRequirements` 列出）。
4. 超过 `maxRequirementsPerCluster` → 按 requirement id 数字尾切。
5. `dependencyClusterIds` 由 `knownRepoDependencies` 推导（frontend cluster 依赖 backend cluster）。

### 3.2 splitterDispatch.ts

```ts
export interface DispatchClusterInput {
  parentTaskPath: string;           // .trellis/tasks/<父名>
  cluster: ClusterPlan["clusters"][number];
  prdBundle: ClaudeInputBundleFiles; // buildSplitRequestPayload 产物（已切到本 cluster）
  claudeConfig: { command: string; args?: string[]; envSession?: string };
}

export interface DispatchClusterOutput {
  runId: string;
  rawOutput: unknown;               // Claude 原始 JSON
  normalized: SplitResult;          // 经 normalizer 后的结构化结果
  issues: ClaudeSplitStrictValidationIssue[]; // 非空表示部分校验失败
}

export async function dispatchClusterSplit(input: DispatchClusterInput): Promise<DispatchClusterOutput>;
```

- 内部 `invoke("prd_split_dispatch_cluster", ...)`，Tauri 侧持久化 raw 输入输出到 `~/.wise/prd-runs/<runId>/`。
- Tauri 调度 splitter subagent 时 prompt 第一行强制 `Active task: <parentTaskPath>`。
- 出错（subagent 非零退出 / 解析失败）时 `issues` 包含人类可读说明，`normalized.splitTasks = []`。

### 3.3 trellisWriter.ts

```ts
export interface WriteClusterTasksInput {
  parentTaskPath: string;
  cluster: ClusterPlan["clusters"][number];
  normalized: SplitResult;          // 子任务源
  source: PrdDocument;              // 用于回填子任务 prd.md 中 requirements 引用
}

export interface WriteClusterTasksOutput {
  parentTaskPath: string;
  childTaskPaths: string[];         // 已创建 .trellis/tasks/<MM-DD-子>/
  unchangedChildTaskPaths: string[]; // diff 重拆时未变更的子任务
  warnings: string[];
}

export async function writeClusterTasks(input: WriteClusterTasksInput): Promise<WriteClusterTasksOutput>;
```

- 内部 `invoke("prd_split_materialize_tasks", ...)`；Tauri 侧用 `task.py create --parent <parentName> --repository-id <id>` 落子任务。
- 每个子任务 `prd.md` 模板：
  ```
  # <title>

  ## Source requirements
  - <reqId>: <content>

  ## Subtasks / DoD
  ...

  ## Anchors
  textHash: <hash>, range: [from,to]
  ```
- 父任务在 `prd.md` 顶部保留 cluster 元信息块：
  ```
  <!-- cluster: { id, title, repositoryIds, primaryRepositoryId } -->
  ```
- 父任务 `meta.claudeSplitMapping` 写入 `task.json.meta`（不污染 prd.md）。

### 3.4 diffReplay.ts

```ts
export interface DiffReplayInput {
  oldIndex: RequirementsIndexV2;
  newIndex: RequirementsIndexV2;
  existingClusterPlan: ClusterPlan;
}

export interface DiffReplayOutput {
  dirtyClusterIds: string[];
  reasons: Record<string, Array<
    | { kind: "requirement_body_changed"; id: string; oldHash: string; newHash: string }
    | { kind: "requirement_added"; id: string }
    | { kind: "requirement_removed"; id: string }
  >>;
}

export function computeDirtyClusters(input: DiffReplayInput): DiffReplayOutput;
```

**双信号约束**：dirty 必须同时满足
- 至少一条 requirement `bodyHash` 变化 **或** 一条 requirement 增加/删除；**且**
- 该 requirement 在 `existingClusterPlan` 中确实属于某 cluster（不属于的算 orphan，进 ClusterPlan 重审，不直接 dirty）。

## 4. Tauri 命令（src-tauri/src/claude_commands/prd_split_pipeline.rs，新文件）

```rust
#[tauri::command]
pub async fn prd_split_create_parent_task(
    project_id: String,
    cluster_id: String,
    title: String,
    prd_markdown: String,
    requirements_index_json: String,
    repository_ids: Vec<i64>,
) -> Result<CreateParentTaskOutput, String>;

#[tauri::command]
pub async fn prd_split_dispatch_cluster(
    parent_task_path: String,
    cluster_payload: ClusterDispatchPayload,
    claude_command: String,
    claude_args: Vec<String>,
) -> Result<DispatchClusterRawOutput, String>;

#[tauri::command]
pub async fn prd_split_materialize_tasks(
    parent_task_path: String,
    cluster_id: String,
    normalized_split_json: String,
    primary_repository_id: Option<i64>,
) -> Result<MaterializeTasksOutput, String>;

#[tauri::command]
pub async fn prd_split_compute_diff(
    parent_task_path: String,
    new_index_json: String,
) -> Result<DiffReplayJsonOutput, String>;
```

- 所有命令最终 shell out 到 `python3 .trellis/scripts/task.py ...`（保持 task.py 是唯一写入口）。
- `prd_split_dispatch_cluster` 持久化 dispatch payload 到 `~/.wise/prd-runs/<runId>/` 与既有 `prd_materialize.rs` 共享目录约定。
- 在 `lib_impl.rs` 注册命令，`capabilities/default.json` 加 allow 列表。

## 5. Trellis Subagent: trellis-splitter

新增三平台配置（**只放新文件，不改既有 agent 配置**）：

- `.claude/agents/trellis-splitter.md`
- `.cursor/agents/trellis-splitter.md`
- `.codex/agents/trellis-splitter.toml`

prompt 模板核心约束：
- 第一行 `Active task: <parentTaskPath>`。
- 输入：`prd.md` + `requirements-index.json` + `cluster.json`（cluster 元数据） + `OUTPUT_SCHEMA.json`。
- 输出：JSON 对象 `{ tasks: [...], claudeSplitMapping: {...} }`，每个 task 必带 `sourceRequirementIds` / `taskAnchors`；可带 `clusterId` / `repoTarget`。
- 拒绝臆造：requirementIds 必须来自输入；锚点 `textHash` 必须来自原文。

## 6. UI 设计（src/components/PrdSplitWizard/）

文件结构：

```
src/components/PrdSplitWizard/
├── index.tsx              # 向导外壳（Stepper + 状态机）
├── types.ts               # 向导状态机类型
├── useSplitWizardState.ts # 状态机 hook
├── stages/
│   ├── InputStage.tsx
│   ├── ClusterPlanStage.tsx
│   ├── SplitsStage.tsx
│   └── ReviewStage.tsx
├── parts/
│   ├── ClusterCard.tsx
│   ├── ClusterRequirementChips.tsx
│   ├── DispatchProgress.tsx
│   └── TrellisWriteCta.tsx
└── adapters/
    └── reviewAdapters.ts  # 把旧 TaskCard 等 import 包一层，隔离签名变化
```

状态机（XState 风格用 reducer 实现）：
```
idle → input(PrdDocument) → planCluster(ClusterPlan)
       → dispatch(perClusterRun: Map<clusterId, DispatchState>)
       → review(allClusterResults)
       → writing → done
                 ↘ error → 回到对应 stage
```

阶段间数据通过 wizard ctx 流动，向导内部不持久化（关闭即丢；写入 Trellis 才落盘）。

挂载入口：
- `src/components/AppWorkspaceLayout.tsx` 增加一处 lazy import + 触发按钮（项目卡片或主操作栏），与既有 `PrdTaskSplitPanel` 入口并列；按钮文案 `需求拆分(Trellis)`。

## 7. 用例数据流

```
1. 用户在 InputStage 粘贴 PRD → state.prdDocument
2. 用户选 repos → planClusters() → state.clusterPlan
3. ClusterPlanStage 允许编辑 → state.clusterPlan (mutated)
4. SplitsStage 点 "派发所有 cluster":
   for each cluster (Promise.all):
     a. invoke prd_split_create_parent_task → parentTaskPath
     b. buildSplitRequestPayload(prd 切片, cluster context) → bundle
     c. invoke prd_split_dispatch_cluster → rawOutput
     d. normalizeClaudeSplitOutputToSplitResult → normalized
     e. state.runs[clusterId] = { parentTaskPath, normalized, issues }
5. ReviewStage 渲染:
   - 顶部：cluster tabs
   - 主体：树形 task list (复用 TaskCard adapter)
   - 锚点高亮：把 normalized.taskAnchorDescriptors 渲染到 PRD 文本
6. 用户点 "Write to Trellis":
   for each cluster:
     invoke prd_split_materialize_tasks → childTaskPaths
   state.writtenPaths → done
```

## 8. 兼容性与回滚

- Feature flag：项目设置中加 `enableTrellisSplit: boolean`（默认 false），仅 `true` 时显示新入口；旧入口始终保留。
- 数据回滚：写入 `.trellis/tasks/` 后 git 可见，回滚靠 `task.py archive <name>` 或 `git revert`。
- 旧 `prd-runs/` 行为不动，新管线**额外**写 `prd-runs/<runId>/`（沿用 `prd_materialize.rs`），不替换。

## 9. 与并行重构的协作

GPT 改 `PrdTaskSplitPanel/**` 期间：
- 本任务的代码与测试**不 import** PrdTaskSplitPanel 的内部模块，除非通过 `PrdSplitWizard/adapters/` 一层。
- 若 Stage 4 之前 GPT 重构未完成：Review 阶段先用最小自渲染（不复用 TaskCard），先把链路打通；TaskCard 复用作为 polish 项。
- 协同点：commit hygiene 上各自分流（本任务的 commit 不包含 `PrdTaskSplitPanel/` 路径变更）。

## 10. 开放问题决议

| 问题 | 决议 |
|---|---|
| splitter prompt 用 PRD 全文还是 cluster 切片？ | **cluster 切片 + cluster 元数据**。切片由 `buildSplitRequestPayload` 的 `prdBodyMaxChars` 控制；超长 cluster 二切并按依赖排序 |
| 跨 cluster 任务依赖如何持久化？ | 子任务 `dependencies` 允许跨父任务引用（用 `MM-DD-name` 全名）；trellisWriter 写入时校验目标存在 |
| 旧 `prd-runs/` 数据是否迁移？ | 不迁移，保留作审计材料；新管线**额外**写 `prd-runs/<runId>/` 同样格式，便于联表分析 |
| Splitter subagent 跨平台一致性 | 三平台共用同一 prompt 模板内容，仅外壳格式（md vs toml）不同；测试用 Claude 平台做主验证 |
