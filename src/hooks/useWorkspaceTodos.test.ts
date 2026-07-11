import { describe, expect, test } from "bun:test";
import { shouldReloadWorkspaceTodosOnChanged } from "../hooks/useWorkspaceTodos";

describe("shouldReloadWorkspaceTodosOnChanged", () => {
  test("skips reload for optimistic local updates", () => {
    expect(shouldReloadWorkspaceTodosOnChanged({ incompleteCount: 2, reloadItems: false })).toBe(false);
  });

  test("reloads after external persist", () => {
    expect(shouldReloadWorkspaceTodosOnChanged({ incompleteCount: 2, reloadItems: true })).toBe(true);
  });

  test("reloads when detail has no incompleteCount", () => {
    expect(shouldReloadWorkspaceTodosOnChanged({})).toBe(true);
  });

  test("returns false for undefined detail", () => {
    expect(shouldReloadWorkspaceTodosOnChanged(undefined)).toBe(false);
  });
});
