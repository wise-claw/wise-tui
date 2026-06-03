import { describe, expect, test } from "bun:test";
import {
  createWorkspaceTodoItem,
  isWorkspaceTodoOverdue,
  parseWorkspaceTodosPayload,
  sortWorkspaceTodoItems,
} from "./workspaceTodos";

describe("workspaceTodos", () => {
  test("parseWorkspaceTodosPayload sorts incomplete before completed", () => {
    const payload = parseWorkspaceTodosPayload(
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "a",
            title: "done",
            completed: true,
            sortOrder: 1,
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: "b",
            title: "todo",
            completed: false,
            sortOrder: 2,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    );
    expect(payload.items[0]?.id).toBe("b");
    expect(payload.items[1]?.id).toBe("a");
  });

  test("isWorkspaceTodoOverdue respects completed flag", () => {
    expect(
      isWorkspaceTodoOverdue(
        {
          id: "x",
          title: "t",
          completed: false,
          dueAt: 100,
          notes: "",
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        200,
      ),
    ).toBe(true);
    expect(
      isWorkspaceTodoOverdue(
        {
          id: "x",
          title: "t",
          completed: true,
          dueAt: 100,
          notes: "",
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        200,
      ),
    ).toBe(false);
  });

  test("createWorkspaceTodoItem trims title and assigns id", () => {
    const item = createWorkspaceTodoItem("  修复网关  ");
    expect(item.title).toBe("修复网关");
    expect(item.id.length).toBeGreaterThan(0);
    expect(item.completed).toBe(false);
  });

  test("sortWorkspaceTodoItems keeps stable ordering", () => {
    const sorted = sortWorkspaceTodoItems([
      {
        id: "2",
        title: "b",
        completed: false,
        dueAt: null,
        notes: "",
        sortOrder: 20,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "1",
        title: "a",
        completed: false,
        dueAt: null,
        notes: "",
        sortOrder: 10,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["1", "2"]);
  });
});
