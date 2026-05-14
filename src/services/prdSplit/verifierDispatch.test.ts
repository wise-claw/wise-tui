import { describe, expect, test } from "bun:test";
import { composeVerifierPrompt } from "./verifierDispatch";

const cluster = {
  id: "cluster-fe-1",
  title: "Frontend cluster",
  primaryRepositoryId: 7,
  repositoryIds: [7],
  requirementIds: ["req-functional-1"],
  dependencyClusterIds: [],
};

describe("composeVerifierPrompt", () => {
  test("starts with `Active task:` prefix", () => {
    const prompt = composeVerifierPrompt({
      parentTaskPath: ".trellis/tasks/05-13-parent",
      cluster,
      issueCount: 2,
      bundleFileNames: ["prd.md", "previous-output.json"],
    });
    expect(prompt.split("\n")[0]).toBe("Active task: .trellis/tasks/05-13-parent");
  });

  test("mentions issue count and bundle files", () => {
    const prompt = composeVerifierPrompt({
      parentTaskPath: ".trellis/tasks/05-13-parent",
      cluster,
      issueCount: 3,
      bundleFileNames: ["prd.md", "validation-issues.json", "previous-output.json"],
    });
    expect(prompt).toContain("待修复 issue 数量：3");
    expect(prompt).toContain("`validation-issues.json`");
    expect(prompt).toContain("`previous-output.json`");
    expect(prompt).toContain("task-<n>-v2");
  });
});
