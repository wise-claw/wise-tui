import { describe, expect, test } from "bun:test";
import {
  buildPrdSplitMissionAssignmentId,
  buildPrdSplitMissionId,
  normalizePrdSplitMissionId,
} from "./missionIds";

describe("prdSplit mission ids", () => {
  test("builds the stable mission id used by splitter runtime recovery", () => {
    expect(buildPrdSplitMissionId("Project A", "  # PRD\n\nDo it.  ")).toBe(
      buildPrdSplitMissionId("Project A", "# PRD\n\nDo it."),
    );
    expect(buildPrdSplitMissionId("Project A", "# PRD\n\nDo it.")).toMatch(/^mission-project-a-[0-9a-f]+$/);
  });

  test("builds assignment ids with the same normalization contract", () => {
    expect(buildPrdSplitMissionAssignmentId("Mission 1", "Cluster/FE", "splitter retry")).toBe(
      "mission-1-cluster-fe-splitter-retry",
    );
  });

  test("normalizes empty ids to the mission placeholder", () => {
    expect(normalizePrdSplitMissionId("  ")).toBe("mission");
  });
});
