# Mission Control 技术设计

## 1. 目标与原则

把现有 wizard 切成两层：

- **Engine 层（不动）**：`useSplitWizardState` reducer、`services/prdSplit/*`、`services/workflow/*`、`buildPrdSplitWorkflowArtifacts`。所有 mutation action 仍由 reducer 接管。
- **Presenter 层（新建）**：`useMissionPresenter()` 把 `WizardState` 投影为 `MissionViewModel`；新顶层组件 `MissionControl` 消费 ViewModel 并把用户操作翻译回 reducer action。

设计原则：

1. **只读投影 + Action 委派**：Presenter 不持有副本 state；ViewModel 每次从最新 reducer state 派生，方法 (`reassignRequirement / addManualTask / writeAll / ...`) 转手调用 reducer api。
2. **术语翻译表集中管理**：建立 `src/components/MissionControl/copy.ts` 单一文案出口；UI 组件只引用 copy 表，避免内部词汇外泄到字面量。
3. **三层可拆**：MissionHeader、MissionCanvas（三列）、MissionSetupDrawer、EngineeringDrawer 之间通过 `MissionViewModel + dispatch` 单向数据流，无横向耦合。
4. **接入既有事件总线不变**：`WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` 由 AppImpl 接住后改开 `missionControlMode`；`OPEN_REPOSITORY_FILE / OPEN_WORKFLOW_CONFIG / WORKFLOW_GRAPH_CHANGED` 全保留。

## 2. 模块边界

```
src/components/MissionControl/
├─ index.ts                          # 公开导出：MissionControl, OPEN_MISSION_CONTROL_EVENT
├─ MissionControl.tsx                # 顶层容器；持有 useSplitWizardState + useMissionPresenter
├─ copy.ts                           # 文案与术语翻译表（中央词典）
├─ useMissionPresenter.ts            # WizardState → MissionViewModel 投影
├─ useMissionPresenter.test.ts       # 投影函数快照测试
├─ presenter/
│  ├─ types.ts                       # MissionViewModel / MissionPhase / TaskCardVM 等
│  ├─ projectMission.ts              # WizardState → MissionViewModel 纯函数
│  ├─ projectMission.test.ts
│  ├─ statusModel.ts                 # ClusterRunState → 用户面 5 态映射
│  └─ statusModel.test.ts
├─ header/
│  ├─ MissionHeader.tsx              # 标题 + 阶段进度 + 风险 + 主 CTA
│  ├─ MissionPhaseStrip.tsx          # 4 阶段 chips（drafting/planning/executing/verifying）
│  └─ MissionRiskBadge.tsx
├─ canvas/
│  ├─ MissionCanvas.tsx              # 三列布局
│  ├─ RequirementsColumn.tsx         # 左列：需求卡片列表
│  ├─ RequirementCard.tsx
│  ├─ TaskGraphColumn.tsx            # 中列：并行层堆叠
│  ├─ ParallelLayerBlock.tsx         # 单个并行层（粗虚线容器）
│  ├─ TaskCard.tsx                   # 单个任务卡片（带状态 chip / role / 选中态）
│  └─ DependencyConnector.tsx        # 相邻层之间的连接线（SVG）
├─ details/
│  ├─ EvidencePane.tsx               # 右列：详情 + 证据
│  ├─ TaskEditorInline.tsx           # 任务标题/角色/子项/DoD 编辑（复用现有 ListEditor）
│  ├─ AnchorSection.tsx              # PRD 锚点 + 代码锚点；触发 AnchorViewerModal
│  └─ EngineeringFoldout.tsx         # 选中任务的工程细节折叠区
├─ setup/
│  ├─ MissionSetupDrawer.tsx         # PRD 编辑 + 目标选择 + 历史导入
│  └─ MissionTargetPicker.tsx
├─ engineering/
│  ├─ EngineeringDrawer.tsx          # 全局工程细节抽屉（cluster 列表、validation、原始输出）
│  ├─ ClusterDetailsCard.tsx
│  └─ ValidationIssueList.tsx
└─ legacy/
   └─ AnchorViewerModal.tsx          # 从现 ReviewStage 抽出来的锚点速览（功能保留）
```

## 3. 数据模型

`src/components/MissionControl/presenter/types.ts`：

```ts
export type MissionPhase = "drafting" | "planning" | "executing" | "verifying" | "done";

export type TaskUserStatus = "queued" | "preparing" | "running" | "completed" | "blocked";

export interface MissionViewModel {
  phase: MissionPhase;
  /** 一句话使命标题（来自 PRD 标题/首行/项目名）。 */
  title: string;
  subtitle: string;
  project: { id: string | null; name: string; rootPath: string };
  repositoriesParticipating: Array<{ id: number; name: string; role: "frontend" | "backend" | "document" }>;
  phaseStrip: Array<{ key: MissionPhase; label: string; status: "todo" | "current" | "done" }>;
  primaryCta:
    | { kind: "open-setup"; label: string }
    | { kind: "generate-tasks"; label: string; disabled: boolean }
    | { kind: "write-trellis"; label: string; disabled: boolean }
    | { kind: "open-workflow"; label: string; workflowId: string };
  risks: {
    blockedTaskCount: number;
    validationIssueCount: number;
    crossRepoRequirementCount: number;
  };
  requirements: RequirementCardVM[];
  /** parallel layers，按依赖拓扑排好序；每层若 >1 个任务则在中列画虚线框。 */
  taskGraph: { layers: ParallelLayerVM[] };
  selection: MissionSelection;
  /** 给 EvidencePane / EngineeringFoldout 用。 */
  selectedTaskEvidence: TaskEvidenceVM | null;
  /** 工程细节抽屉用。 */
  engineering: EngineeringDetailsVM;
}

export interface RequirementCardVM {
  id: string;            // REQ-01 etc
  bodyPreview: string;   // 截断 80 字
  taskCount: number;
  hasCrossGroupTasks: boolean;  // 跨并行层
  isHighlighted: boolean;       // selection 命中
}

export interface ParallelLayerVM {
  id: string;
  index: number;          // 第 N 层 (1-based)
  isParallel: boolean;    // taskIds.length > 1
  isBottleneck: boolean;  // 任务最多 OR 含 blocked 任务
  tasks: TaskCardVM[];
}

export interface TaskCardVM {
  id: string;             // sourceTaskId (T-001 etc)
  title: string;
  role: "frontend" | "backend" | "document" | null;
  status: TaskUserStatus;
  repositoryLabel: string | null;   // "前端 · web-app"，不暴露 repoId
  dependencyTaskIds: string[];
  isHighlighted: boolean;           // selection 命中（直接选中或来自需求联动）
  isDimmed: boolean;                // selection 存在且本卡片不在高亮集合
  isSelected: boolean;
  /** Phase B 接入；Phase A 始终为 null。 */
  executionState: null;
  evidence: null;
}

export interface TaskEvidenceVM {
  taskId: string;
  title: string;
  status: TaskUserStatus;
  sourceRequirements: Array<{ id: string; bodyPreview: string }>;
  prdAnchor: { from: number; to: number; preview: string } | null;
  codeAnchors: Array<{ filePath: string; line: number | null; raw: string }>;
  description: string;
  subtasks: string[];
  dod: string[];
  /** 工程细节折叠区。 */
  technical: {
    clusterId: string;
    clusterTitle: string;
    parentTaskName: string | null;
    taskName: string | null;
    taskPath: string | null;
    validationIssues: Array<{ path: string; message: string }>;
    isManual: boolean;
    isEdited: boolean;
  };
}

export interface MissionSelection {
  requirementId: string | null;
  taskId: string | null;
  /** 因需求 → 任务联动高亮的任务集合（含直接选中任务）。 */
  highlightedTaskIds: Set<string>;
}

export interface EngineeringDetailsVM {
  workflowGraph: { workflowId: string; nodeCount: number; edgeCount: number; status: string } | null;
  clusters: Array<{
    id: string;
    title: string;
    runStatusInternal: string;   // raw idle/dispatching/...
    parentTaskName: string | null;
    diff: "new" | "unchanged" | "dirty";
    dirtyReasons: string[];
    validationIssues: Array<{ path: string; message: string }>;
  }>;
}
```

## 4. 选择模型 / 高亮规则

- 单一主选择 = `{ requirementId, taskId }`。
- 用户点需求 → `requirementId = X, taskId = X 的第一个任务`（如果有）。
- 用户点任务 → `taskId = T, requirementId = T 的第一个来源需求`（若已有 requirementId 与 T 关联，则保留）。
- `highlightedTaskIds = (requirementId 命中任务) ∪ (taskId 选中) ∪ (taskId 的依赖链上下游 1 跳)`。
- 中列任务 `isDimmed = highlightedTaskIds.size > 0 && !highlightedTaskIds.has(t.id)`；CSS 上用 `opacity: 0.45`。
- 选择态保存在 `MissionControl` 组件内 React state（不上 reducer）；重置条件：阶段从 `done` 回退、Setup Drawer 提交、selection 命中对象消失。

## 5. 状态映射

`presenter/statusModel.ts` 完成内部 → 用户面映射：

| 内部 (ClusterRunState.status / write outcome / diff) | 用户面 `TaskUserStatus` | UI 文案 | 颜色 |
|---|---|---|---|
| `idle`（plan 阶段） | `queued` | 等待生成 | 灰 |
| `creating-parent` | `preparing` | 准备分组 | processing |
| `dispatching` | `running` | 任务生成中 | processing |
| `succeeded`（未写入） | `completed`* | 待落盘 | success（柔和） |
| 已写入 Trellis | `completed` | 已落盘 | success |
| `failed` | `blocked` | 已阻塞 | error |
| 有 validation issue | `blocked` | 待修复 | warning |
| `skipped-clean` | `completed` | 已复用 | success（淡） |

任务级别（区别于 cluster 级别）：在 Phase A 没有 per-task 运行态，所以**所有任务的 status = 其所属 cluster 的映射结果**；Phase B 替换为 per-task agent 状态。

## 6. 阶段映射

`WizardStage → MissionPhase`：

| WizardStage | MissionPhase | 主 CTA |
|---|---|---|
| `input`（无 PRD） | `drafting` | 粘贴 PRD 开始（打开 Setup Drawer） |
| `input`（有 PRD 还没 parse） | `drafting` | 解析 PRD（触发 parseAndPlan） |
| `plan` | `planning` | 生成任务（goToDispatch） |
| `dispatch`（部分 idle） | `planning` | 生成任务（runAll） |
| `dispatch`（allDone） | `verifying` | 进入审阅（goToReview） |
| `review` | `verifying` | 落盘到 Trellis（beginWrite） |
| `writing` | `verifying` | （disabled）落盘中… |
| `done` | `done` | 打开执行编排（dispatch event） |

`phaseStrip` 中的 4 个 chip = `drafting / planning / verifying / done`（"executing" 留给 Phase B 接 agent 实时执行；Phase A 永远跳过到 verifying）。

## 7. 挂载策略

### AppImpl 改动（最小集）

- 新增 `missionControlMode` state 与 setter；在 AppImpl 顶层与其它 `*Mode` 互斥。
- `openPrdSplitWizard(detail)` 改为 `openMissionControl(detail)`：设置 `missionControlMode = true`，并把 `detail.projectId / repositoryId` 通过 ref/props 传入 MissionControl 作为初始目标。
- `WORKFLOW_UI_EVENT_OPEN_PRD_SPLIT_WIZARD` 监听器路由到 `openMissionControl`（事件常量名先保留以兼容老调用方）。
- 同步新增 `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL` 常量；新代码用它。

### AppWorkspaceLayout 改动

在 `promptsMode ? <full-width> : <chat+right>` 旁，新增 `missionControlMode` 分支：

```tsx
{missionControlMode ? (
  <div className="app-full-width-main">
    <Suspense fallback={<PanelLoadingFallback />}>
      <MissionControl {...missionControlProps} />
    </Suspense>
  </div>
) : promptsMode ? (
  ...
) : (
  ... 原 chat-with-right-pane
)}
```

resize handle 隐藏条件同 promptsMode。

### PrdSplitWizardHost 改动

- FAB 仍存在；点击 dispatch `WORKFLOW_UI_EVENT_OPEN_MISSION_CONTROL`（兼容旧事件名）。
- **不再 mount `<PrdSplitWizardModal>`**。Host 本身保留作为 FAB 提供者。
- FAB tooltip 文案改为「使命控制台 · Mission Control」。

### 旧 Modal

`PrdSplitWizardModal.tsx` 文件保留，但 `src/components/PrdSplitWizard/index.ts` 不再导出 `PrdSplitWizardModal`（或导出但标 `@deprecated`，确保没人能误调）。

## 8. 操作 → reducer action 映射

| MissionControl 操作 | reducer action |
|---|---|
| Setup Drawer 提交 PRD + 目标 | `reset(project, repos, context)` → `setPrdMarkdown(md)` → `parseAndPlan()` |
| Setup Drawer 切换参与仓位 | `setSelectedRepos(ids)` |
| 重新打开 Setup | `backToInput()`（带确认弹窗，照搬现 Modal.confirm） |
| 任务卡片改标题 | `patchTaskEdit(clusterId, taskId, { title })` |
| 任务卡片改子项 / DoD | `patchTaskEdit(clusterId, taskId, { subtasks/dod })` |
| 删除任务 | `deleteTask(clusterId, taskId)` |
| 恢复已删任务 | `restoreTask(clusterId, taskId)` |
| 新增手工任务 | `addManualTask(clusterId, task)` |
| PRD 锚点编辑 | `patchTaskEdit(clusterId, taskId, { taskAnchors })`（沿用 AnchorViewerModal） |
| 重新归簇（高级）  | `reassignRequirement(...)`（在工程抽屉提供） |
| 重命名分组（高级） | `renameCluster(...)`（在工程抽屉提供） |
| 工程抽屉「修复异常」 | `runVerifier(clusterId)`（沿用现 service `dispatchClusterVerifier`） |
| 工程抽屉「跳过未变化」开关 | `setDispatchOnlyDirty(bool)` |
| 主 CTA：生成任务 | `goToDispatch()` → 并行 `runCluster()` 每个 cluster |
| 主 CTA：落盘 | `beginWrite()` → 串行 `writeClusterTasks` 每个 cluster → `persistWorkflowGraph()` → `finishWrite()` |
| 主 CTA：打开执行编排 | `dispatchEvent(WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG, ...)` |

`runCluster()` 与 `persistWorkflowGraph()` 抽出现存 `SplitsStage.runCluster` 与 `ReviewStage.writeAll/persistWorkflowGraph`，迁移到 `src/components/MissionControl/actions/` 作为纯 thunk-like 函数（参数：api + ipc helpers），不再依赖 stage 组件。

## 9. 词汇表（copy.ts 摘要）

```ts
export const PHASE_LABEL: Record<MissionPhase, string> = {
  drafting: "起草",
  planning: "规划",
  executing: "执行",
  verifying: "校验",
  done: "已完成",
};

export const USER_STATUS_LABEL: Record<TaskUserStatus, string> = {
  queued: "等待",
  preparing: "准备中",
  running: "执行中",
  completed: "已完成",
  blocked: "已阻塞",
};

export const ROLE_LABEL: Record<TaskRole, string> = {
  frontend: "前端",
  backend: "后端",
  document: "文档",
};

export const COPY = {
  primaryCta: {
    openSetup: "粘贴 PRD 开始",
    parsePrd: "解析 PRD",
    generateTasks: "生成任务",
    writeTrellis: "落盘到 Trellis",
    openWorkflow: "打开执行编排",
  },
  setupDrawer: {
    title: "起草使命",
    submit: "确认 PRD，进入规划",
    targetProject: "目标项目",
    targetRepository: "目标仓库",
    participatingRepos: "参与仓位",
    prdEditor: "PRD（Markdown）",
    importLegacy: "从历史 PRD 导入",
  },
  engineeringDrawer: {
    title: "高级 · 工程细节",
    open: "查看工程细节",
    clustersHeading: "任务分组",
    rawOutput: "Splitter 原始输出",
  },
};
```

主画布**严禁**直接出现 `cluster/dirty/parentTaskName/...` 等英文术语；它们只能出现在 `engineering/*.tsx` 内。

## 10. 视觉规范（要点）

- 三列宽比固定 `22 : 56 : 22`，最小宽 `220 : 540 : 260`；窗口 < 1180 时自动折叠右列到抽屉，<900 时折叠左列。
- Mission Header 高 64px，背景使用 `var(--ant-color-fill-quaternary)` 浅底；标题 18/24，subtitle 12/16；CTA 用 `Button type="primary" size="large"`。
- 并行层容器：`border: 2px dashed var(--ant-color-border-secondary)`，圆角 12，padding 16；瓶颈层 `border-color: var(--ant-color-warning-border)`。
- 任务卡片：圆角 8、阴影 `0 1px 3px rgba(0,0,0,0.04)`；选中态 `border: 2px solid var(--ant-color-primary)`；高亮但非选中 `border: 1.5px solid var(--ant-color-primary-border)`；dimmed `opacity: 0.45`。
- 依赖连接线：层间用 12px 高的 SVG 通道，浅灰；选中任务的连线染色 `var(--ant-color-primary)`。

## 11. 风险与回退

- **风险 1**：保留旧 reducer 的同时引入新表现层，可能在 selection 重置 / phase 切换时与 reducer 自身 stage 切换产生竞态。
  缓解：phase 字段只读，从 `state.stage / clusterRuns / writeResults` 派生；所有 mutation 仍走 reducer，不在 presenter 中复制 state。
- **风险 2**：`SplitsStage.runCluster` 抽离到独立模块时遗漏 IPC error 处理。
  缓解：完整搬迁 try/catch + `patchClusterRun(failed)` 路径，并保留同名测试切片。
- **风险 3**：词汇表换文案可能影响残留 e2e 或截图测试。
  缓解：仓库内 `grep -rn "cluster\|Cluster"` 在测试目录被允许；用户面文案变更只影响 `MissionControl/**`。
- **回退路径**：将 AppImpl 中 `missionControlMode` 默认改 false 并恢复 `PrdSplitWizardModal` 的 Host 挂载（保留代码 1 个周期），可在 5 行内回滚。

## 12. 测试矩阵

- `presenter/projectMission.test.ts`：
  - 空 state → phase=drafting，primaryCta=open-setup。
  - PRD 已解析 → phase=planning，3 个 cluster 投影成 3 层。
  - 部分 cluster succeeded、部分 idle → phase 仍 planning。
  - 全部 succeeded、未写入 → phase=verifying，primaryCta=write-trellis。
  - 写入完成 → phase=done，primaryCta=open-workflow。
- `presenter/statusModel.test.ts`：5 类 cluster 状态 + diff + write 结果 → 期望 5 态。
- 不破坏：`useSplitWizardState.test.ts`、`clusterPlanEdits.test.ts`、`workflowGraphFromSplit.test.ts`。
- 视觉：Phase A 内部不引入截图测试；遵循"AI 不启服务"原则，bun test + tsc 通过即放过。

## 13. 与 Phase B 的接口预留

`TaskCardVM.executionState` 与 `TaskEvidenceVM.evidence` 字段已留空但类型已声明（`null`）。Phase B 任务只需：

1. 在 reducer 旁挂一个 per-task 运行表（或独立 store），更新 source/agent/status。
2. 修改 `projectMission.ts` 让 `executionState` 从该表读取。
3. `TaskCard` 渲染分支增加 `executionState != null` 时展示 4 阶段（research/implement/check/verifier）chip。

不需要改 MissionControl 的组件树。
