import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../../types";
import { groupSessionsByDay } from "./sessionGrouping";

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
  });
});
