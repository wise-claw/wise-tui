import { describe, expect, test } from "bun:test";
import { composeSplitterPrompt } from "./splitterDispatch";

const cluster = {
  id: "cluster-fe-1",
  title: "Frontend cluster",
  primaryRepositoryId: 7,
  repositoryIds: [7],
  requirementIds: ["req-functional-1"],
  dependencyClusterIds: [],
};

describe("composeSplitterPrompt", () => {
  test("starts with the strict `Active task:` prefix", () => {
    const prompt = composeSplitterPrompt({
      parentTaskPath: ".trellis/tasks/05-13-parent",
      cluster,
      bundleFileNames: ["prd.md", "cluster.json"],
    });
    expect(prompt.split("\n")[0]).toBe("Active task: .trellis/tasks/05-13-parent");
  });

  test("lists each bundle file and includes cluster meta", () => {
    const prompt = composeSplitterPrompt({
      parentTaskPath: ".trellis/tasks/05-13-parent",
      cluster,
      bundleFileNames: ["prd.md", "requirements-index.json", "cluster.json", "OUTPUT_SCHEMA.json"],
    });
    expect(prompt).toContain("`cluster-fe-1`");
    expect(prompt).toContain("primaryRepositoryId: 7");
    expect(prompt).toContain("- `prd.md`");
    expect(prompt).toContain("- `OUTPUT_SCHEMA.json`");
    expect(prompt).toContain("仅输出一个顶层 JSON 对象");
  });
});
