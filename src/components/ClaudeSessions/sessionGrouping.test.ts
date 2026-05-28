import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../../types";
import { groupSessionsByDay, sliceGroupedSessions } from "./sessionGrouping";

function sess(id: string, timestamp: number): ClaudeSession {
  return {
    id,
    claudeSessionId: null,
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "idle",
    messages: [{ role: "user", content: "x", timestamp }],
    createdAt: timestamp,
    pendingPrompt: "",
  };
}

describe("groupSessionsByDay", () => {
  test("groups sessions into day buckets", () => {
    const now = Date.now();
    const groups = groupSessionsByDay([sess("today", now), sess("yesterday", now - 24 * 60 * 60 * 1000)]);
    expect(groups.map((g) => g.key)).toEqual(["today", "yesterday"]);
    expect(groups[0]?.label).toBe("今天");
  });

  test("sliceGroupedSessions keeps today group before truncating yesterday overflow", () => {
    const now = Date.now();
    const manyYesterday = Array.from({ length: 60 }, (_, i) =>
      sess(`y-${i}`, now - 24 * 60 * 60 * 1000 - i),
    );
    const today = sess("today-1", now);
    const groups = groupSessionsByDay([today, ...manyYesterday]);
    const sliced = sliceGroupedSessions(groups, 50);
    expect(sliced[0]?.key).toBe("today");
    expect(sliced[0]?.items.some((item) => item.id === "today-1")).toBe(true);
  });
});
