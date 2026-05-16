import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async (_cmd: string, _payload?: unknown) => ({}));

mock.module("@tauri-apps/api/core", () => ({ invoke }));

describe("missionControlBackend service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("wraps Mission snapshot writes behind the typed Tauri command", async () => {
    const { createOrResumeMission } = await import("./missionControlBackend");

    await createOrResumeMission({
      missionId: "m1",
      projectId: "p1",
      rootPath: "/work/project",
      stage: "dispatch",
      status: "running",
      snapshot: { stage: "dispatch" },
    });

    expect(invoke).toHaveBeenCalledWith("mission_create_or_resume", {
      input: {
        missionId: "m1",
        projectId: "p1",
        rootPath: "/work/project",
        stage: "dispatch",
        status: "running",
        snapshot: { stage: "dispatch" },
      },
    });
  });

  test("passes assignment filters through the list command", async () => {
    const { listMissionAgentAssignments } = await import("./missionControlBackend");

    await listMissionAgentAssignments({
      projectId: "p1",
      includeCompleted: false,
      staleAfterMs: 60_000,
    });

    expect(invoke).toHaveBeenCalledWith("mission_list_agent_assignments", {
      input: {
        projectId: "p1",
        includeCompleted: false,
        staleAfterMs: 60_000,
      },
    });
  });

  test("defaults assignment stale threshold to 90 seconds", async () => {
    const { listMissionAgentAssignments } = await import("./missionControlBackend");

    await listMissionAgentAssignments({
      missionId: "m1",
      includeCompleted: false,
    });

    expect(invoke).toHaveBeenCalledWith("mission_list_agent_assignments", {
      input: {
        missionId: "m1",
        includeCompleted: false,
        staleAfterMs: 90_000,
      },
    });
  });

  test("wraps requirement reassignment preview and commit commands", async () => {
    const { commitRequirementReassign, previewRequirementReassign } = await import(
      "./missionControlBackend"
    );

    await previewRequirementReassign({
      missionId: "m1",
      requirementId: "REQ-1",
      targetClusterId: "c-backend",
    });
    await commitRequirementReassign({
      missionId: "m1",
      previewId: "preview-1",
      origin: "panel",
    });

    expect(invoke).toHaveBeenCalledWith("mission_preview_requirement_reassign", {
      input: {
        missionId: "m1",
        requirementId: "REQ-1",
        targetClusterId: "c-backend",
      },
    });
    expect(invoke).toHaveBeenCalledWith("mission_commit_requirement_reassign", {
      input: {
        missionId: "m1",
        previewId: "preview-1",
        origin: "panel",
      },
    });
  });

  test("wraps session sync, evidence, replay, and onboarding health commands", async () => {
    const {
      appendMissionInstruction,
      attachMissionToSession,
      getMissionOnboardingHealth,
      getMissionReplay,
      recordMissionEvidence,
    } = await import("./missionControlBackend");

    await attachMissionToSession({ sessionId: "s1", missionId: "m1", projectId: "p1" });
    await appendMissionInstruction({
      missionId: "m1",
      sessionId: "s1",
      targetKind: "task",
      targetId: "T-1",
      instruction: "Keep API compatibility.",
    });
    await recordMissionEvidence({
      missionId: "m1",
      taskId: "T-1",
      evidenceType: "test_result",
      status: "passed",
      payload: { command: "bun test" },
    });
    await getMissionReplay({ missionId: "m1", taskId: "T-1" });
    await getMissionOnboardingHealth({ projectId: "p1", rootPath: "/work/project" });

    expect(invoke).toHaveBeenCalledWith("mission_attach_to_session", {
      input: { sessionId: "s1", missionId: "m1", projectId: "p1" },
    });
    expect(invoke).toHaveBeenCalledWith("mission_append_instruction", {
      input: {
        missionId: "m1",
        sessionId: "s1",
        targetKind: "task",
        targetId: "T-1",
        instruction: "Keep API compatibility.",
      },
    });
    expect(invoke).toHaveBeenCalledWith("mission_record_evidence", {
      input: {
        missionId: "m1",
        taskId: "T-1",
        evidenceType: "test_result",
        status: "passed",
        payload: { command: "bun test" },
      },
    });
    expect(invoke).toHaveBeenCalledWith("mission_get_replay", {
      input: { missionId: "m1", taskId: "T-1" },
    });
    expect(invoke).toHaveBeenCalledWith("mission_get_onboarding_health", {
      input: { projectId: "p1", rootPath: "/work/project" },
    });
  });
});
