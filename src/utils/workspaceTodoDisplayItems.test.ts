import { describe, expect, test } from "bun:test";
import type { WorkspaceTodoItem } from "../types/workspaceTodos";
import { reconcileWorkspaceTodoDisplayItems } from "./workspaceTodoDisplayItems";

function item(id: string, overrides: Partial<WorkspaceTodoItem> = {}): WorkspaceTodoItem {
  return {
    id,
    title: `title-${id}`,
    completed: false,
    dueAt: null,
    notes: "",
    sortOrder: 1,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe("reconcileWorkspaceTodoDisplayItems", () => {
  test("preserves object reference for unchanged rows", () => {
    const first = reconcileWorkspaceTodoDisplayItems(
      [],
      "p1",
      7,
      [item("a")],
      [item("b")],
    );
    const second = reconcileWorkspaceTodoDisplayItems(
      first,
      "p1",
      7,
      [item("a", { title: "title-a" })],
      [item("b", { title: "updated-b" })],
    );

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1]?.title).toBe("updated-b");
    expect(second[1]?.scope).toBe("repository");
  });
});
