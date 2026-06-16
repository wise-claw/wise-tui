import { describe, expect, test } from "bun:test";
import {
  shouldRefreshWorkspaceTodosOnChanged,
  shouldReloadWorkspaceTodosOnChanged,
} from "../hooks/useWorkspaceTodos";

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

describe("shouldReloadWorkspaceTodosOnChanged", () => {
  test("skips reload for optimistic local updates", () => {
    expect(
      shouldReloadWorkspaceTodosOnChanged(
        { projectId: "eco", repositoryId: null, incompleteCount: 2, reloadItems: false },
        "eco",
        1,
      ),
    ).toBe(false);
  });

  test("reloads after external persist", () => {
    expect(
      shouldReloadWorkspaceTodosOnChanged(
        { projectId: "eco", repositoryId: null, incompleteCount: 2, reloadItems: true },
        "eco",
        1,
      ),
    ).toBe(true);
  });

  test("reloads when detail has no incompleteCount", () => {
    expect(
      shouldReloadWorkspaceTodosOnChanged({ projectId: "eco", repositoryId: null }, "eco", 1),
    ).toBe(true);
  });
});
