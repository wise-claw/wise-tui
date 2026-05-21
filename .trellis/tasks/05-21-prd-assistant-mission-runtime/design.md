# Design

## Architecture Direction

这次不是复活旧 `MissionControl` / `PrdSplitWizard` UI。废弃 UI 可以删除；要保留的是运行语义、状态机和账本能力。Wise 的需求助手拆成三层：

```text
PrdTaskSplitPanel
  UI shell: PRD 输入、候选任务审查、运行状态展示

Requirement Mission Controller
  headless orchestration: target、sandbox、cluster runs、retry/cancel、ledger

Trellis / Claude Services
  filesystem truth + Mission/Trellis runtime + Claude Code dispatch
```

`PrdTaskSplitPanel` 继续是产品入口。`PrdSplitWizard` / `MissionControl` 中可复用的是 state 和 actions，不是布局。若旧布局阻碍迁移，直接删除或拆散，不做兼容保护。

## Target Contract

新增或收敛一个统一目标模型：

```ts
type TrellisTarget =
  | {
      kind: "workspace";
      projectId: string;
      displayName: string;
      rootPath: string;
      repositories: PlannerRepo[];
      activeRepositoryId: number | null;
      defaultExecutionRepositoryId: number | null;
      context: TaskSplitContext;
    }
  | {
      kind: "standaloneRepository";
      repositoryId: number;
      displayName: string;
      rootPath: string;
      repositories: PlannerRepo[];
      activeRepositoryId: number;
      defaultExecutionRepositoryId: number;
      context: TaskSplitContext;
    };
```

规则：

- Workspace 有 `rootPath` 时，rootPath 永远是 `.trellis` 事实源。
- 单仓 Workspace 不退化成 Standalone Repo。
- Workspace 的成员 repo 是 execution target，不展示 repo 级 Trellis root。
- Standalone Repo 用 repo path 作为 rootPath，并生成 synthetic project ref。
- target 解析失败时 UI 展示明确阻断原因。

## Headless Runtime Contract

抽离一个需求任务运行控制器，优先复用 `PrdSplitWizard/useSplitWizardState`、`MissionControl/actions/runMissionActions.ts` 的能力。

建议边界：

```ts
interface RequirementMissionController {
  target: TrellisTarget | null;
  state: RequirementMissionState;
  setPrdMarkdown(markdown: string): void;
  plan(): Promise<void>;
  dispatchClusters(): Promise<void>;
  retryCluster(clusterId: string): Promise<void>;
  cancelCluster(clusterId: string): Promise<void>;
  materializeReviewedTasks(): Promise<void>;
}
```

第一波可以先做 adapter，但不保护旧 UI：

- `PrdSplitWizard` 的 reducer 和 types 继续存在。
- 新增 `useRequirementMissionController` 包装 wizard state 与 mission actions。
- `MissionControl` / `PrdSplitWizardModal` UI 已删除；保留的是 headless state、actions、ledger hooks 与 Trellis 运行透镜组件。
- `PrdTaskSplitPanel` 不再直接调用 `runPrdSplitSubagentWorkflow`，拆分与落盘统一走 controller。

## Flow

```text
resolve target
  -> edit/import PRD
  -> build requirements index
  -> plan clusters
  -> review candidates
  -> explicit execute
  -> create/resume Mission
  -> create/reuse parent task
  -> dispatch trellis-splitter per cluster
  -> validate output
  -> review/materialize child tasks
  -> optional fanout implement waves
```

关键边界：

- `plan clusters` 前不写 `.trellis/tasks`。
- `dispatch trellis-splitter` 前必须有 Mission id 和 assignment id。
- `dispatch` 的 raw stdout/stderr、Claude session id、runDir 必须进入可追踪 metadata。
- child task materialization 与 execution fanout 不能混成一个不可回滚动作。

## UI Shape

第一波 UI 不追求终稿，但要修正信息架构：

- 顶部显示目标：`Workspace: <name>` / `Standalone Repo: <name>`、Trellis root、执行引擎。
- 阶段表达：`收集` / `规划` / `审查` / `派发` / `落盘`。
- 左侧是 PRD 编辑与来源。
- 右侧优先展示候选任务/cluster 概览；空态要说明下一步，而不是大片空白框。
- 运行中展示 cluster rows：repo、status、duration、stdout/stderr、retry/cancel。

## Data Boundaries

- UI components consume controller state and callbacks only。
- Tauri IPC calls stay in `src/services/*` wrappers。
- Mission ledger writes remain in mission service/action layer。
- Trellis runtime writes remain in `src/services/trellisRuntime.ts`。
- Claude process spawning remains in Rust `prd_split_pipeline.rs`。

## Compatibility

- Existing PRD import/history/task edit capabilities must keep working。
- Old MissionControl route is not a product compatibility target. Keep only if it still helps debug the headless runtime during migration。
- Database schema remains additive; no migration required for the first wave unless a missing durable field is discovered。
- Existing `.trellis/tasks` written by previous flows should be reusable by dirty-cluster scan。

## Risks

- `PrdTaskSplitPanel` controller is already large; direct rewiring risks regressions。
- The clean path is adapter-first, then delete obsolete UI shells once call sites move。
- UI polish should follow state convergence, otherwise会继续把状态债藏在漂亮界面下面。
