import { describe, expect, it } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  computeTodoProgress,
  extractLatestTodoWriteFromMessages,
  extractTodoWriteFromMessageParts,
  mergeTodoLists,
  parseTodoWriteInput,
  pickActiveTodoTitle,
} from "./todoIngest";

describe("parseTodoWriteInput", () => {
  it("parses todos array with merge flag", () => {
    const parsed = parseTodoWriteInput({
      merge: true,
      todos: [
        { id: "a", content: "First", status: "completed" },
        { id: "b", content: "Second", status: "in_progress" },
      ],
    });
    expect(parsed?.merge).toBe(true);
    expect(parsed?.items).toHaveLength(2);
    expect(parsed?.items[0].status).toBe("completed");
    expect(parsed?.items[1].status).toBe("in_progress");
  });

  it("returns null for empty todos", () => {
    expect(parseTodoWriteInput({ todos: [] })).toBeNull();
  });
});

describe("mergeTodoLists", () => {
  it("replaces list when merge is false", () => {
    const existing = [{ id: "old", content: "Old", status: "pending" as const }];
    const incoming = [{ id: "new", content: "New", status: "pending" as const }];
    expect(mergeTodoLists(existing, incoming, false)).toEqual(incoming);
  });

  it("updates status by id when merge is true", () => {
    const existing = [{ id: "a", content: "Task A", status: "pending" as const }];
    const incoming = [{ id: "a", content: "Task A", status: "completed" as const }];
    const merged = mergeTodoLists(existing, incoming, true);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("completed");
  });
});

describe("computeTodoProgress", () => {
  it("counts in_progress toward progressed total", () => {
    const stats = computeTodoProgress([
      { id: "1", content: "a", status: "completed" },
      { id: "2", content: "b", status: "in_progress" },
      { id: "3", content: "c", status: "pending" },
    ]);
    expect(stats.progressed).toBe(2);
    expect(stats.total).toBe(3);
  });
});

describe("pickActiveTodoTitle", () => {
  it("prefers in_progress task title", () => {
    const title = pickActiveTodoTitle([
      { id: "1", content: "Done", status: "completed" },
      { id: "2", content: "Active", status: "in_progress" },
    ]);
    expect(title).toBe("Active");
  });
});

describe("extractLatestTodoWriteFromMessages", () => {
  it("returns the last assistant TodoWrite batch", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "assistant",
        content: "",
        timestamp: 1,
        parts: [
          {
            type: "tool_use",
            id: "t1",
            name: "TodoWrite",
            input: { merge: false, todos: [{ id: "1", content: "Old", status: "pending" }] },
            status: "running",
          },
        ],
      },
      {
        id: 2,
        role: "assistant",
        content: "",
        timestamp: 2,
        parts: [
          {
            type: "tool_use",
            id: "t2",
            name: "TodoWrite",
            input: {
              merge: true,
              todos: [{ id: "1", content: "Old", status: "completed" }],
            },
            status: "running",
          },
        ],
      },
    ];
    const batch = extractLatestTodoWriteFromMessages(messages);
    expect(batch?.merge).toBe(true);
    expect(batch?.items[0].status).toBe("completed");
  });
});

describe("extractTodoWriteFromMessageParts", () => {
  it("uses the last TodoWrite part in the batch", () => {
    const batch = extractTodoWriteFromMessageParts([
      {
        type: "tool_use",
        id: "t1",
        name: "TodoWrite",
        input: { merge: false, todos: [{ id: "1", content: "One", status: "pending" }] },
        status: "running",
      },
      {
        type: "tool_use",
        id: "t2",
        name: "TodoWrite",
        input: {
          merge: true,
          todos: [{ id: "1", content: "One", status: "completed" }],
        },
        status: "running",
      },
    ]);
    expect(batch?.merge).toBe(true);
    expect(batch?.items[0].status).toBe("completed");
  });
});
