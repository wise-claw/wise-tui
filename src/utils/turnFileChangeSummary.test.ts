import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ToolUsePart } from "../types";
import {
  buildTurnFileChangeSummaryPlacements,
  collectTurnFileChanges,
} from "./turnFileChangeSummary";

function msg(partial: Partial<ClaudeMessage> & Pick<ClaudeMessage, "id" | "role">): ClaudeMessage {
  return {
    id: partial.id,
    role: partial.role,
    content: partial.content ?? "",
    timestamp: partial.timestamp ?? Date.now(),
    parts: partial.parts,
  };
}

function editPart(
  filePath: string,
  oldString: string,
  newString: string,
  id = "t1",
): ToolUsePart {
  return {
    id,
    type: "tool_use",
    name: "Edit",
    status: "completed",
    input: { file_path: filePath, old_string: oldString, new_string: newString },
    output: "",
  };
}

function writePart(filePath: string, content: string, id = "t2"): ToolUsePart {
  return {
    id,
    type: "tool_use",
    name: "Write",
    status: "completed",
    input: { file_path: filePath, content },
    output: "",
  };
}

describe("collectTurnFileChanges", () => {
  test("returns empty when no file edits", () => {
    expect(
      collectTurnFileChanges([
        msg({ id: 1, role: "user", content: "hi" }),
        msg({ id: 2, role: "assistant", content: "ok", parts: [{ type: "text", text: "ok" }] }),
      ]),
    ).toEqual([]);
  });

  test("merges same path edits and sums line counts", () => {
    const files = collectTurnFileChanges([
      msg({
        id: 1,
        role: "assistant",
        parts: [
          editPart("/repo/a.ts", "a", "aa\nbb", "e1"),
          writePart("/repo/a.ts", "line1\nline2\nline3", "w1"),
        ],
      }),
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]!.fileName).toBe("a.ts");
    expect(files[0]!.addedLineCount).toBeGreaterThan(0);
  });

  test("keeps distinct paths", () => {
    const files = collectTurnFileChanges([
      msg({
        id: 1,
        role: "assistant",
        parts: [
          writePart("/repo/a.ts", "one", "w1"),
          writePart("/repo/b.ts", "two\nthree", "w2"),
        ],
      }),
    ]);
    expect(files.map((f) => f.fileName).sort()).toEqual(["a.ts", "b.ts"]);
  });
});

describe("buildTurnFileChangeSummaryPlacements", () => {
  test("skips last turn while session is running", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "edit", timestamp: 10 }),
      msg({
        id: 2,
        role: "assistant",
        content: "done",
        timestamp: 11,
        parts: [writePart("/repo/a.ts", "x\ny", "w1"), { type: "text", text: "done" }],
      }),
    ];
    expect(buildTurnFileChangeSummaryPlacements(messages, "running")).toEqual([]);
    expect(buildTurnFileChangeSummaryPlacements(messages, "connecting")).toEqual([]);
  });

  test("emits placement after completed idle turn", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "edit", timestamp: 10 }),
      msg({
        id: 2,
        role: "assistant",
        content: "done",
        timestamp: 11,
        parts: [writePart("/repo/a.ts", "x\ny", "w1"), { type: "text", text: "done" }],
      }),
    ];
    const placements = buildTurnFileChangeSummaryPlacements(messages, "idle");
    expect(placements).toHaveLength(1);
    expect(placements[0]!.afterOriginalIndex).toBe(1);
    expect(placements[0]!.files).toHaveLength(1);
    expect(placements[0]!.files[0]!.fileName).toBe("a.ts");
    expect(placements[0]!.key).toContain("files-changed:10:");
  });

  test("keeps prior completed turn summary while later turn is still streaming", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "first", timestamp: 10 }),
      msg({
        id: 2,
        role: "assistant",
        content: "done",
        timestamp: 11,
        parts: [writePart("/repo/a.ts", "x", "w1"), { type: "text", text: "done" }],
      }),
      msg({ id: 3, role: "user", content: "second", timestamp: 20 }),
      msg({
        id: 4,
        role: "assistant",
        content: "partial",
        timestamp: 21,
        parts: [{ type: "text", text: "partial" }],
      }),
    ];
    const placements = buildTurnFileChangeSummaryPlacements(messages, "running");
    expect(placements).toHaveLength(1);
    expect(placements[0]!.afterOriginalIndex).toBe(1);
    expect(placements[0]!.files[0]!.fileName).toBe("a.ts");
  });

  test("emits one card per completed turn with edits when idle", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "first", timestamp: 10 }),
      msg({
        id: 2,
        role: "assistant",
        content: "done",
        timestamp: 11,
        parts: [writePart("/repo/a.ts", "x", "w1"), { type: "text", text: "done" }],
      }),
      msg({ id: 3, role: "user", content: "second", timestamp: 20 }),
      msg({
        id: 4,
        role: "assistant",
        content: "done2",
        timestamp: 21,
        parts: [writePart("/repo/b.ts", "y\nz", "w2"), { type: "text", text: "done2" }],
      }),
    ];
    const placements = buildTurnFileChangeSummaryPlacements(messages, "idle");
    expect(placements).toHaveLength(2);
    expect(placements[0]!.files[0]!.fileName).toBe("a.ts");
    expect(placements[1]!.files[0]!.fileName).toBe("b.ts");
  });
});
