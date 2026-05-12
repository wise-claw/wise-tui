import { describe, expect, test } from "bun:test";
import {
  buildTrellisTeamTemplate,
  resolveTrellisSubagentForStage,
  trellisStageRoutes,
} from "./trellisDefaults";

describe("trellisDefaults", () => {
  test("does not store Trellis subagent names as employee assignees", () => {
    const template = buildTrellisTeamTemplate(1_762_819_200_000);

    expect(template.stages).toHaveLength(trellisStageRoutes().length);
    expect(template.stages.flatMap((stage) => stage.assignees)).toEqual([]);
  });

  test("keeps Trellis stage routing separate from employee routing", () => {
    expect(resolveTrellisSubagentForStage("implement")).toBe("trellis-implement");
    expect(resolveTrellisSubagentForStage("check")).toBe("trellis-check");
    expect(resolveTrellisSubagentForStage("research")).toBe("trellis-research");
  });
});
