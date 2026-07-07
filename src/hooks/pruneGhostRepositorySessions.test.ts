import { describe, expect, test } from "bun:test";
import type { ClaudeDiskSessionItem, ClaudeSession } from "../types";
import { pruneGhostRepositorySessions } from "./useClaudeSessions";

const REPO = "/work/antv_edge_drag";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    id: partial.id,
    claudeSessionId: partial.claudeSessionId ?? null,
    repositoryPath: partial.repositoryPath ?? REPO,
    repositoryName: partial.repositoryName ?? "antv_edge_drag",
    model: partial.model ?? "sonnet",
    status: partial.status ?? "completed",
    messages: partial.messages ?? [],
    createdAt: partial.createdAt ?? Date.now(),
    pendingPrompt: partial.pendingPrompt ?? "",
    ...partial,
  };
}

describe("pruneGhostRepositorySessions", () => {
  test("removes completed ghost with claude id absent from disk and no messages", () => {
    const ghostId = "0123456789abcdef0123456789abcdef";
    const kept = session({ id: "session_local", claudeSessionId: null });
    const ghost = session({ id: ghostId, claudeSessionId: ghostId, status: "idle" });
    const disk: ClaudeDiskSessionItem[] = [
      { sessionId: "fedcba9876543210fedcba9876543210", updatedAtMs: 1, preview: "" },
    ];

    const next = pruneGhostRepositorySessions([kept, ghost], REPO, disk);
    expect(next.map((s) => s.id)).toEqual(["session_local"]);
  });

  test("keeps session with local messages even when disk entry is missing", () => {
    const sid = "0123456789abcdef0123456789abcdef";
    const withMessages = session({
      id: sid,
      claudeSessionId: sid,
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
    });

    const next = pruneGhostRepositorySessions([withMessages], REPO, []);
    expect(next).toHaveLength(1);
  });

  test("does not prune when disk list is empty (avoid false delete on list failure)", () => {
    const ghostId = "0123456789abcdef0123456789abcdef";
    const ghost = session({ id: ghostId, claudeSessionId: ghostId, status: "idle" });
    const next = pruneGhostRepositorySessions([ghost], REPO, []);
    expect(next).toHaveLength(1);
  });

  test("matches repository path with trailing slash", () => {
    const ghostId = "0123456789abcdef0123456789abcdef";
    const ghost = session({ id: ghostId, claudeSessionId: ghostId, status: "idle", repositoryPath: `${REPO}/` });
    const disk: ClaudeDiskSessionItem[] = [
      { sessionId: "fedcba9876543210fedcba9876543210", updatedAtMs: 1, preview: "" },
    ];
    const next = pruneGhostRepositorySessions([ghost], REPO, disk);
    expect(next).toHaveLength(0);
  });

  test("keeps running session even when disk entry is missing", () => {
    const sid = "0123456789abcdef0123456789abcdef";
    const running = session({ id: sid, claudeSessionId: sid, status: "running" });

    const next = pruneGhostRepositorySessions([running], REPO, []);
    expect(next).toHaveLength(1);
  });

  test("keeps terminal worker tab even when disk entry is missing and messages were recycled", () => {
    const worker = session({
      id: "wise-tab-terminal-02",
      claudeSessionId: "0123456789abcdef0123456789abcdef",
      repositoryName: "wise/员工:终端02",
      messages: [],
      status: "completed",
    });
    const next = pruneGhostRepositorySessions([worker], REPO, []);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("wise-tab-terminal-02");
  });

  test("keeps companion session even when messages absent and disk index missing", () => {
    const companionId = "0123456789abcdef0123456789abcdef";
    const companion = session({
      id: companionId,
      claudeSessionId: companionId,
      status: "completed",
      messages: [],
    });
    const disk: ClaudeDiskSessionItem[] = [
      { sessionId: "fedcba9876543210fedcba9876543210", updatedAtMs: 1, preview: "" },
    ];
    // 不传 companionSessionIds：无消息且磁盘索引未收录的会话被 prune
    const withoutCompanion = pruneGhostRepositorySessions([companion], REPO, disk);
    expect(withoutCompanion).toHaveLength(0);
    // 传 companionSessionIds：多屏额外窗格正在引用，保留
    const withCompanion = pruneGhostRepositorySessions([companion], REPO, disk, new Set([companionId]));
    expect(withCompanion).toHaveLength(1);
    expect(withCompanion[0]?.id).toBe(companionId);
  });
});
