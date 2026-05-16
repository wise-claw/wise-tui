import { describe, expect, mock, test } from "bun:test";
import type { MissionSessionBinding, MissionSnapshotRecord } from "../missionControlBackend";
import {
  ensureSessionBoundToActiveMission,
  findLatestActiveMission,
  type SessionMissionBindingDeps,
} from "./sessionBinding";

function mission(overrides: Partial<MissionSnapshotRecord>): MissionSnapshotRecord {
  return {
    missionId: "m1",
    projectId: "p1",
    projectName: "Project",
    rootPath: "/work/project",
    prdHash: null,
    title: "Mission",
    stage: "dispatch",
    status: "running",
    snapshot: {},
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function binding(overrides: Partial<MissionSessionBinding> = {}): MissionSessionBinding {
  return {
    sessionId: "s1",
    missionId: "m1",
    projectId: "p1",
    attachedAt: 1,
    updatedAt: 2,
    metadata: {},
    ...overrides,
  };
}

describe("sessionBinding", () => {
  test("finds the latest non-terminal mission by project", async () => {
    const listRecentMissions = mock(async () => [
      mission({ missionId: "done", stage: "done" }),
      mission({ missionId: "active", stage: "dispatch" }),
    ]);

    await expect(findLatestActiveMission({ projectId: "p1" }, { listRecentMissions })).resolves.toMatchObject({
      missionId: "active",
    });
    expect(listRecentMissions).toHaveBeenCalledWith({ projectId: "p1", rootPath: null, limit: 5 });
  });

  test("attaches the session when active mission differs from the current binding", async () => {
    const listRecentMissions = mock(async () => [mission({ missionId: "m2" })]);
    const getSessionMission = mock(async () => mission({ missionId: "old" }));
    const attachMissionToSession = mock(async () => binding({ missionId: "m2" }));
    const deps: SessionMissionBindingDeps = {
      listRecentMissions,
      getSessionMission,
      attachMissionToSession,
    };

    const result = await ensureSessionBoundToActiveMission(
      { sessionId: "s1", projectId: "p1", rootPath: "/work/project" },
      deps,
    );

    expect(result.didAttach).toBe(true);
    expect(attachMissionToSession).toHaveBeenCalledWith({
      sessionId: "s1",
      missionId: "m2",
      projectId: "p1",
      metadata: {
        source: "main_chat",
        rootPath: "/work/project",
      },
    });
  });

  test("skips without an active mission", async () => {
    const listRecentMissions = mock(async () => [mission({ stage: "archived" })]);
    const getSessionMission = mock(async () => null);
    const attachMissionToSession = mock(async () => binding());
    const deps: SessionMissionBindingDeps = {
      listRecentMissions,
      getSessionMission,
      attachMissionToSession,
    };

    const result = await ensureSessionBoundToActiveMission({ sessionId: "s1", projectId: "p1" }, deps);

    expect(result).toEqual({ mission: null, binding: null, didAttach: false });
    expect(getSessionMission).not.toHaveBeenCalled();
    expect(attachMissionToSession).not.toHaveBeenCalled();
  });

  test("does not rewrite an existing binding to the same mission", async () => {
    const active = mission({ missionId: "m1" });
    const deps: SessionMissionBindingDeps = {
      listRecentMissions: mock(async () => [active]),
      getSessionMission: mock(async () => active),
      attachMissionToSession: mock(async () => binding()),
    };

    const result = await ensureSessionBoundToActiveMission({ sessionId: "s1", rootPath: "/work/project" }, deps);

    expect(result.didAttach).toBe(false);
    expect(deps.attachMissionToSession).not.toHaveBeenCalled();
  });
});
