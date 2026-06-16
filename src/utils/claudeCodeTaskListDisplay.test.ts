import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  buildTaskListDisplayModel,
  formatTaskListDuration,
  formatTaskListOverflowLabel,
  formatTaskListProgressLabel,
  formatTaskListTokens,
  resolveTodoBatchStartedAt,
  shouldShowClaudeCodeTaskListInMessages,
} from "./claudeCodeTaskListDisplay";

describe("formatTaskListDuration", () => {
  test("formats minutes and seconds with spaces", () => {
    const now = 1_700_000_000_000;
    expect(formatTaskListDuration(now - (12 * 60 + 11) * 1000, now)).toBe("12m 11s");
  });
});

describe("formatTaskListTokens", () => {
  test("formats compact token counts", () => {
    expect(formatTaskListTokens(34_100)).toBe("34.1k tokens");
    expect(formatTaskListTokens(0)).toBeNull();
  });
});

describe("formatTaskListProgressLabel", () => {
  test("counts in-progress toward progressed total", () => {
    expect(
      formatTaskListProgressLabel([
        { id: "1", content: "A", status: "completed" },
        { id: "2", content: "B", status: "in_progress" },
        { id: "3", content: "C", status: "pending" },
      ]),
    ).toBe("2/3");
  });
});

describe("shouldShowClaudeCodeTaskListInMessages", () => {
  test("shows while streaming or when todos remain open", () => {
    const open = [{ id: "1", content: "A", status: "pending" as const }];
    expect(shouldShowClaudeCodeTaskListInMessages("running", open)).toBe(true);
    expect(shouldShowClaudeCodeTaskListInMessages("idle", open)).toBe(true);
    expect(
      shouldShowClaudeCodeTaskListInMessages("idle", [{ id: "1", content: "A", status: "completed" }]),
    ).toBe(false);
  });
});

describe("resolveTodoBatchStartedAt", () => {
  test("uses first TodoWrite assistant message timestamp", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "assistant",
        content: "",
        timestamp: 1_700_000_010_000,
        parts: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "TodoWrite",
            input: { merge: false, todos: [{ id: "1", content: "Plan", status: "pending" }] },
            status: "done",
          },
        ],
      },
    ];
    expect(resolveTodoBatchStartedAt(messages, 1_700_000_000_000)).toBe(1_700_000_010_000);
  });
});

describe("buildTaskListDisplayModel", () => {
  test("prioritizes in-progress and pending rows before completed overflow", () => {
    const model = buildTaskListDisplayModel(
      [
        { id: "1", content: "Done A", status: "completed" },
        { id: "2", content: "Done B", status: "completed" },
        { id: "3", content: "Done C", status: "completed" },
        { id: "4", content: "Active", status: "in_progress" },
        { id: "5", content: "Pending", status: "pending" },
      ],
      { maxVisibleRows: 3, sessionStartedAt: 1_700_000_000_000, nowMs: 1_700_000_731_000 },
    );

    expect(model?.headerTitle).toBe("Active");
    expect(model?.progressLabel).toBe("4/5");
    expect(model?.rows.map((row) => row.content)).toEqual(["Active", "Pending", "Done C"]);
    expect(model?.hiddenCompletedCount).toBe(2);
  });

  test("keeps all active rows visible even when completed overflow is hidden", () => {
    const model = buildTaskListDisplayModel(
      [
        { id: "1", content: "Active", status: "in_progress" },
        { id: "2", content: "Pending", status: "pending" },
        { id: "3", content: "Done A", status: "completed" },
        { id: "4", content: "Done B", status: "completed" },
        { id: "5", content: "Done C", status: "completed" },
        { id: "6", content: "Done D", status: "completed" },
      ],
      { maxVisibleRows: 3 },
    );

    expect(model?.rows.map((row) => row.content)).toEqual(["Active", "Pending", "Done D"]);
    expect(model?.hiddenCompletedCount).toBe(3);
    expect(formatTaskListOverflowLabel(model?.hiddenCompletedCount ?? 0)).toBe("… +3 项已完成");
  });

  test("compact mode keeps only in-progress rows and counts hidden work", () => {
    const model = buildTaskListDisplayModel(
      [
        { id: "1", content: "Active", status: "in_progress" },
        { id: "2", content: "Pending", status: "pending" },
        { id: "3", content: "Done", status: "completed" },
      ],
      { compact: true },
    );

    expect(model?.rows.map((row) => row.content)).toEqual(["Active"]);
    expect(model?.hiddenCompletedCount).toBe(2);
  });
});
