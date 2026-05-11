import type { TaskFlowStatus } from "../types";

export type WorkflowStage = "split" | "clarify" | "implement" | "verify" | "review" | "delivery";
export type WorkflowStatus = "running" | "blocked" | "completed" | "failed" | "cancelled";
export type GateType = "build" | "test" | "lint" | "review" | "security";

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

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: WorkflowApiError;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type EventSource =
  | "ui"
  | "workflow_engine"
  | "task_router"
  | "omc_adapter"
  | "gate_engine"
  | "claude_stream"
  | "system";

export type WorkflowEventType =
  | "workflow.created"
  | "workflow.resumed"
  | "workflow.completed"
  | "workflow.failed"
  | "stage.entered"
  | "stage.progressed"
  | "stage.succeeded"
  | "stage.failed"
  | "stage.retried"
  | "task.routed"
  | "task.queued"
  | "task.run.started"
  | "task.run.progressed"
  | "task.run.succeeded"
  | "task.run.failed"
  | "task.run.aborted"
  | "task.status.changed"
  | "gate.check.started"
  | "gate.check.completed"
  | "gate.check.failed"
  | "permission.requested"
  | "permission.responded"
  | "question.requested"
  | "question.responded"
  | "human.takeover.started"
  | "human.takeover.ended"
  | "tool.call.started"
  | "tool.call.completed"
  | "tool.call.failed"
  | "artifact.recorded"
  | "recovery.started"
  | "recovery.completed"
  | "recovery.failed";

export interface WorkflowEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  eventType: WorkflowEventType;
  schemaVersion: 1;
  sessionId: string;
  workflowRunId: string;
  repositoryPath: string;
  timestamp: number;
  source: EventSource;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
}

export interface StageStateDTO {
  stage: WorkflowStage;
  status: "idle" | "running" | "succeeded" | "failed";
  owner: "system" | "agent" | "human";
  startedAt?: number;
  endedAt?: number;
  errors: string[];
  retryCount: number;
}

export interface TaskStateDTO {
  taskId: string;
  flowStatus: TaskFlowStatus;
  runState: "idle" | "queued" | "running" | "succeeded" | "failed" | "aborted";
  latestTaskRunId?: string;
  latestError?: string;
  latestSummary?: string;
  latestTemplateId?: string;
  latestOmcCommand?: string;
  latestAttempt?: number;
  artifactRefs: string[];
  gateSummary: {
    required: GateType[];
    passed: GateType[];
    failed: GateType[];
  };
  updatedAt: number;
}

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
  taskSnapshotId: string;
  routingPolicyId?: string;
}

export interface WorkflowRunSummaryDTO {
  workflowRunId: string;
  sessionId: string;
  repositoryPath: string;
  currentStage: WorkflowStage;
  status: WorkflowStatus;
  updatedAt: number;
}

export interface CreateWorkflowRunInput {
  sessionId: string;
  repositoryPath: string;
  taskSnapshotId: string;
  startStage?: WorkflowStage;
  routingPolicyId?: string;
}

export interface GetWorkflowRunInput {
  workflowRunId: string;
}

export interface ListWorkflowRunsInput {
  repositoryPath?: string;
  status?: WorkflowStatus;
  limit?: number;
}

export interface ListWorkflowEventsInput {
  workflowRunId: string;
  fromTimestamp?: number;
  untilTimestamp?: number;
  limit?: number;
}

export interface AdvanceStageInput {
  workflowRunId: string;
  fromStage: WorkflowStage;
  toStage: WorkflowStage;
  reason?: string;
  force?: boolean;
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

export interface ExecuteTaskInput {
  workflowRunId: string;
  taskId: string;
  templateId?: string;
  subagentType?: string;
  attemptFrom?: number;
  dryRun?: boolean;
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
  manualOverride?: boolean;
}

export interface UpsertWorkflowTasksInput {
  workflowRunId: string;
  tasks: Array<{
    taskId: string;
    title?: string;
    dependencies?: string[];
  }>;
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

export interface RunGateChecksInput {
  workflowRunId: string;
  stage?: WorkflowStage;
  taskId?: string;
  gateTypes?: GateType[];
}

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

export interface ReplayEventsInput {
  workflowRunId: string;
  fromTimestamp?: number;
  untilTimestamp?: number;
}

export interface WorkflowStore {
  saveRun(run: WorkflowRunDTO): Promise<void>;
  loadRun(workflowRunId: string): Promise<WorkflowRunDTO | null>;
  listRuns(): Promise<WorkflowRunDTO[]>;
  appendEvent(event: WorkflowEventEnvelope): Promise<void>;
  listEvents(workflowRunId: string, options?: { from?: number; until?: number }): Promise<WorkflowEventEnvelope[]>;
}

export interface TaskRouter {
  routeTask(input: { workflowRunId: string; taskId: string }): Promise<{
    templateId: string;
    subagentType?: string;
    gatePlan: GateType[];
    priority: number;
    rationale: string[];
  }>;
}

export interface OmcWorkflowAdapter {
  execute(input: {
    workflowRunId: string;
    repositoryPath: string;
    sessionId: string;
    taskId: string;
    templateId: string;
    subagentType?: string;
    attempt: number;
  }): Promise<{
    status: "succeeded" | "failed" | "aborted";
    artifactRefs: string[];
    progressSignals?: Array<{
      stage: string;
      message: string;
      level?: "info" | "warning" | "error";
      metadata?: Record<string, unknown>;
    }>;
    artifactRecords?: Array<{
      ref: string;
      artifactType?: string;
      label?: string;
      metadata?: Record<string, unknown>;
    }>;
    summary?: string;
    error?: WorkflowApiError;
  }>;
}

export interface GateEngine {
  runChecks(input: RunGateChecksInput): Promise<GateCheckBatchDTO>;
}

export interface WorkflowEngine {
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunDTO>;
  getRun(input: GetWorkflowRunInput): Promise<WorkflowRunDTO>;
  listRuns(input: ListWorkflowRunsInput): Promise<WorkflowRunSummaryDTO[]>;
  advanceStage(input: AdvanceStageInput): Promise<WorkflowRunDTO>;
  retryStage(input: RetryStageInput): Promise<WorkflowRunDTO>;
  cancelRun(input: CancelWorkflowRunInput): Promise<WorkflowRunDTO>;
  executeTask(input: ExecuteTaskInput): Promise<TaskExecutionRunDTO>;
  retryTask(input: RetryTaskInput): Promise<TaskExecutionRunDTO>;
  abortTaskRun(input: AbortTaskRunInput): Promise<TaskExecutionRunDTO>;
  markTaskBlocked(input: MarkTaskBlockedInput): Promise<TaskStateDTO>;
  markTaskDone(input: MarkTaskDoneInput): Promise<TaskStateDTO>;
  upsertTasks(input: UpsertWorkflowTasksInput): Promise<WorkflowRunDTO>;
  runGateChecks(input: RunGateChecksInput): Promise<GateCheckBatchDTO>;
  listEvents(input: ListWorkflowEventsInput): Promise<WorkflowEventEnvelope[]>;
  replay(input: ReplayEventsInput): Promise<WorkflowRunDTO>;
}

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
  upsertTasks(input: UpsertWorkflowTasksInput): Promise<ApiResult<WorkflowRunDTO>>;
  runGateChecks(input: RunGateChecksInput): Promise<ApiResult<GateCheckBatchDTO>>;
  listEvents(input: ListWorkflowEventsInput): Promise<ApiResult<WorkflowEventEnvelope[]>>;
  respondPermission(input: RespondPermissionInput): Promise<ApiResult<PermissionDecisionDTO>>;
  respondQuestion(input: RespondQuestionInput): Promise<ApiResult<QuestionDecisionDTO>>;
  replayEvents(input: ReplayEventsInput): Promise<ApiResult<WorkflowRunDTO>>;
}

