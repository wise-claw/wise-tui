# Wise Workflow API 契约（前端服务层）

## 1. 目标

定义 Wise 内部“流程编排”服务层 API 契约，供 UI、WorkflowEngine、OMC Adapter、GateEngine 协同开发。  
本契约采用 TypeScript 接口形式，面向 `src/services/workflow/*` 与 `src/services/omcWorkflowAdapter.ts`。

---

## 2. 分层边界

1. **UI 层**
   - 只调用 `WorkflowFacade`
   - 不直接调用 OMC Adapter、GateEngine

2. **WorkflowEngine 层**
   - 调用 TaskRouter、OmcWorkflowAdapter、GateEngine
   - 负责状态推进与事件落盘

3. **Adapter/Gate 层**
   - 对外返回结构化结果与错误码
   - 不感知具体 UI 组件

---

## 3. 核心类型

```ts
export type WorkflowStage =
  | "split"
  | "clarify"
  | "implement"
  | "verify"
  | "review"
  | "delivery";

export type WorkflowStatus = "running" | "blocked" | "completed" | "failed" | "cancelled";

export type GateType = "build" | "test" | "lint" | "review" | "security";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: WorkflowApiError;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
```

---

## 4. 错误对象与错误码

```ts
export interface WorkflowApiError {
  code: WorkflowApiErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type WorkflowApiErrorCode =
  | "WF_INVALID_INPUT"
  | "WF_WORKFLOW_NOT_FOUND"
  | "WF_STAGE_INVALID_TRANSITION"
  | "WF_TASK_NOT_FOUND"
  | "WF_TASK_ROUTE_FAILED"
  | "WF_TASK_EXEC_FAILED"
  | "WF_TASK_EXEC_ABORTED"
  | "WF_GATE_FAILED"
  | "WF_GATE_TIMEOUT"
  | "WF_PERMISSION_REQUIRED"
  | "WF_PERMISSION_DENIED"
  | "WF_RECOVERY_FAILED"
  | "WF_STORAGE_IO_FAILED"
  | "WF_CONCURRENCY_CONFLICT"
  | "WF_INTERNAL_ERROR";
```

---

## 5. WorkflowFacade（UI 入口）

`WorkflowFacade` 是 UI 唯一依赖接口。

```ts
export interface WorkflowFacade {
  createRun(input: CreateWorkflowRunInput): Promise<ApiResult<WorkflowRunDTO>>;
  getRun(input: GetWorkflowRunInput): Promise<ApiResult<WorkflowRunDTO>>;
  listRuns(input: ListWorkflowRunsInput): Promise<ApiResult<WorkflowRunSummaryDTO[]>>;

  advanceStage(input: AdvanceStageInput): Promise<ApiResult<WorkflowRunDTO>>;
  retryStage(input: RetryStageInput): Promise<ApiResult<WorkflowRunDTO>>;
  cancelRun(input: CancelWorkflowRunInput): Promise<ApiResult<WorkflowRunDTO>>;

  executeTask(input: ExecuteTaskInput): Promise<ApiResult<TaskExecutionRunDTO>>;
  retryTask(input: RetryTaskInput): Promise<ApiResult<TaskExecutionRunDTO>>;
  abortTaskRun(input: AbortTaskRunInput): Promise<ApiResult<TaskExecutionRunDTO>>;
  markTaskBlocked(input: MarkTaskBlockedInput): Promise<ApiResult<TaskStateDTO>>;
  markTaskDone(input: MarkTaskDoneInput): Promise<ApiResult<TaskStateDTO>>;

  runGateChecks(input: RunGateChecksInput): Promise<ApiResult<GateCheckBatchDTO>>;
  respondPermission(input: RespondPermissionInput): Promise<ApiResult<PermissionDecisionDTO>>;
  respondQuestion(input: RespondQuestionInput): Promise<ApiResult<QuestionDecisionDTO>>;

  replayEvents(input: ReplayEventsInput): Promise<ApiResult<WorkflowRunDTO>>;
}
```

---

## 6. 输入输出 DTO 契约

## 6.1 Run 生命周期

```ts
export interface CreateWorkflowRunInput {
  sessionId: string;
  repositoryPath: string;
  taskSnapshotId: string;
  startStage?: WorkflowStage; // default: split
  routingPolicyId?: string;
}

export interface GetWorkflowRunInput {
  workflowRunId: string;
}

export interface ListWorkflowRunsInput {
  repositoryPath?: string;
  status?: WorkflowStatus;
  limit?: number; // default 50
}
```

```ts
export interface WorkflowRunDTO {
  workflowRunId: string;
  sessionId: string;
  repositoryPath: string;
  currentStage: WorkflowStage;
  status: WorkflowStatus;
  startedAt: number;
  updatedAt: number;
  stageStates: StageStateDTO[];
  tasks: TaskStateDTO[];
}

export interface WorkflowRunSummaryDTO {
  workflowRunId: string;
  sessionId: string;
  repositoryPath: string;
  currentStage: WorkflowStage;
  status: WorkflowStatus;
  updatedAt: number;
}
```

## 6.2 Stage 控制

```ts
export interface AdvanceStageInput {
  workflowRunId: string;
  fromStage: WorkflowStage;
  toStage: WorkflowStage;
  reason?: string;
  force?: boolean; // default false，true 仅管理员模式允许
}

export interface RetryStageInput {
  workflowRunId: string;
  stage: WorkflowStage;
  reason?: string;
}

export interface CancelWorkflowRunInput {
  workflowRunId: string;
  reason?: string;
}
```

## 6.3 Task 执行

```ts
export interface ExecuteTaskInput {
  workflowRunId: string;
  taskId: string;
  templateId?: string; // 为空时由 router 决定
  subagentType?: string;
  attemptFrom?: number; // default: auto +1
  dryRun?: boolean; // default false
}

export interface RetryTaskInput {
  workflowRunId: string;
  taskId: string;
  previousTaskRunId: string;
  reason?: string;
  templateOverride?: string;
}

export interface AbortTaskRunInput {
  workflowRunId: string;
  taskId: string;
  taskRunId: string;
  reason?: string;
}

export interface MarkTaskBlockedInput {
  workflowRunId: string;
  taskId: string;
  blockerType: "dependency" | "permission" | "environment" | "logic" | "unknown";
  message: string;
}

export interface MarkTaskDoneInput {
  workflowRunId: string;
  taskId: string;
  evidenceRefs: string[];
  manualOverride?: boolean; // default false
}
```

```ts
export interface TaskStateDTO {
  taskId: string;
  flowStatus: "todo" | "in_progress" | "blocked" | "pending_review" | "done" | "cancelled";
  runState: "idle" | "queued" | "running" | "succeeded" | "failed" | "aborted";
  latestTaskRunId?: string;
  latestError?: string;
  gateSummary: {
    required: GateType[];
    passed: GateType[];
    failed: GateType[];
  };
  updatedAt: number;
}

export interface TaskExecutionRunDTO {
  taskRunId: string;
  workflowRunId: string;
  taskId: string;
  templateId: string;
  attempt: number;
  status: "running" | "succeeded" | "failed" | "aborted";
  startedAt: number;
  endedAt?: number;
  artifactRefs: string[];
}
```

## 6.4 Gate 接口

```ts
export interface RunGateChecksInput {
  workflowRunId: string;
  stage?: WorkflowStage;
  taskId?: string;
  gateTypes?: GateType[]; // default: 根据模板和阶段自动计算
}
```

```ts
export interface GateCheckDTO {
  gateType: GateType;
  passed: boolean;
  durationMs: number;
  message?: string;
  evidenceRefs: string[];
}

export interface GateCheckBatchDTO {
  workflowRunId: string;
  stage?: WorkflowStage;
  taskId?: string;
  checks: GateCheckDTO[];
  allPassed: boolean;
  checkedAt: number;
}
```

## 6.5 人机交互响应

```ts
export interface RespondPermissionInput {
  workflowRunId: string;
  sessionId: string;
  requestId: string;
  response: "allow_once" | "allow_always" | "deny";
}

export interface RespondQuestionInput {
  workflowRunId: string;
  sessionId: string;
  requestId: string;
  answers: string[];
  customAnswer?: string;
}
```

```ts
export interface PermissionDecisionDTO {
  requestId: string;
  applied: boolean;
  response: "allow_once" | "allow_always" | "deny";
  decidedAt: number;
}

export interface QuestionDecisionDTO {
  requestId: string;
  applied: boolean;
  decidedAt: number;
}
```

## 6.6 恢复与回放

```ts
export interface ReplayEventsInput {
  workflowRunId: string;
  fromTimestamp?: number;
  untilTimestamp?: number;
}
```

---

## 7. 引擎内部接口契约

## 7.1 WorkflowEngine

```ts
export interface WorkflowEngine {
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunDTO>;
  advanceStage(input: AdvanceStageInput): Promise<WorkflowRunDTO>;
  retryStage(input: RetryStageInput): Promise<WorkflowRunDTO>;
  cancelRun(input: CancelWorkflowRunInput): Promise<WorkflowRunDTO>;
  replay(input: ReplayEventsInput): Promise<WorkflowRunDTO>;
}
```

## 7.2 TaskRouter

```ts
export interface TaskRouter {
  routeTask(input: {
    workflowRunId: string;
    taskId: string;
  }): Promise<{
    templateId: string;
    subagentType?: string;
    gatePlan: GateType[];
    priority: number;
    rationale: string[];
  }>;
}
```

## 7.3 OmcWorkflowAdapter

```ts
export interface OmcWorkflowAdapter {
  execute(input: {
    workflowRunId: string;
    taskId: string;
    templateId: string;
    subagentType?: string;
    attempt: number;
  }): Promise<{
    status: "succeeded" | "failed" | "aborted";
    artifactRefs: string[];
    summary?: string;
    error?: WorkflowApiError;
  }>;
}
```

## 7.4 GateEngine

```ts
export interface GateEngine {
  runChecks(input: RunGateChecksInput): Promise<GateCheckBatchDTO>;
}
```

---

## 8. 并发与一致性语义

1. 同一 `workflowRunId` 的 stage 变更串行执行
2. 不同任务可并行执行，但同一 `taskId` 仅允许一个 `running` 任务实例
3. `advanceStage` 若存在必需 gate 未通过，返回 `WF_GATE_FAILED`
4. 若检测到并发修改（乐观锁版本不匹配），返回 `WF_CONCURRENCY_CONFLICT`

建议增加版本字段：

```ts
interface VersionedEntity {
  version: number;
}
```

写入前校验 `expectedVersion`。

---

## 9. 幂等语义

1. `createRun`：同 `sessionId + taskSnapshotId` 重复创建返回同一 run
2. `respondPermission`：同 `requestId` 第二次响应返回首个结果，不重复下发
3. `abortTaskRun`：已终态任务运行再次中止应返回成功且无副作用
4. `markTaskDone`：重复调用不应重复触发 stage 推进

---

## 10. 时序约束（关键流程）

## 10.1 任务执行时序

1. `executeTask`
2. `task.routed`（若首次）
3. `task.run.started`
4. `tool.call.*` / `permission.*` / `question.*`（可选）
5. `task.run.succeeded|failed|aborted`
6. `runGateChecks`（自动或手动）
7. `task.status.changed`

## 10.2 阶段推进时序

1. `runGateChecks(stage=当前阶段)`
2. 若 `allPassed=true` 才允许 `advanceStage`
3. `stage.succeeded` + `stage.entered(next)`

---

## 11. 持久化接口契约

```ts
export interface WorkflowStore {
  saveRun(run: WorkflowRunDTO): Promise<void>;
  loadRun(workflowRunId: string): Promise<WorkflowRunDTO | null>;
  appendEvent(event: unknown): Promise<void>;
  listEvents(workflowRunId: string, options?: { from?: number; until?: number }): Promise<unknown[]>;
}
```

错误映射：

- IO 失败 -> `WF_STORAGE_IO_FAILED`
- JSON 解析失败 -> `WF_RECOVERY_FAILED`

---

## 12. 与现有模块对接点

1. `src/components/ClaudeSessions/*`
   - 调用 `WorkflowFacade` 获取轨道、任务、证据状态

2. `src/notifications/streamIngest.ts`
   - 解析到 permission/question/tool 事件后，转发到事件总线

3. `src/hooks/usePrdTaskSplit.ts`
   - 拆分完成后触发 `createRun` 并初始化路由

4. `src/services/claude.ts`
   - 保持现有能力，不直接承载编排逻辑，由 Adapter 调用

---

## 13. 测试契约

### 13.1 单元测试

- `WorkflowEngine` 状态转换合法性
- `TaskRouter` 路由稳定性
- `GateEngine` 规则正确性
- 幂等与并发冲突处理

### 13.2 集成测试

- 从 `createRun` 到 `delivery` 的全流程
- 包含 permission deny、question response、task retry 场景
- 崩溃后 `replayEvents` 恢复一致性

### 13.3 合同测试（Contract Test）

对 `WorkflowFacade` 每个方法校验：

- 入参非法 -> 正确错误码
- 成功响应 -> DTO 字段完整
- 重复请求 -> 幂等符合预期

---

## 14. 发布门槛

1. 所有公开 API 都有类型、错误码、测试覆盖
2. 关键接口（executeTask/advanceStage/runGateChecks/respondPermission）合同测试通过
3. 文档与实现一致（抽样校验 10+ 接口）

