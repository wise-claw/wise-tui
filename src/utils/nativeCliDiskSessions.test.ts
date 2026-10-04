import { describe, expect, test } from "bun:test";
import type { ClaudeSession, NativeCliDiskSessionItem } from "../types";
import { dedupeNativeCliSessionTabs } from "./nativeCliSessionIdentity";
import { findSessionByTabOrClaudeId } from "./claudeSessionSelection";
import {
  isDroppableNativeCliPlaceholder,
  mergeNativeCliDiskSessions,
} from "./nativeCliDiskSessions";

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "wise-tab-1",
    claudeSessionId: null,
    repositoryPath: "/repo",
    repositoryName: "demo",
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

function diskItem(overrides: Partial<NativeCliDiskSessionItem> = {}): NativeCliDiskSessionItem {
  return {
    engine: "codex",
    sessionId: "019fba5c-thread",
    updatedAtMs: 1_700_000_000_000,
    preview: "帮我看看这个仓库",
    modelHint: "gpt-5.6-terra",
    title: null,
    ...overrides,
  };
}

describe("mergeNativeCliDiskSessions", () => {
  test("parent scan retains the repository of an existing Codex tab", () => {
    const tab = session({ id: "019fba5c-thread", nativeCliSource: "codex", executionEngine: "codex-rpc",
      repositoryPath: "/work/repo", repositoryName: "repo" });
    const next = mergeNativeCliDiskSessions([tab], "/work", "work", "codex", [diskItem()], "sonnet");
    expect(next).toHaveLength(1);
    expect(next[0]!.repositoryPath).toBe("/work/repo");
    expect(next[0]!.repositoryName).toBe("repo");
    expect(next[0]!.diskPreview).toBe("帮我看看这个仓库");
  });

  test("repository scan refines the parent import without duplicating its tab id", () => {
    const tab = session({ id: "019fba5c-thread", nativeCliSource: "codex", executionEngine: "codex-rpc",
      repositoryPath: "/work", repositoryName: "work",
      messages: [{ role: "user", content: "existing history", timestamp: 1 }] });
    const next = mergeNativeCliDiskSessions([tab], "/work/repo", "repo", "codex", [diskItem()], "sonnet");
    expect(next).toHaveLength(1);
    expect(next[0]!.repositoryPath).toBe("/work/repo");
    expect(next[0]!.repositoryName).toBe("repo");
    expect(next[0]!.messages).toEqual(tab.messages);
    const refreshed = mergeNativeCliDiskSessions(next, "/work", "work", "codex", [diskItem()], "sonnet");
    expect(refreshed).toHaveLength(1);
    expect(findSessionByTabOrClaudeId(refreshed, tab.id)?.repositoryPath).toBe("/work/repo");
  });

  test("does not move an existing native tab into an unrelated repository", () => {
    const tab = session({ id: "019fba5c-thread", nativeCliSource: "codex", executionEngine: "codex-rpc" });
    const next = mergeNativeCliDiskSessions([tab], "/repo-other", "other", "codex", [diskItem()], "sonnet");
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(tab);
  });

  test("adds a native row bound to its execution engine right after the same repository", () => {
    const prev = [session({ id: "repo-a-1" }), session({ id: "repo-b-1", repositoryPath: "/other" })];
    const next = mergeNativeCliDiskSessions(prev, "/repo", "demo", "codex", [diskItem()], "sonnet");
    expect(next.map((row) => row.id)).toEqual(["repo-a-1", "019fba5c-thread", "repo-b-1"]);
    const added = next[1]!;
    expect(added.nativeCliSource).toBe("codex");
    expect(added.executionEngine).toBe("codex-rpc");
    expect(added.claudeSessionId).toBe("019fba5c-thread");
    expect(added.model).toBe("gpt-5.6-terra");
    expect(added.diskPreview).toBe("帮我看看这个仓库");
    expect(added.status).toBe("completed");
    expect(added.messages).toEqual([]);
  });

  test("falls back to the caller model when the native item has no model hint", () => {
    const next = mergeNativeCliDiskSessions(
      [],
      "/repo",
      "demo",
      "deepseek",
      [diskItem({ engine: "deepseek", modelHint: null, title: "会话标题" })],
      "deepseek-chat",
    );
    expect(next[0]!.model).toBe("deepseek-chat");
    expect(next[0]!.diskPreview).toBe("帮我看看这个仓库");
    expect(next[0]!.executionEngine).toBe("deepseek");
  });

  test("adds a Cursor ACP row bound to the cursor execution engine", () => {
    const next = mergeNativeCliDiskSessions(
      [],
      "/repo",
      "demo",
      "cursor",
      [
        diskItem({
          engine: "cursor",
          sessionId: "9525465f-23a0-4f16-a873-07207ff85bc4",
          preview: "Git Commit Generator",
          modelHint: null,
          title: "Git Commit Generator",
        }),
      ],
      "sonnet",
    );
    expect(next).toHaveLength(1);
    expect(next[0]!.nativeCliSource).toBe("cursor");
    expect(next[0]!.executionEngine).toBe("cursor");
    expect(next[0]!.id).toBe("9525465f-23a0-4f16-a873-07207ff85bc4");
    expect(next[0]!.claudeSessionId).toBe("9525465f-23a0-4f16-a873-07207ff85bc4");
    expect(next[0]!.diskPreview).toBe("Git Commit Generator");
  });

  test("hydrates an existing Wise row without changing its tab id", () => {
    const prev = [
      session({
        id: "wise-tab-1",
        claudeSessionId: "019fba5c-thread",
        executionEngine: "codex-rpc",
        model: "gpt-5",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
        createdAt: 1_700_000_100_000,
      }),
    ];
    const next = mergeNativeCliDiskSessions(prev, "/repo", "demo", "codex", [diskItem()], "sonnet");
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("wise-tab-1");
    expect(next[0]!.nativeCliSource).toBe("codex");
    expect(next[0]!.model).toBe("gpt-5.6-terra");
    // 有正文时取更早时间，避免侧栏排序把历史会话顶到今天。
    expect(next[0]!.createdAt).toBe(1_700_000_000_000);
  });

  test("does not claim native source for a row that belongs to another engine", () => {
    const prev = [
      session({ id: "wise-tab-1", claudeSessionId: "019fba5c-thread", executionEngine: "claude" }),
    ];
    const next = mergeNativeCliDiskSessions(prev, "/repo", "demo", "codex", [diskItem()], "sonnet");
    expect(next[0]!.nativeCliSource).toBeUndefined();
  });
});

describe("dedupeNativeCliSessionTabs", () => {
  test("restores duplicate Codex tabs with the repository path and richer history in either order", () => {
    const parent = session({ id: "native-id", nativeCliSource: "codex", repositoryPath: "/work",
      repositoryName: "work", messages: [{ role: "user", content: "history", timestamp: 1 }] });
    const child = session({ id: parent.id, nativeCliSource: "codex", repositoryPath: "/work/repo",
      repositoryName: "repo" });
    for (const rows of [[parent, child], [child, parent]]) {
      const next = dedupeNativeCliSessionTabs(rows);
      expect(next).toHaveLength(1);
      expect(next[0]!.repositoryPath).toBe(child.repositoryPath);
      expect(next[0]!.repositoryName).toBe(child.repositoryName);
      expect(next[0]!.messages).toEqual(parent.messages);
      expect(findSessionByTabOrClaudeId(next, parent.id)).toBe(next[0]);
    }
  });

  test("preserves the running instance while recovering its concrete repository", () => {
    const live = session({ id: "native-id", nativeCliSource: "codex", repositoryPath: "/work",
      status: "running", pendingPrompt: "in progress" });
    const child = session({ id: live.id, nativeCliSource: "codex", repositoryPath: "/work/repo",
      repositoryName: "repo", status: "completed" });
    const next = dedupeNativeCliSessionTabs([live, child]);
    expect(next).toHaveLength(1);
    expect(next[0]!.status).toBe("running");
    expect(next[0]!.pendingPrompt).toBe("in progress");
    expect(next[0]!.repositoryPath).toBe("/work/repo");
  });

  test("keeps distinct Wise tabs that share a native resume id", () => {
    const rows = [session({ id: "wise-a", claudeSessionId: "native-id", nativeCliSource: "codex" }),
      session({ id: "wise-b", claudeSessionId: "native-id", nativeCliSource: "codex" })];
    expect(dedupeNativeCliSessionTabs(rows)).toBe(rows);
  });
});

describe("isDroppableNativeCliPlaceholder", () => {
  test("drops a stale native index placeholder", () => {
    const row = session({
      id: "019fba5c-thread",
      claudeSessionId: "019fba5c-thread",
      nativeCliSource: "codex",
      status: "completed",
    });
    expect(isDroppableNativeCliPlaceholder(row, "codex", new Set())).toBe(true);
  });

  test("keeps placeholders that have messages, are live, or belong to another engine", () => {
    const withMessages = session({
      id: "019fba5c-thread",
      claudeSessionId: "019fba5c-thread",
      nativeCliSource: "codex",
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
    });
    const running = session({
      id: "019fba5c-thread",
      claudeSessionId: "019fba5c-thread",
      nativeCliSource: "codex",
      status: "running",
    });
    const otherEngine = session({ id: "x", nativeCliSource: "deepseek" });
    expect(isDroppableNativeCliPlaceholder(withMessages, "codex", new Set())).toBe(false);
    expect(isDroppableNativeCliPlaceholder(running, "codex", new Set())).toBe(false);
    expect(isDroppableNativeCliPlaceholder(otherEngine, "codex", new Set())).toBe(false);
  });

  test("keeps a Wise tab whose id and native id have diverged", () => {
    const row = session({
      id: "wise-tab-1",
      claudeSessionId: "019fba5c-thread",
      nativeCliSource: "codex",
    });
    expect(isDroppableNativeCliPlaceholder(row, "codex", new Set())).toBe(false);
  });
});
