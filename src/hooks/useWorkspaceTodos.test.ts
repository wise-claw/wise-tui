import { describe, expect, test } from "bun:test";
import { shouldRefreshWorkspaceTodosOnChanged } from "../hooks/useWorkspaceTodos";

describe("shouldRefreshWorkspaceTodosOnChanged", () => {
  test("matches project or repository scope", () => {
    expect(
      shouldRefreshWorkspaceTodosOnChanged({ projectId: "eco", repositoryId: null }, "eco", 1),
    ).toBe(true);
    expect(
      shouldRefreshWorkspaceTodosOnChanged({ projectId: null, repositoryId: 9 }, "eco", 9),
    ).toBe(true);
    expect(
      shouldRefreshWorkspaceTodosOnChanged({ projectId: null, repositoryId: 9 }, "eco", 1),
    ).toBe(false);
  });
});
