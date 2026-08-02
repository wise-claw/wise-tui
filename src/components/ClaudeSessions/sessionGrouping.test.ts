import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../../types";
import {
  bumpSessionCreatedAtForSortActivity,
  getSessionUpdatedAt,
  groupSessionsByDay,
  sliceGroupedSessions,
} from "./sessionGrouping";

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

describe("getSessionUpdatedAt sort stability", () => {
  test("preserves activity after messages are cleared when createdAt was bumped", () => {
    const t0 = 1_700_000_000_000;
    const hello = sess("hello", t0);
    hello.createdAt = t0;
    hello.messages = [
      { role: "user", content: "你好", timestamp: t0 + 5_000 },
      { role: "assistant", content: "hi", timestamp: t0 + 6_000 },
    ];
    const draft = sess("draft", t0 + 4_000);
    draft.messages = [];

    expect(getSessionUpdatedAt(hello)).toBeGreaterThan(getSessionUpdatedAt(draft));

    const recycled: ClaudeSession = {
      ...hello,
      createdAt: bumpSessionCreatedAtForSortActivity(hello),
      messages: [],
      diskPreview: "你好",
    };
    expect(getSessionUpdatedAt(recycled)).toBe(t0 + 6_000);
    expect(getSessionUpdatedAt(recycled)).toBeGreaterThan(getSessionUpdatedAt(draft));
  });

  test("ignores trailing messages without timestamp when scanning activity", () => {
    const t0 = 1_700_000_000_000;
    const session = sess("s", t0);
    session.messages = [
      { role: "user", content: "你好", timestamp: t0 + 9_000 },
      { role: "assistant", content: "tool", timestamp: undefined as unknown as number },
    ];
    expect(getSessionUpdatedAt(session)).toBe(t0 + 9_000);
  });

  test("assistant 继承用户时间后点击 hydrate 不会把会话顶成刚刚", () => {
    const t0 = 1_700_000_000_000;
    const session = sess("s", t0);
    session.messages = [
      { role: "user", content: "分析项目", timestamp: t0 },
      { role: "assistant", content: "功能概览", timestamp: t0 },
    ];
    expect(getSessionUpdatedAt(session)).toBe(t0);
    expect(getSessionUpdatedAt(session)).toBeLessThan(Date.now() - 60_000);
  });
});
