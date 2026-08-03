import { describe, expect, test } from "bun:test";
import type {
  GateCheckBatchDTO,
  GateEngine,
  GateType,
  ListWorkflowRunsInput,
  OmcWorkflowAdapter,
  RunGateChecksInput,
  TaskRouter,
  TrellisExecutionMetadata,
  WorkflowEventEnvelope,
  WorkflowRunDTO,
  WorkflowStatus,
  WorkflowStore,
} from "../../types/workflow";
import { DefaultWorkflowEngine } from "./engine";

class MemoryWorkflowStore implements WorkflowStore {
  private runs = new Map<string, WorkflowRunDTO>();
  private events = new Map<string, WorkflowEventEnvelope[]>();

  async saveRun(run: WorkflowRunDTO): Promise<void> {
    this.runs.set(run.workflowRunId, run);
  }

  async loadRun(workflowRunId: string): Promise<WorkflowRunDTO | null> {
    return this.runs.get(workflowRunId) ?? null;
  }

  public lastListRunsInput: ListWorkflowRunsInput | undefined;

  async listRuns(input?: ListWorkflowRunsInput): Promise<WorkflowRunDTO[]> {
    this.lastListRunsInput = input;
    return Array.from(this.runs.values());
  }

  async appendEvent(event: WorkflowEventEnvelope): Promise<void> {
    const list = this.events.get(event.workflowRunId) ?? [];
    list.push(event);
    this.events.set(event.workflowRunId, list);
  }

  async listEvents(workflowRunId: string): Promise<WorkflowEventEnvelope[]> {
    return this.events.get(workflowRunId) ?? [];
  }
}

class TestTaskRouter implements TaskRouter {
  async routeTask(_: { workflowRunId: string; taskId: string }) {
    const gatePlan: GateType[] = ["build", "test"];
    return {
      templateId: "autopilot",
      subagentType: "executor",
      gatePlan,
      priority: 10,
      rationale: ["test route"],
    };
  }
}

class TestOmcAdapter implements OmcWorkflowAdapter {
  public latestInput:
    | {
        workflowRunId: string;
        repositoryPath: string;
        sessionId: string;
        taskId: string;
        templateId: string;
        subagentType?: string;
        executionMetadata?: TrellisExecutionMetadata;
        attempt: number;
      }
    | null = null;

  async execute(input: {
    workflowRunId: string;
    repositoryPath: string;
    sessionId: string;
    taskId: string;
    templateId: string;
    subagentType?: string;
    executionMetadata?: TrellisExecutionMetadata;
    attempt: number;
  }) {
    this.latestInput = input;
    return {
      status: "succeeded" as const,
      artifactRefs: ["artifact://test"],
      summary: "ok",
    };
  }
}

class TestGateEngine implements GateEngine {
  async runChecks(input: RunGateChecksInput): Promise<GateCheckBatchDTO> {
    const checks = (input.gateTypes ?? ["build", "test"]).map((gateType) => ({
      gateType,
      passed: true,
      durationMs: 1,
      evidenceRefs: [`gate://${String(gateType)}`],
    }));
    return {
      workflowRunId: input.workflowRunId,
      stage: input.stage,
      taskId: input.taskId,
      checks,
      allPassed: true,
      checkedAt: Date.now(),
    };
  }
}

function createEngine() {
  return new DefaultWorkflowEngine(
    new MemoryWorkflowStore(),
    new TestTaskRouter(),
    new TestOmcAdapter(),
    new TestGateEngine(),
  );
}

function createEngineHarness() {
  const store = new MemoryWorkflowStore();
  const adapter = new TestOmcAdapter();
  const engine = new DefaultWorkflowEngine(store, new TestTaskRouter(), adapter, new TestGateEngine());
  return { engine, store, adapter };
}

function stubRun(id: string, status: WorkflowStatus, repositoryPath = "/tmp/repo"): WorkflowRunDTO {
  return {
    workflowRunId: id,
    sessionId: `s-${id}`,
    repositoryPath,
    currentStage: "split",
    status,
    startedAt: 0,
    updatedAt: 0,
    stageStates: [],
    tasks: [],
    taskSnapshotId: id,
  };
}

describe("DefaultWorkflowEngine", () => {
  test("listRuns 把 status/repositoryPath/limit 下推给 store（过滤发生在 SQL LIMIT 之前）", async () => {
    const { engine, store } = createEngineHarness();
    await store.saveRun(stubRun("r1", "running"));
    await store.saveRun(stubRun("r2", "completed"));
    const runs = await engine.listRuns({
      repositoryPath: "/tmp/repo",
      status: "running",
      limit: 10,
    });
    expect(store.lastListRunsInput).toEqual({
      repositoryPath: "/tmp/repo",
      limit: 10,
      status: "running",
    });
    // status 下推后引擎不再前端 filter：两条都返回，过滤交由 store/SQL 决定，
    // 避免匹配 run 落在最新 N 条之外被静默丢弃。
    expect(runs).toHaveLength(2);
  });

  test("createRun initializes with split stage", async () => {
    const engine = createEngine();
    const run = await engine.createRun({
      sessionId: "s1",
      repositoryPath: "/tmp/repo",
      taskSnapshotId: "snap-1",
    });
    expect(run.currentStage).toBe("split");
    expect(run.status).toBe("running");
    expect(run.stageStates.find((stage) => stage.stage === "split")?.status).toBe("running");
  });

  test("advanceStage moves to next stage", async () => {
    const engine = createEngine();
    const run = await engine.createRun({
      sessionId: "s2",
      repositoryPath: "/tmp/repo",
      taskSnapshotId: "snap-2",
    });
    const advanced = await engine.advanceStage({
      workflowRunId: run.workflowRunId,
      fromStage: "split",
      toStage: "clarify",
    });
    expect(advanced.currentStage).toBe("clarify");
    expect(advanced.stageStates.find((stage) => stage.stage === "split")?.status).toBe("succeeded");
    expect(advanced.stageStates.find((stage) => stage.stage === "clarify")?.status).toBe("running");
  });

  test("retryTask increments attempt based on event history", async () => {
    const engine = createEngine();
    const run = await engine.createRun({
      sessionId: "s3",
      repositoryPath: "/tmp/repo",
      taskSnapshotId: "snap-3",
      startStage: "implement",
    });

    const first = await engine.executeTask({
      workflowRunId: run.workflowRunId,
      taskId: "task-1",
    });
    expect(first.attempt).toBe(1);

    const retried = await engine.retryTask({
      workflowRunId: run.workflowRunId,
      taskId: "task-1",
      previousTaskRunId: first.taskRunId,
    });
    expect(retried.attempt).toBe(2);
  });

  test("replay rebuilds task execution artifacts and summary", async () => {
    const engine = createEngine();
    const run = await engine.createRun({
      sessionId: "s4",
      repositoryPath: "/tmp/repo",
      taskSnapshotId: "snap-4",
      startStage: "implement",
    });

    await engine.executeTask({
      workflowRunId: run.workflowRunId,
      taskId: "task-replay-1",
      templateId: "verify",
    });

    const replayed = await engine.replay({ workflowRunId: run.workflowRunId });
    const task = replayed.tasks.find((item) => item.taskId === "task-replay-1");
    expect(task).toBeTruthy();
    expect(task?.runState).toBe("succeeded");
    expect(task?.flowStatus).toBe("pending_review");
    expect(task?.latestTemplateId).toBe("verify");
    expect(task?.artifactRefs.length).toBeGreaterThan(0);
  });

  test("executeTask carries repository member metadata into adapter and events", async () => {
    const { engine, store, adapter } = createEngineHarness();
    const run = await engine.createRun({
      sessionId: "s5",
      repositoryPath: "/tmp/frontend",
      taskSnapshotId: "snap-5",
      startStage: "implement",
    });
    const executionMetadata: TrellisExecutionMetadata = {
      ownerKind: "repository",
      ownerRepositoryId: 7,
      ownerRepositoryName: "frontend app",
      ownerRepositoryPath: "/tmp/frontend",
      repositoryType: "frontend",
      stage: "implement",
      subagentType: "trellis-implement",
      taskId: "task-repo-member",
    };

    await engine.executeTask({
      workflowRunId: run.workflowRunId,
      taskId: "task-repo-member",
      templateId: "trellis",
      subagentType: "trellis-implement",
      executionMetadata,
    });

    expect(adapter.latestInput?.executionMetadata).toMatchObject(executionMetadata);
    const events = await store.listEvents(run.workflowRunId);
    const started = events.find((event) => event.eventType === "task.run.started");
    const adapterProgress = events.find((event) => {
      if (event.eventType !== "task.run.progressed") return false;
      const payload = event.payload as { stage?: string };
      return payload.stage === "adapter.execute.started";
    });
    expect(started?.payload).toMatchObject({
      taskId: "task-repo-member",
      templateId: "trellis",
      subagentType: "trellis-implement",
      metadata: executionMetadata,
    });
    expect(adapterProgress?.payload).toMatchObject({
      taskId: "task-repo-member",
      templateId: "trellis",
      subagentType: "trellis-implement",
      metadata: executionMetadata,
    });
  });
});
