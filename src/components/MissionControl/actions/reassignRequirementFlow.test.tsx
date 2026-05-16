import { describe, expect, mock, test } from "bun:test";
import type { MissionReassignPreview } from "../../../services/missionControlBackend";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import { moveRequirementWithImpactPreview, type ReassignConfirmInput } from "./reassignRequirementFlow";

function makePreview(overrides: Partial<MissionReassignPreview> = {}): MissionReassignPreview {
  return {
    previewId: "preview-1",
    missionId: "mission-1",
    requirementId: "REQ-1",
    sourceClusterId: "cluster-a",
    targetClusterId: "cluster-b",
    affectedClusters: ["cluster-a", "cluster-b"],
    dirtyClusterCount: 2,
    invalidatedTaskIds: ["task-1"],
    manualEditClusterIds: ["cluster-a"],
    dependencyTaskIds: ["task-2"],
    agentImpacts: [
      {
        assignmentId: "assignment-1",
        taskId: "task-1",
        clusterId: "cluster-a",
        status: "running",
        recommendedAction: "cancel",
      },
    ],
    createdAt: 1,
    expiresAt: 2,
    ...overrides,
  };
}

function makeApi() {
  return {
    state: {},
    reassignRequirement: mock(() => {}),
    markClusterNeedsResplit: mock(() => {}),
  } as unknown as Pick<
    UseSplitWizardStateApi,
    "state" | "reassignRequirement" | "markClusterNeedsResplit"
  >;
}

describe("moveRequirementWithImpactPreview", () => {
  test("falls back to local reassign when mission id is missing", async () => {
    const api = makeApi();
    const deps = {
      previewRequirementReassign: mock(async () => makePreview()),
      commitRequirementReassign: mock(async () => ({} as never)),
      recordMissionAgentCommand: mock(async () => ({} as never)),
      confirm: mock(() => {}),
      success: mock(() => {}),
      error: mock(() => {}),
    };

    await moveRequirementWithImpactPreview(
      { api, missionId: null, requirementId: "REQ-1", targetClusterId: "cluster-b" },
      deps,
    );

    expect(api.reassignRequirement).toHaveBeenCalledWith("REQ-1", "cluster-b");
    expect(deps.previewRequirementReassign).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.success).toHaveBeenCalledWith("需求已重新分配");
  });

  test("previews, commits, records cancel commands, and marks dirty clusters", async () => {
    const api = makeApi();
    const preview = makePreview();
    let confirmInput: ReassignConfirmInput | null = null;
    const deps = {
      previewRequirementReassign: mock(async () => preview),
      commitRequirementReassign: mock(async () => ({} as never)),
      recordMissionAgentCommand: mock(async () => ({} as never)),
      confirm: mock((input: ReassignConfirmInput) => {
        confirmInput = input;
      }),
      success: mock(() => {}),
      error: mock(() => {}),
    };

    await moveRequirementWithImpactPreview(
      { api, missionId: "mission-1", requirementId: "REQ-1", targetClusterId: "cluster-b" },
      deps,
    );
    expect(deps.previewRequirementReassign).toHaveBeenCalledWith({
      missionId: "mission-1",
      requirementId: "REQ-1",
      targetClusterId: "cluster-b",
    });
    expect(confirmInput).not.toBeNull();

    await confirmInput!.onOk();

    expect(deps.commitRequirementReassign).toHaveBeenCalledWith({
      missionId: "mission-1",
      previewId: "preview-1",
      origin: "mission-control",
    });
    expect(api.reassignRequirement).toHaveBeenCalledWith("REQ-1", "cluster-b");
    expect(api.markClusterNeedsResplit).toHaveBeenCalledWith("cluster-a");
    expect(api.markClusterNeedsResplit).toHaveBeenCalledWith("cluster-b");
    expect(deps.recordMissionAgentCommand).toHaveBeenCalledWith({
      missionId: "mission-1",
      commandType: "cancel",
      targetKind: "assignment",
      targetId: "assignment-1",
      assignmentId: "assignment-1",
      result: {
        source: "requirement_reassign",
        recommendedAction: "cancel",
        clusterId: "cluster-a",
        taskId: "task-1",
      },
    });
  });
});
