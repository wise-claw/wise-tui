import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async (_cmd: string, _payload?: unknown) => ({}));

mock.module("@tauri-apps/api/core", () => ({ invoke }));

describe("trellisRuntime service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("wraps runtime event record and list commands", async () => {
    const { listTrellisRuntimeEvents, recordTrellisRuntimeEvent, trellisRuntimeRecordEventSafe } = await import("./trellisRuntime");

    await recordTrellisRuntimeEvent({
      projectId: "p1",
      rootPath: "/work/project",
      eventKind: "trellis.hook.completed",
      payload: { hook: "session-start" },
    });
    await listTrellisRuntimeEvents({
      projectId: "p1",
      eventKind: "trellis.hook.completed",
      limit: 20,
    });
    await trellisRuntimeRecordEventSafe({
      projectId: "p1",
      rootPath: "/work/project",
      eventKind: "trellis.agent.completed",
      correlationId: "a1",
      payload: { status: "succeeded" },
    });
    await trellisRuntimeRecordEventSafe({
      rootPath: "",
      eventKind: "trellis.agent.completed",
      payload: {},
    });

    expect(invoke).toHaveBeenCalledWith("trellis_runtime_record_event", {
      input: {
        projectId: "p1",
        rootPath: "/work/project",
        eventKind: "trellis.hook.completed",
        payload: { hook: "session-start" },
      },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_list_events", {
      input: {
        projectId: "p1",
        eventKind: "trellis.hook.completed",
        limit: 20,
      },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_record_event", {
      input: {
        projectId: "p1",
        rootPath: "/work/project",
        eventKind: "trellis.agent.completed",
        correlationId: "a1",
        payload: { status: "succeeded" },
      },
    });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  test("wraps workflow, lifecycle, agent, spec, onboarding, replay, and snapshot commands", async () => {
    const {
      captureTrellisWorkspaceSnapshot,
      compileTrellisWorkflow,
      diffTrellisWorkspaceSnapshots,
      getTrellisAgentOwnershipGraph,
      getTrellisOnboardingState,
      getTrellisReplay,
      listTrellisSpecRevisions,
      recordTrellisSpecRevision,
      runTrellisTaskLifecycle,
      trellisRuntimeUpsertAgentRunSafe,
      upsertTrellisAgentRun,
    } = await import("./trellisRuntime");

    await compileTrellisWorkflow({ projectId: "p1", rootPath: "/work/project" });
    await runTrellisTaskLifecycle({ projectId: "p1", rootPath: "/work/project", action: "start", taskRef: "05-16-task" });
    await upsertTrellisAgentRun({
      agentRunId: "a1",
      projectId: "p1",
      rootPath: "/work/project",
      agentType: "trellis-implement",
      status: "running",
    });
    await trellisRuntimeUpsertAgentRunSafe("m1", {
      agentRunId: "a2",
      projectId: "p1",
      rootPath: "/work/project",
      agentType: "trellis-splitter",
      status: "succeeded",
    });
    await trellisRuntimeUpsertAgentRunSafe(null, {
      agentRunId: "a3",
      rootPath: "/work/project",
      agentType: "trellis-splitter",
      status: "running",
    });
    await getTrellisAgentOwnershipGraph({ projectId: "p1", includeCompleted: false });
    await recordTrellisSpecRevision({
      projectId: "p1",
      rootPath: "/work/project",
      filePath: ".trellis/spec/tauri/index.md",
      content: "# Spec",
    });
    await listTrellisSpecRevisions({ projectId: "p1", filePath: ".trellis/spec/tauri/index.md" });
    await getTrellisOnboardingState({ projectId: "p1", rootPath: "/work/project" });
    await getTrellisReplay({ projectId: "p1", taskPath: ".trellis/tasks/05-16-task" });
    await captureTrellisWorkspaceSnapshot({ projectId: "p1", rootPath: "/work/project", source: "manual" });
    await diffTrellisWorkspaceSnapshots({ beforeSnapshotId: "s1", afterSnapshotId: "s2" });

    expect(invoke).toHaveBeenCalledWith("trellis_runtime_compile_workflow", {
      input: { projectId: "p1", rootPath: "/work/project" },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_run_task_lifecycle", {
      input: { projectId: "p1", rootPath: "/work/project", action: "start", taskRef: "05-16-task" },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_upsert_agent_run", {
      input: {
        agentRunId: "a1",
        projectId: "p1",
        rootPath: "/work/project",
        agentType: "trellis-implement",
        status: "running",
      },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_upsert_agent_run", {
      input: {
        agentRunId: "a2",
        projectId: "p1",
        rootPath: "/work/project",
        agentType: "trellis-splitter",
        status: "succeeded",
      },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_get_agent_ownership_graph", {
      input: { projectId: "p1", includeCompleted: false },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_record_spec_revision", {
      input: {
        projectId: "p1",
        rootPath: "/work/project",
        filePath: ".trellis/spec/tauri/index.md",
        content: "# Spec",
      },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_list_spec_revisions", {
      input: { projectId: "p1", filePath: ".trellis/spec/tauri/index.md" },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_get_onboarding_state", {
      input: { projectId: "p1", rootPath: "/work/project" },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_get_replay", {
      input: { projectId: "p1", taskPath: ".trellis/tasks/05-16-task" },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_capture_workspace_snapshot", {
      input: { projectId: "p1", rootPath: "/work/project", source: "manual" },
    });
    expect(invoke).toHaveBeenCalledWith("trellis_runtime_diff_workspace_snapshots", {
      input: { beforeSnapshotId: "s1", afterSnapshotId: "s2" },
    });
  });
});
