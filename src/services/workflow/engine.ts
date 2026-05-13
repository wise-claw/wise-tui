import type {
  AbortTaskRunInput,
  AdvanceStageInput,
  CancelWorkflowRunInput,
  CreateWorkflowRunInput,
  ExecuteTaskInput,
  GateCheckBatchDTO,
  GateEngine,
  GetWorkflowRunInput,
  ListWorkflowRunsInput,
  ListWorkflowEventsInput,
  MarkTaskBlockedInput,
  MarkTaskDoneInput,
  OmcWorkflowAdapter,
  ReplayEventsInput,
  RetryStageInput,
  RetryTaskInput,
  RunGateChecksInput,
  TaskExecutionRunDTO,
  TaskRouter,
  TaskStateDTO,
  UpsertWorkflowTasksInput,
  WorkflowEngine,
  WorkflowEventEnvelope,
  WorkflowRunDTO,
  WorkflowStore,
} from "../../types/workflow";
import { DefaultAdapterRegistry, type AdapterRegistry } from "./adapterRegistry";
import { replayWorkflowRun } from "./replay";

const STAGE_ORDER = ["split", "clarify", "implement", "verify", "review", "delivery"] as const;

function gatePlanForTemplate(templateId: string): GateCheckBatchDTO["checks"][number]["gateType"][] {
  switch (templateId) {
    case "verify":
      return ["review", "test"];
    case "ultraqa":
      return ["test", "lint", "review"];
    case "team":
      return ["build", "test", "review"];
    case "trellis":
      return ["test", "review"];
    case "autopilot":
    default:
      return ["build", "test"];
  }
}

function createEvent(run: WorkflowRunDTO, eventType: WorkflowEventEnvelope["eventType"], payload: Record<string, unknown>): WorkflowEventEnvelope {
  return {
    eventId: crypto.randomUUID(),
    eventType,
    schemaVersion: 1,
    sessionId: run.sessionId,
    workflowRunId: run.workflowRunId,
    repositoryPath: run.repositoryPath,
    timestamp: Date.now(),
    source: "workflow_engine",
    payload,
  };
}

function defaultTask(taskId: string): TaskStateDTO {
  return {
    taskId,
    flowStatus: "todo",
    runState: "idle",
    artifactRefs: [],
    gateSummary: { required: [], passed: [], failed: [] },
    updatedAt: Date.now(),
  };
}

function extractOmcCommandFromArtifacts(artifactRefs: string[]): string | undefined {
  const cmdRef = artifactRefs.find((ref) => ref.startsWith("omc-command://"));
  if (!cmdRef) return undefined;
  return `/${cmdRef.replace("omc-command://", "")}`;
}

function artifactTypeFromRef(ref: string): string {
  const idx = ref.indexOf("://");
  return idx > 0 ? ref.slice(0, idx) : "unknown";
}

function normalizeRun(run: WorkflowRunDTO): { run: WorkflowRunDTO; changed: boolean } {
  let changed = false;
  const tasks = run.tasks.map((task) => {
    if (Array.isArray(task.artifactRefs)) return task;
    changed = true;
    return { ...task, artifactRefs: [] };
  });
  return {
    run: changed ? { ...run, tasks } : run,
    changed,
  };
}

function ensureNextStage(fromStage: string, toStage: string): boolean {
  const fromIdx = STAGE_ORDER.indexOf(fromStage as (typeof STAGE_ORDER)[number]);
  const toIdx = STAGE_ORDER.indexOf(toStage as (typeof STAGE_ORDER)[number]);
  return fromIdx >= 0 && toIdx === fromIdx + 1;
}

export class DefaultWorkflowEngine implements WorkflowEngine {
  private readonly adapterRegistry: AdapterRegistry;

  constructor(
    private readonly store: WorkflowStore,
    private readonly taskRouter: TaskRouter,
    omcAdapter: OmcWorkflowAdapter,
    private readonly gateEngine: GateEngine,
    adapterRegistry?: AdapterRegistry,
  ) {
    this.adapterRegistry = adapterRegistry ?? DefaultAdapterRegistry.of(omcAdapter);
  }

  async createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunDTO> {
    const now = Date.now();
    const run: WorkflowRunDTO = {
      workflowRunId: crypto.randomUUID(),
      sessionId: input.sessionId,
      repositoryPath: input.repositoryPath,
      currentStage: input.startStage ?? "split",
      status: "running",
      startedAt: now,
      updatedAt: now,
      stageStates: STAGE_ORDER.map((stage) => ({
        stage,
        status: stage === (input.startStage ?? "split") ? "running" : "idle",
        owner: "agent",
        startedAt: stage === (input.startStage ?? "split") ? now : undefined,
        errors: [],
        retryCount: 0,
      })),
      tasks: [],
      taskSnapshotId: input.taskSnapshotId,
      routingPolicyId: input.routingPolicyId,
    };
    await this.store.saveRun(run);
    await this.store.appendEvent(createEvent(run, "workflow.created", { currentStage: run.currentStage, status: run.status }));
    return run;
  }

  async getRun(input: GetWorkflowRunInput): Promise<WorkflowRunDTO> {
    const run = await this.store.loadRun(input.workflowRunId);
    if (!run) throw new Error("WF_WORKFLOW_NOT_FOUND");
    const normalized = normalizeRun(run);
    if (normalized.changed) {
      await this.store.saveRun(normalized.run);
    }
    return normalized.run;
  }

  async listRuns(input: ListWorkflowRunsInput) {
    const runs = await this.store.listRuns();
    return runs
      .filter((run) => (input.repositoryPath ? run.repositoryPath === input.repositoryPath : true))
      .filter((run) => (input.status ? run.status === input.status : true))
      .slice(0, input.limit ?? 50)
      .map((run) => ({
        workflowRunId: run.workflowRunId,
        sessionId: run.sessionId,
        repositoryPath: run.repositoryPath,
        currentStage: run.currentStage,
        status: run.status,
        updatedAt: run.updatedAt,
      }));
  }

  async advanceStage(input: AdvanceStageInput): Promise<WorkflowRunDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    if (run.currentStage !== input.fromStage) throw new Error("WF_STAGE_INVALID_TRANSITION");
    if (!input.force && !ensureNextStage(input.fromStage, input.toStage)) throw new Error("WF_STAGE_INVALID_TRANSITION");

    const now = Date.now();
    const next: WorkflowRunDTO = {
      ...run,
      currentStage: input.toStage,
      updatedAt: now,
      stageStates: run.stageStates.map((stage) => {
        if (stage.stage === input.fromStage) {
          return { ...stage, status: "succeeded", endedAt: now };
        }
        if (stage.stage === input.toStage) {
          return { ...stage, status: "running", startedAt: stage.startedAt ?? now };
        }
        return stage;
      }),
    };
    await this.store.saveRun(next);
    await this.store.appendEvent(createEvent(next, "stage.entered", { stage: input.toStage, reason: input.reason ?? "" }));
    return next;
  }

  async retryStage(input: RetryStageInput): Promise<WorkflowRunDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const now = Date.now();
    const next: WorkflowRunDTO = {
      ...run,
      updatedAt: now,
      stageStates: run.stageStates.map((stage) =>
        stage.stage === input.stage
          ? { ...stage, status: "running", retryCount: stage.retryCount + 1, startedAt: now, endedAt: undefined }
          : stage,
      ),
    };
    await this.store.saveRun(next);
    await this.store.appendEvent(createEvent(next, "stage.retried", { stage: input.stage, reason: input.reason ?? "" }));
    return next;
  }

  async cancelRun(input: CancelWorkflowRunInput): Promise<WorkflowRunDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const next = { ...run, status: "cancelled" as const, updatedAt: Date.now() };
    await this.store.saveRun(next);
    await this.store.appendEvent(createEvent(next, "workflow.failed", { reason: input.reason ?? "cancelled" }));
    return next;
  }

  async executeTask(input: ExecuteTaskInput): Promise<TaskExecutionRunDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const task = run.tasks.find((t) => t.taskId === input.taskId) ?? defaultTask(input.taskId);
    const routed = input.templateId
      ? {
          templateId: input.templateId,
          subagentType: input.subagentType,
          executionMetadata: input.executionMetadata,
          gatePlan: task.gateSummary.required.length > 0 ? task.gateSummary.required : gatePlanForTemplate(input.templateId),
          priority: 50,
          rationale: ["manual override"],
        }
      : await this.taskRouter.routeTask({ workflowRunId: input.workflowRunId, taskId: input.taskId });
    const attempt = input.attemptFrom ?? 1;
    const startedAt = Date.now();
    const taskRunId = crypto.randomUUID();

    await this.store.appendEvent(createEvent(run, "task.routed", { taskId: input.taskId, ...routed }));
    await this.store.appendEvent(
      createEvent(run, "task.run.started", {
        taskId: input.taskId,
        taskRunId,
        attempt,
        templateId: routed.templateId,
        subagentType: routed.subagentType,
        metadata: routed.executionMetadata ?? {},
      }),
    );
    await this.store.appendEvent(
      createEvent(run, "task.run.progressed", {
        taskId: input.taskId,
        taskRunId,
        stage: "adapter.execute.started",
        templateId: routed.templateId,
        subagentType: routed.subagentType ?? "executor",
        metadata: routed.executionMetadata ?? {},
      }),
    );

    const adapter = this.adapterRegistry.resolve(routed.templateId);
    const execution = await adapter.execute({
      workflowRunId: input.workflowRunId,
      repositoryPath: run.repositoryPath,
      sessionId: run.sessionId,
      taskId: input.taskId,
      templateId: routed.templateId,
      subagentType: routed.subagentType,
      executionMetadata: routed.executionMetadata,
      attempt,
    });
    const endedAt = Date.now();
    const status = execution.status;
    const artifactRecords =
      execution.artifactRecords?.length && execution.artifactRecords.length > 0
        ? execution.artifactRecords
        : execution.artifactRefs.map((ref) => ({
            ref,
            artifactType: artifactTypeFromRef(ref),
            label: undefined,
            metadata: undefined,
          }));

    if (execution.progressSignals?.length) {
      for (const signal of execution.progressSignals) {
        await this.store.appendEvent(
          createEvent(run, "task.run.progressed", {
            taskId: input.taskId,
            taskRunId,
            stage: signal.stage,
            message: signal.message,
            level: signal.level ?? "info",
            templateId: routed.templateId,
            subagentType: routed.subagentType ?? "executor",
            metadata: signal.metadata ?? {},
          }),
        );
      }
    }

    await this.store.appendEvent(
      createEvent(run, status === "succeeded" ? "task.run.succeeded" : status === "aborted" ? "task.run.aborted" : "task.run.failed", {
        taskId: input.taskId,
        taskRunId,
        attempt,
        templateId: routed.templateId,
        omcCommand: extractOmcCommandFromArtifacts(execution.artifactRefs),
        summary: execution.summary ?? "",
        error: execution.error?.message ?? "",
        artifactRefs: execution.artifactRefs,
      }),
    );
    for (const artifact of artifactRecords) {
      await this.store.appendEvent(
        createEvent(run, "artifact.recorded", {
          taskId: input.taskId,
          taskRunId,
          artifactRef: artifact.ref,
          templateId: routed.templateId,
          artifactType: artifact.artifactType ?? artifactTypeFromRef(artifact.ref),
          artifactLabel: artifact.label ?? "",
          metadata: artifact.metadata ?? {},
        }),
      );
    }

    const nextTask: TaskStateDTO = {
      ...task,
      runState: status === "succeeded" ? "succeeded" : status === "aborted" ? "aborted" : "failed",
      flowStatus: status === "succeeded" ? "pending_review" : "blocked",
      latestTaskRunId: taskRunId,
      latestError: execution.error?.message,
      latestSummary: execution.summary,
      latestTemplateId: routed.templateId,
      latestOmcCommand: extractOmcCommandFromArtifacts(execution.artifactRefs),
      latestAttempt: attempt,
      artifactRefs: execution.artifactRefs,
      gateSummary: {
        required: routed.gatePlan,
        passed: task.gateSummary.passed,
        failed: task.gateSummary.failed,
      },
      updatedAt: endedAt,
    };
    const nextRun: WorkflowRunDTO = {
      ...run,
      updatedAt: endedAt,
      tasks: run.tasks.some((t) => t.taskId === input.taskId)
        ? run.tasks.map((t) => (t.taskId === input.taskId ? nextTask : t))
        : [...run.tasks, nextTask],
    };
    await this.store.saveRun(nextRun);
    return {
      taskRunId,
      workflowRunId: input.workflowRunId,
      taskId: input.taskId,
      templateId: routed.templateId,
      attempt,
      status: status === "succeeded" ? "succeeded" : status === "aborted" ? "aborted" : "failed",
      startedAt,
      endedAt,
      artifactRefs: execution.artifactRefs,
    };
  }

  async retryTask(input: RetryTaskInput): Promise<TaskExecutionRunDTO> {
    const events = await this.store.listEvents(input.workflowRunId);
    const prevAttempt = events
      .filter((event) => event.eventType === "task.run.started")
      .map((event) => event.payload as { taskId?: string; attempt?: number })
      .filter((payload) => payload.taskId === input.taskId)
      .reduce((maxAttempt, payload) => Math.max(maxAttempt, payload.attempt ?? 0), 0);
    return this.executeTask({
      workflowRunId: input.workflowRunId,
      taskId: input.taskId,
      attemptFrom: Math.max(1, prevAttempt + 1),
      templateId: input.templateOverride,
    });
  }

  async abortTaskRun(input: AbortTaskRunInput): Promise<TaskExecutionRunDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    await this.store.appendEvent(
      createEvent(run, "task.run.aborted", { taskId: input.taskId, taskRunId: input.taskRunId, reason: input.reason ?? "" }),
    );
    return {
      taskRunId: input.taskRunId,
      workflowRunId: input.workflowRunId,
      taskId: input.taskId,
      templateId: "unknown",
      attempt: 0,
      status: "aborted",
      startedAt: Date.now(),
      endedAt: Date.now(),
      artifactRefs: [],
    };
  }

  async markTaskBlocked(input: MarkTaskBlockedInput): Promise<TaskStateDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const now = Date.now();
    const current = run.tasks.find((task) => task.taskId === input.taskId) ?? defaultTask(input.taskId);
    const nextTask = { ...current, flowStatus: "blocked" as const, latestError: input.message, updatedAt: now };
    const nextRun = {
      ...run,
      updatedAt: now,
      tasks: run.tasks.some((task) => task.taskId === input.taskId)
        ? run.tasks.map((task) => (task.taskId === input.taskId ? nextTask : task))
        : [...run.tasks, nextTask],
    };
    await this.store.saveRun(nextRun);
    await this.store.appendEvent(
      createEvent(nextRun, "task.status.changed", { taskId: input.taskId, from: current.flowStatus, to: "blocked", reason: input.message }),
    );
    return nextTask;
  }

  async markTaskDone(input: MarkTaskDoneInput): Promise<TaskStateDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const now = Date.now();
    const current = run.tasks.find((task) => task.taskId === input.taskId) ?? defaultTask(input.taskId);
    const nextTask = {
      ...current,
      flowStatus: "done" as const,
      artifactRefs: Array.from(new Set([...current.artifactRefs, ...input.evidenceRefs])),
      updatedAt: now,
    };
    const nextRun = {
      ...run,
      updatedAt: now,
      tasks: run.tasks.some((task) => task.taskId === input.taskId)
        ? run.tasks.map((task) => (task.taskId === input.taskId ? nextTask : task))
        : [...run.tasks, nextTask],
    };
    await this.store.saveRun(nextRun);
    await this.store.appendEvent(
      createEvent(nextRun, "task.status.changed", { taskId: input.taskId, from: current.flowStatus, to: "done", reason: "manual done" }),
    );
    return nextTask;
  }

  async upsertTasks(input: UpsertWorkflowTasksInput): Promise<WorkflowRunDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const now = Date.now();
    const byId = new Map(run.tasks.map((task) => [task.taskId, task]));
    for (const incoming of input.tasks) {
      const existing = byId.get(incoming.taskId);
      if (existing) {
        byId.set(incoming.taskId, {
          ...existing,
          updatedAt: now,
        });
      } else {
        byId.set(incoming.taskId, {
          ...defaultTask(incoming.taskId),
          flowStatus: "todo",
          runState: "idle",
          updatedAt: now,
        });
      }
    }
    const nextRun: WorkflowRunDTO = {
      ...run,
      updatedAt: now,
      tasks: Array.from(byId.values()),
    };
    await this.store.saveRun(nextRun);
    await this.store.appendEvent(
      createEvent(nextRun, "task.queued", {
        count: input.tasks.length,
        taskIds: input.tasks.map((task) => task.taskId),
      }),
    );
    return nextRun;
  }

  async runGateChecks(input: RunGateChecksInput): Promise<GateCheckBatchDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const result = await this.gateEngine.runChecks(input);
    const now = Date.now();
    if (input.taskId) {
      const nextTasks = run.tasks.map((task) => {
        if (task.taskId !== input.taskId) return task;
        const passed = result.checks.filter((check) => check.passed).map((check) => check.gateType);
        const failed = result.checks.filter((check) => !check.passed).map((check) => check.gateType);
        return {
          ...task,
          gateSummary: {
            required: task.gateSummary.required.length > 0 ? task.gateSummary.required : result.checks.map((check) => check.gateType),
            passed,
            failed,
          },
          updatedAt: now,
        };
      });
      const nextRun: WorkflowRunDTO = { ...run, tasks: nextTasks, updatedAt: now };
      await this.store.saveRun(nextRun);
      await this.store.appendEvent(
        createEvent(nextRun, "gate.check.completed", {
          taskId: input.taskId,
          checks: result.checks,
          allPassed: result.allPassed,
        }),
      );
    } else {
      await this.store.appendEvent(
        createEvent(run, "gate.check.completed", {
          stage: input.stage ?? run.currentStage,
          checks: result.checks,
          allPassed: result.allPassed,
        }),
      );
    }
    return result;
  }

  async listEvents(input: ListWorkflowEventsInput): Promise<WorkflowEventEnvelope[]> {
    const events = await this.store.listEvents(input.workflowRunId, {
      from: input.fromTimestamp,
      until: input.untilTimestamp,
    });
    if (!input.limit || input.limit <= 0) return events;
    return events.slice(Math.max(0, events.length - input.limit));
  }

  async replay(input: ReplayEventsInput): Promise<WorkflowRunDTO> {
    const run = await this.getRun({ workflowRunId: input.workflowRunId });
    const events = await this.store.listEvents(input.workflowRunId, {
      from: input.fromTimestamp,
      until: input.untilTimestamp,
    });
    return replayWorkflowRun(run, events);
  }
}
