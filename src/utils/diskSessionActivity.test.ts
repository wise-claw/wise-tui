import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { getSessionUpdatedAt, groupSessionsByDay } from "../components/ClaudeSessions/sessionGrouping";
import { mergeCodexRpcDiskSessions } from "./codexRpcDiskSessions";
import { mergeCursorDiskSessions } from "./cursorDiskSessions";
import { mergeNativeCliDiskSessions } from "./nativeCliDiskSessions";

const today = new Date().setHours(12, 0, 0, 0);
const yesterday = today - 86_400_000;
const item = {
  sessionId: "session_existing",
  updatedAtMs: today,
  preview: "今天继续执行",
  resumeSessionId: "native-thread",
};

const mergers = {
  "Wise Codex": (rows: ClaudeSession[]) => mergeCodexRpcDiskSessions(rows, "/repo", "repo", [item], ""),
  "Wise Cursor": (rows: ClaudeSession[]) => mergeCursorDiskSessions(rows, "/repo", "repo", [item], ""),
  "原生 Codex": (rows: ClaudeSession[]) => mergeNativeCliDiskSessions(rows, "/repo", "repo", "codex", [{ ...item, engine: "codex" }], ""),
  "原生 Cursor": (rows: ClaudeSession[]) => mergeNativeCliDiskSessions(rows, "/repo", "repo", "cursor", [{ ...item, engine: "cursor" }], ""),
};

for (const [name, merge] of Object.entries(mergers)) {
  describe(name, () => {
    test("今天续跑后，即使内存只有昨天的消息也按今天排序分组", () => {
      const existing: ClaudeSession = {
        id: item.sessionId,
        claudeSessionId: null,
        repositoryPath: "/repo",
        repositoryName: "repo",
        model: "",
        status: "completed",
        messages: [{ id: 1, role: "user", content: "昨天的请求", timestamp: yesterday }],
        createdAt: yesterday,
        pendingPrompt: "",
      };
      const [row] = merge([existing]);
      expect(row!.createdAt).toBe(yesterday);
      expect(row!.messages).toEqual(existing.messages);
      expect(getSessionUpdatedAt(row!)).toBe(today);
      expect(groupSessionsByDay([row!])[0]!.key).toBe("today");
      expect(getSessionUpdatedAt({ ...row!, messages: [] })).toBe(today);
      expect(getSessionUpdatedAt({
        ...row!,
        messages: [{ id: 2, role: "assistant", content: "刚完成", timestamp: today + 1000 }],
      })).toBe(today + 1000);
    });

    test("纯磁盘发现的会话保留索引活跃时间", () => {
      expect(merge([])[0]!.diskUpdatedAtMs).toBe(today);
    });
  });
}

test("无效磁盘时间不污染现有排序", () => {
  const row = mergers["Wise Codex"]([])[0]!;
  for (const value of [undefined, NaN, Infinity, -1, 0]) {
    expect(getSessionUpdatedAt({ ...row, diskUpdatedAtMs: value })).toBe(today);
  }
});
