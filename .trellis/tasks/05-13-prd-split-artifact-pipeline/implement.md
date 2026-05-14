# 执行计划 — PRD 拆分 Artifact Pipeline

> 严禁修改 `src/components/PrdTaskSplitPanel/**` 与 `src/hooks/usePrdTaskSplit.ts`（GPT 并行重构禁区）。
> 每阶段结束 → `bun test` + `cargo check` + `bun run tsc -p tsconfig.json --noEmit`，任一失败即修，**不进入下一阶段**。

## Stage 1 — Foundation（本会话目标）

载体：让 `.trellis/tasks/<父>/<子>/` 能从代码侧写出来；单 cluster 手工模式；无 UI 入口。

### 1.1 `task.json` schema 扩展

- 文件：`.trellis/scripts/common/task_store.py`
  - 读取时为旧任务字段补 `repositoryId: null`、`clusterId: null`；写入时按 `null`/值落盘。
  - 增量字段不放进 schema 强校验（保持向后兼容）。
- 文件：`.trellis/scripts/task.py`
  - `create` 子命令增加 `--repository-id INT`、`--cluster-id STR`。
  - 子任务 `--parent` 已存在，本次不动。
- 测试：`.trellis/scripts/common/test_task_store_extensions.py`（新）
  - round-trip 旧 task.json（无新字段）→ 读出 → 写回 → 再读，新字段稳定为 `null`。
  - `create --parent X --repository-id 7 --cluster-id c1`，落盘 task.json 含字段。
- 验证：`python3 -m pytest .trellis/scripts/common/test_task_store_extensions.py -q`

### 1.2 TS 镜像类型 + Trellis 写入 service（最小可用）

- 新文件 `src/types/trellisTask.ts`
  ```ts
  export interface TrellisTaskJson {
    id: string; name: string; title: string; description: string;
    status: "planning" | "in_progress" | "completed" | "archived";
    priority: "P0"|"P1"|"P2"|"P3";
    parent: string | null;
    children: string[];
    repositoryId: number | null;
    clusterId: string | null;
    // 不枚举全部既有字段，预留 [k: string]: unknown
    [key: string]: unknown;
  }
  ```
- 新文件 `src/services/prdSplit/trellisWriter.ts`（仅实现 single-cluster 写入分支）
  - 导出 `writeClusterTasks(input)`（见 design §3.3）。
  - 单测在 `src/services/prdSplit/trellisWriter.test.ts`：mock invoke，验证调用参数 / 输出结构。
- 单测：`bun test src/services/prdSplit/trellisWriter.test.ts`

### 1.3 Tauri 命令骨架（仅 create_parent_task / materialize_tasks）

- 新文件 `src-tauri/src/claude_commands/prd_split_pipeline.rs`
  - `prd_split_create_parent_task` — 调 `task.py create <title> --slug <slug> --priority <p> --repository-id ...`，返回 `parent_task_path: String`。
  - `prd_split_materialize_tasks` — 解析 normalized split JSON，循环调 `task.py create --parent <父>` 写每个子任务，写 `prd.md`、把 `claudeSplitMapping` 写入 `task.json.meta`（通过 `task.py` 不支持 meta 时直接 `task_store.py` API）。
  - `dispatch_cluster` / `compute_diff` 留 TODO 桩，本阶段不实现。
- 文件 `src-tauri/src/lib_impl.rs`：注册新命令。
- 文件 `src-tauri/capabilities/default.json`：allow 新命令。
- 文件 `src-tauri/src/claude_commands/mod.rs`：`pub mod prd_split_pipeline;`
- 验证：`cargo check --manifest-path src-tauri/Cargo.toml`

### 1.4 端到端 sanity（脚本驱动，不走 UI）

- 新文件 `src/services/prdSplit/__manual_smoke__.md`（仅文档，不执行）
  - 说明如何在 devtools 控制台调 `invoke("prd_split_create_parent_task", ...)` + `invoke("prd_split_materialize_tasks", ...)` 跑通单 cluster。
  - 不在 CI 中跑，作为下一阶段串 UI 时的手工脚手架。

### 1.5 Stage 1 commit

- 一次 commit：`feat(prd-split): foundation for trellis-anchored split pipeline (stage 1)`
- diff 范围严格限于：
  - `.trellis/scripts/common/task_store.py`
  - `.trellis/scripts/task.py`
  - `.trellis/scripts/common/test_task_store_extensions.py`
  - `src/types/trellisTask.ts`
  - `src/services/prdSplit/trellisWriter.ts`
  - `src/services/prdSplit/trellisWriter.test.ts`
  - `src/services/prdSplit/__manual_smoke__.md`
  - `src-tauri/src/claude_commands/prd_split_pipeline.rs`
  - `src-tauri/src/claude_commands/mod.rs`
  - `src-tauri/src/lib_impl.rs`
  - `src-tauri/capabilities/default.json`
- **不**包含 `PrdTaskSplitPanel/**` 任何路径。

---

## Stage 2 — Cluster planner + multi-cluster dispatch（后续会话）

- `src/services/prdSplit/clusterPlanner.ts` + 单测（覆盖单仓 / 多仓 / 跨仓 / 大集合二切）。
- `src/services/prdSplit/splitterDispatch.ts` + Tauri `prd_split_dispatch_cluster` 实现：
  - 复用 `buildSplitRequestPayload`，按 cluster 切 PRD。
  - shell out 到 `claude` CLI（platform-agnostic 抽象层放 `src-tauri/src/claude_commands/prd_split_pipeline.rs`）。
  - 持久化 raw I/O 到 `~/.wise/prd-runs/<runId>/`（复用 `prd_materialize.rs` 目录约定）。
- 整合 normalizer：`splitterDispatch` 出参直接喂 `normalizeClaudeSplitOutputToSplitResult`（既有，不动）。
- 验证：单测覆盖 cluster planner；splitterDispatch 用 mock claude 二进制测一次。

## Stage 3 — requirements-index v2 + diff replay（后续会话）

- 升级 `src/services/prdRequirementIndex.ts` 输出 `schemaVersion: 2`（旧版兼容读取）。
- 新 `src/services/prdSplit/diffReplay.ts` + 单测（覆盖 added / removed / body_changed / orphan）。
- Tauri `prd_split_compute_diff` 实现。

## Stage 4 — PrdSplitWizard UI（后续会话）

- 新 `src/components/PrdSplitWizard/` 整套（design §6 结构）。
- AppWorkspaceLayout 注册新 lazy 入口 + 项目卡片按钮（feature flag 守护）。
- 复用旧组件通过 `PrdSplitWizard/adapters/` 适配（如 GPT 重构改了导出，仅改 adapters）。
- 端到端验证：单仓单 cluster wizard 跑通；多仓多 cluster wizard 跑通。

## Stage 5 — trellis-splitter subagent 配置 + 集成（后续会话）

- 三平台 agent 配置文件：`.claude/agents/trellis-splitter.md`、`.cursor/agents/trellis-splitter.md`、`.codex/agents/trellis-splitter.toml`。
- prompt 模板放在 `.trellis/spec/guides/trellis-splitter-prompt.md`（新文件，作为单一事实源）。
- 跑一次真实 Claude dispatch 端到端：观察 raw output、normalizer 校验、写盘结果。

## Stage 6 — (可选) trellis-verifier subagent

- 仅在 Stage 5 实测出现校验失败率 > 阈值时启用；接口位 design §1 已留。

---

## 回滚点

| 阶段 | 回滚做法 |
|---|---|
| Stage 1 | `git revert <commit>`；`task.json` 旧任务无 `repositoryId/clusterId` 仍可读 |
| Stage 2 | 同上；Tauri 命令删掉即可；前端 service 没人调用就是死代码 |
| Stage 3 | requirements-index 写回 v1 通过 `schemaVersion` 缺省判定继续工作 |
| Stage 4 | feature flag 关掉入口；写过的 `.trellis/tasks/` 可保留或 `task.py archive` |
| Stage 5 | 删除 agent 配置文件 |

## 验证命令清单

```bash
# 单元 + 类型
bun test
bun run tsc -p tsconfig.json --noEmit

# Rust
cargo check --manifest-path src-tauri/Cargo.toml

# Trellis 脚本测试（Stage 1）
python3 -m pytest .trellis/scripts/common/test_task_store_extensions.py -q

# Trellis 任务一致性
python3 ./.trellis/scripts/task.py validate 05-13-prd-split-artifact-pipeline
```

## 关键决策（落 commit message 时引用）

1. 复用 `claudeSplitOutputNormalize` 而非新写 normalizer。
2. trellisWriter 通过 `task.py` 落盘，**禁止**直写 `task.json`。
3. PRD `prd-runs/<runId>/` 持久化继续走 `prd_materialize.rs`，与 Trellis 任务并存。
4. PrdSplitWizard 与 PrdTaskSplitPanel 并存；Stage 5 完成才评估收口。
