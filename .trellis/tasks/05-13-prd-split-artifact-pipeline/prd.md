# PRD 拆分 Artifact Pipeline（多仓 Trellis 任务化）

## 1. 背景

当前 PRD 拆分链路：
- 前端 `src/components/PrdTaskSplitPanel/index.tsx` 4057 行（已从 4706 降下来），22 个子组件。
- 服务层 `buildSplitRequestPayload` 装配 `prd.md / requirements-index.json / repo-context.json` 输入包。
- 拆分由用户在面板内触发 Claude 实例，输出经 `claudeSplitOutputNormalize.validateClaudeSplitPayloadStrict` 强校验后归一为 `SplitResult`。
- 结果持久化在 `~/.wise/prd-runs/<runId>/`，与 `wise.db` 中的 `prd_executable_tasks` 表。
- `SplitResult` 已带一等公民溯源：`sourceRequirementIds`、`taskAnchors`、`claudeSplitMapping`、`taskAnchorDescriptors/Texts/Positions`。

问题：
- 多仓项目（rootPath 下挂多个 repo）没有 cluster 维度——所有任务挤在一个 `SplitResult`，roleType 靠 `repositoryType` 单值 fallback。
- 主会话与拆分混在同一上下文，长会话上下文膨胀；现有 `usePrdTaskSplit` 的 `splitPrdToTasks` 内置规则已移除，拆分实际靠面板内的 Claude 触发，缺乏调度边界。
- 拆分结果不进 `.trellis/tasks/`，与 implement / check 主流程脱节，自动化（diff 重拆、子代理派发）无法接入。
- roleType 完全交给 LLM 猜，跨仓任务的归属不稳定。

## 2. 目标

把 PRD 拆分改造成一条**短命 artifact pipeline**：

1. 主会话只做项目级编排；拆分由短命 `trellis-splitter` subagent 执行，每个 cluster 一次调度。
2. 拆分产物经本地 normalizer 校验后**直接落盘**到 `.trellis/tasks/<MM-DD-name>/`，父子图显式，与 implement/check 主流程贯通。
3. roleType 双层：仓位（`repositoryId`，从仓库元数据派生）+ 角色标签（`role`，子任务可声明），与 `WorkflowInvocationStreamDetail.{ownerRepositoryId, repositoryType}` 对齐。
4. 增量 diff 重拆：`requirements-index` 加版本字段，只对漂移/新增/删除的 requirement 重跑对应 cluster。
5. UI 以新组件 `src/components/PrdSplitWizard/` 实现四阶段向导（**不修改** `PrdTaskSplitPanel/**`）；保留并复用已有的纯逻辑模块（normalizer、buildSplitRequestPayload、anchorReconcile 等）。

## 3. 范围

### 必做（In Scope）

- `task.json` schema 扩展：`repositoryId: number | null`、`clusterId: string | null`。
- `requirements-index.json` schema 扩展：`version: string`、`bodyHash: string`（基于内容的稳定 hash）。
- 新服务（全部在 `src/services/prdSplit/` 下，不动既有 service）：
  - `clusterPlanner.ts` — 输入 repos + requirements，输出 cluster 计划。
  - `splitterDispatch.ts` — 把 cluster 输入装包并通过 Tauri 派给 `trellis-splitter` subagent。
  - `trellisWriter.ts` — 把 normalizer 输出 + cluster 元数据落到 `.trellis/tasks/<父>/<子>/`，通过 `task.py` API（不直写文件）。
  - `diffReplay.ts` — 比较 `requirements-index.version` / `bodyHash`，输出 dirty cluster 集。
- 新 Trellis subagent `trellis-splitter`（Claude / Cursor / Codex 三平台配置）。
- 新 Tauri 命令：`prd_split_create_parent_task`、`prd_split_dispatch_cluster`、`prd_split_materialize_tasks`、`prd_split_compute_diff`。
- 新 UI：`src/components/PrdSplitWizard/` 四阶段向导（Input / ClusterPlan / Splits / Review），与现有 `PrdTaskSplitPanel` **完全独立**，挂在 AppWorkspaceLayout 的项目卡片入口。

### 不做（Out of Scope）

- **不修改** `src/components/PrdTaskSplitPanel/**`（GPT 在并行重构该面板，避免冲突）。
- 不修改 `src/hooks/usePrdTaskSplit.ts`（被旧面板使用）。
- 不替换/迁移既有 `~/.wise/prd-runs/` 数据（保留作审计材料）。
- 不动 `wise.db` 已有 schema（`prd_executable_tasks` 等表暂保留，由旧面板继续写；新 wizard 不写这些表）。
- 不替换 Claude 模型，不引入新 LLM 供应商。
- 不做服务器侧多人协作（Trellis 仍是本地文件源）。
- `trellis-verifier` subagent 仅留接口位，默认不启用。

### 复用（Read-only Reuse）

允许 **import 但不修改** 以下模块：
- `src/services/buildSplitRequestPayload.ts`（构建 cluster 输入包时复用）。
- `src/services/claudeSplitOutputNormalize.ts`（normalizer 直接复用）。
- `src/services/prdRequirementIndex.ts`、`src/services/requirementsIndexValidate.ts`（requirements-index 工具）。
- `src/services/splitMappingMerge.ts`、`src/services/taskSplitter.ts`（SplitResult 工具，仅函数级 import）。
- `src/components/PrdTaskSplitPanel/{TaskCard,TaskAnchorPopoverBody,TaskAiPopoverContent,SplitQualityStrip,anchorReconcile,helpers}.{ts,tsx}` — 在新 wizard 的 Review 阶段**作为只读 import** 复用展示组件；如果 GPT 重构改了导出签名，本任务在 Stage 4 调用层做适配，不回改面板内部。

## 4. 用户故事

### S1. 多仓项目首次拆分
作为团队 PM，我在多仓项目卡片点击「需求拆分（Trellis）」→ 弹出四阶段向导 → 粘贴 PRD → 系统按 repo 元数据 + 依赖自动建议 cluster → 我审阅/调整 cluster → 系统为每个 cluster 派一个短命 splitter subagent 并行跑 → 我在 Review 阶段看到树形任务图（parent / child / 锚点回链 / repoTarget 标签）→ 点「Write to Trellis」 → 所有任务以 `.trellis/tasks/MM-DD-*/` 形式落盘 + `parent`/`children` 字段连通 + 主会话进入项目级编排。

### S2. 增量 diff 重拆
PRD 中某条 requirement 描述被改写。我重新打开向导 → 系统按 `requirements-index.version` + `bodyHash` 检测出 dirty 集 → 只重派对应 cluster → 已有任务的非 dirty 部分保留 / dirty 任务标 `pending_review` 状态。`claudeSplitMapping` 旧链保留。

### S3. 主会话独立运行
拆分完成后主会话由 SessionStart hook 注入 `Active task: <project>/<cluster-parent>` 上下文 → 我向主会话提问，它直接 dispatch `trellis-implement` 给对应 cluster 下的子任务（已有协议）。主会话从不持有 PRD 全文，只持有项目级编排上下文。

### S4. 与旧面板并存
旧 `PrdTaskSplitPanel` 入口保持原状继续工作（用户原有的入口 / prd-runs 写盘行为不变）。新「需求拆分（Trellis）」入口走新 wizard 落盘到 `.trellis/tasks/`。两路并存，用户自选。

## 5. 验收标准

### A1. Schema 扩展可前后兼容
- 旧的 `task.json`（无 `repositoryId` / `clusterId`）读取仍能 round-trip，新字段缺省为 `null`。
- `task.py` 所有命令对旧任务无回归（list / current / start / archive 等）。
- `requirements-index` 旧 payload（无 `version` / `bodyHash`）通过校验时旧字段自动补 `version: "0"`、`bodyHash: <recomputed>`。

### A2. 单 cluster 端到端可用（Stage 1 验收）
- 在单仓项目从向导 Input → Review → Write 一次完成。
- `.trellis/tasks/` 出现 1 个父任务 + N 个子任务，父任务 `prd.md` 是输入 PRD，子任务 `prd.md` 含 `sourceRequirementIds`/`taskAnchors`/`role`。
- 子任务 `task.json` 的 `parent` 字段指向父任务目录名。
- `task.py list --mine` 能看到新创建的所有任务。

### A3. 多 cluster 并行（Stage 2 验收）
- 多仓项目（≥2 repo）从向导触发，cluster planner 输出 ≥2 cluster。
- 每个 cluster 一个 splitter subagent 并行 dispatch（实测 wall-clock 比串行节省 ≥30%）。
- 每个 cluster 一个父任务，子任务的 `repositoryId` 与 cluster 内 repo 一致。

### A4. 溯源链端到端可回放（持续验收）
- 每个子任务 `prd.md` 可回链到一组 `sourceRequirementIds`，每个 ID 在父任务的 `requirements-index.json` 中存在。
- `taskAnchors.textHash` 在父任务 PRD 中可定位到对应原文范围（与现有 `validateClaudeSplitPayloadStrict` 校验等价）。
- `claudeSplitMapping` 仍写到父任务 `meta.claudeSplitMapping`，含 `taskRequirementLinks` + `idRemap`。

### A5. Diff 重拆（Stage 3 验收）
- 改一条 requirement 文本 → 重打开向导 → 系统列出 dirty cluster（仅含受影响 requirement 的 cluster）。
- 用户确认后只对 dirty cluster 重派 subagent；其他 cluster 任务原样保留。
- dirty cluster 内：未受影响的子任务保持 `flowStatus` 不变；受影响的子任务被标记 `flowStatus = "pending_review"`。

### A6. UI 价值保留（不动旧面板的前提下）
- 锚点高亮（`taskAnchorDescriptors` → PRD 文本范围高亮）在新 wizard 的 Review 阶段继续工作（通过 `anchorReconcile` 只读复用）。
- TaskCard / TaskAnchorPopoverBody / TaskAiPopoverContent / SplitQualityStrip 通过只读 import 在新 wizard 内复用展示（不改动它们的源文件）。
- 旧 `PrdTaskSplitPanel` 入口、行为、prd-runs 写盘**保持原样**。

### A7. 主会话独立
- 拆分完成后，主会话向 `trellis-implement` 派发时，prompt 第一行是 `Active task: <child-task-path>`（符合 workflow.md dispatch protocol）。
- 主会话不持有 PRD 全文，只持有项目级 metadata（cluster 列表 + 父任务路径）。

### A8. 隔离边界（防冲突约束）
- 本任务的所有改动 git diff 中**不出现** `src/components/PrdTaskSplitPanel/**` 与 `src/hooks/usePrdTaskSplit.ts` 的路径。
- 不引入对 `~/.wise/prd-runs/` 写路径的修改（Tauri `prd_materialize.rs` 现有逻辑保持）。

## 6. 非功能要求

- **性能**：拆分 wall-clock 由 cluster 数决定下界；单 cluster < 60s（取决于 Claude 响应），并行 cluster 不阻塞 UI（streaming）。
- **可观测性**：每个 splitter dispatch 写入 `WorkflowInvocationStreamDetail`（已有表），可在 ProgressMonitorDrawer 看到。
- **可回放**：dispatch payload + Claude raw output + normalizer 入参出参均落 `~/.wise/prd-runs/<runId>/`（与现有持久化一致，路由复用 `prd_materialize.rs`），即便迁移到 Trellis 后也保留 prd-runs/ 作为审计回放材料。
- **错误恢复**：splitter 失败或校验失败时，父任务保留 `planning` 状态，子任务不落盘；UI 显示 issue 列表，用户可修 prompt 重跑（不消耗已成功 cluster）。

## 7. 约束

- 严禁在 `src/components/` 内直接 `invoke`，所有 Tauri 调用走 `src/services/*`（项目规约）。
- 用户面板用中文，schema 字段名 / 文件名 / commit 用英文（项目规约）。
- 拆分 subagent 输入受 PRD 长度限制（`DEFAULT_PRD_BODY_MAX_CHARS`），cluster 切片要保证每片不超限。
- `task.py` API 是唯一的任务落盘入口，trellisWriter **不得**直写 `.trellis/tasks/*/task.json`。
- subagent dispatch 必须以 `Active task: <path>` 开头（workflow.md 强约束）。
- **本任务严禁修改** `src/components/PrdTaskSplitPanel/**` 与 `src/hooks/usePrdTaskSplit.ts`（与 GPT 并行重构冲突）。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| GPT 在并行重构 PrdTaskSplitPanel，导出签名可能变化 | 新 wizard 在 Stage 4 的展示复用只走「适配层」（在 PrdSplitWizard 内包装一层 props 转换），不依赖具体导出形态；若签名破坏，适配层一处兜底 |
| Cluster 切分错误导致跨仓任务被切散 | clusterPlanner 输出可编辑；ClusterPlan 阶段强制用户审阅 |
| diff 重拆误判 dirty 集，丢任务 | Stage 3 强制双向校验：dirty 集必须基于 textHash 漂移 + requirementId 集合变化两条独立信号，单条不触发 |
| `task.json` schema 扩展破坏旧任务 | Stage 1 第一步：扩展只加 `null`-able 字段并写 round-trip 测试 |
| Claude 输出 schema 漂移 | 复用现有 `validateClaudeSplitPayloadStrict` 强校验；新 schema 字段（`repoTarget`）作为非必填增量 |

## 9. 开放问题（在 design.md 中定）

- splitter subagent 的 prompt 是 PRD 全文 + cluster 切片，还是只发 cluster 切片 + cluster 上下文摘要？
- cluster 之间的依赖（跨 cluster task dependency）如何持久化——子任务 `dependencies` 字段允许跨父任务引用？
- 旧 `prd-runs/` 数据是否需要迁移到 Trellis 任务？（建议：不迁移，作为审计材料保留）
