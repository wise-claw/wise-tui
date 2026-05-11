import type {
  AbortTaskRunInput,
  AdvanceStageInput,
  ApiResult,
  CancelWorkflowRunInput,
  CreateWorkflowRunInput,
  ExecuteTaskInput,
  GateCheckBatchDTO,
  GetWorkflowRunInput,
  ListWorkflowRunsInput,
  ListWorkflowEventsInput,
  MarkTaskBlockedInput,
  MarkTaskDoneInput,
  UpsertWorkflowTasksInput,
  PermissionDecisionDTO,
  ReplayEventsInput,
  RespondPermissionInput,
  RespondQuestionInput,
  RunGateChecksInput,
  RetryStageInput,
  RetryTaskInput,
  TaskExecutionRunDTO,
  TaskStateDTO,
  WorkflowApiError,
  WorkflowEngine,
  WorkflowEventEnvelope,
  WorkflowFacade,
  WorkflowRunDTO,
  WorkflowRunSummaryDTO,
  QuestionDecisionDTO,
} from "../../types/workflow";

function asError(err: unknown): WorkflowApiError {
  if (err instanceof Error) {
    const code = err.message.startsWith("WF_") ? err.message : "WF_INTERNAL_ERROR";
    return { code: code as WorkflowApiError["code"], message: err.message, retryable: code !== "WF_INVALID_INPUT" };
  }
  return { code: "WF_INTERNAL_ERROR", message: String(err), retryable: true };
}

async function wrap<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: asError(err) };
  }
}

export class DefaultWorkflowFacade implements WorkflowFacade {
  constructor(private readonly engine: WorkflowEngine) {}

  createRun(input: CreateWorkflowRunInput): Promise<ApiResult<WorkflowRunDTO>> {
    return wrap(() => this.engine.createRun(input));
  }
  getRun(input: GetWorkflowRunInput): Promise<ApiResult<WorkflowRunDTO>> {
    return wrap(() => this.engine.getRun(input));
  }
  listRuns(input: ListWorkflowRunsInput): Promise<ApiResult<WorkflowRunSummaryDTO[]>> {
    return wrap(() => this.engine.listRuns(input));
  }
  advanceStage(input: AdvanceStageInput): Promise<ApiResult<WorkflowRunDTO>> {
    return wrap(() => this.engine.advanceStage(input));
  }
  retryStage(input: RetryStageInput): Promise<ApiResult<WorkflowRunDTO>> {
    return wrap(() => this.engine.retryStage(input));
  }
  cancelRun(input: CancelWorkflowRunInput): Promise<ApiResult<WorkflowRunDTO>> {
    return wrap(() => this.engine.cancelRun(input));
  }
  executeTask(input: ExecuteTaskInput): Promise<ApiResult<TaskExecutionRunDTO>> {
    return wrap(() => this.engine.executeTask(input));
  }
  retryTask(input: RetryTaskInput): Promise<ApiResult<TaskExecutionRunDTO>> {
    return wrap(() => this.engine.retryTask(input));
  }
  abortTaskRun(input: AbortTaskRunInput): Promise<ApiResult<TaskExecutionRunDTO>> {
    return wrap(() => this.engine.abortTaskRun(input));
  }
  markTaskBlocked(input: MarkTaskBlockedInput): Promise<ApiResult<TaskStateDTO>> {
    return wrap(() => this.engine.markTaskBlocked(input));
  }
  markTaskDone(input: MarkTaskDoneInput): Promise<ApiResult<TaskStateDTO>> {
    return wrap(() => this.engine.markTaskDone(input));
  }
  upsertTasks(input: UpsertWorkflowTasksInput): Promise<ApiResult<WorkflowRunDTO>> {
    return wrap(() => this.engine.upsertTasks(input));
  }
  runGateChecks(input: RunGateChecksInput): Promise<ApiResult<GateCheckBatchDTO>> {
    return wrap(() => this.engine.runGateChecks(input));
  }
  listEvents(input: ListWorkflowEventsInput): Promise<ApiResult<WorkflowEventEnvelope[]>> {
    return wrap(() => this.engine.listEvents(input));
  }
  respondPermission(input: RespondPermissionInput): Promise<ApiResult<PermissionDecisionDTO>> {
    return wrap(async () => ({
      requestId: input.requestId,
      applied: true,
      response: input.response,
      decidedAt: Date.now(),
    }));
  }
  respondQuestion(input: RespondQuestionInput): Promise<ApiResult<QuestionDecisionDTO>> {
    return wrap(async () => ({
      requestId: input.requestId,
      applied: true,
      decidedAt: Date.now(),
    }));
  }
  replayEvents(input: ReplayEventsInput): Promise<ApiResult<WorkflowRunDTO>> {
    return wrap(() => this.engine.replay(input));
  }
}

