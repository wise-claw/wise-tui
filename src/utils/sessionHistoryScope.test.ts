import { describe, expect, it } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  collectRepositoryPathListingCandidates,
  dedupeClaudeSessionsByIdentity,
  listSessionsForRepositoryPath,
  normalizeSessionRepositoryPath,
} from "./sessionHistoryScope";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    claudeSessionId: null,
    repositoryPath: "/work/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "completed",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...partial,
  };
}

describe("sessionHistoryScope", () => {
  it("normalizeSessionRepositoryPath trims trailing slash", () => {
    expect(normalizeSessionRepositoryPath("/work/repo/")).toBe("/work/repo");
  });

  it("listSessionsForRepositoryPath matches path variants", () => {
    const sessions = [
      session({ id: "a", repositoryPath: "/work/repo/" }),
      session({ id: "b", repositoryPath: "/work/other" }),
    ];
    expect(listSessionsForRepositoryPath(sessions, "/work/repo").map((s) => s.id)).toEqual(["a"]);
  });

  it("listSessionsForRepositoryPath includes project-rooted session for member repo scope", () => {
    const sessions = [
      session({
        id: "project-main",
        repositoryPath: "/eco",
        repositoryName: "Project: eco",
      }),
      session({ id: "member", repositoryPath: "/eco/eco-ai-web" }),
    ];
    expect(listSessionsForRepositoryPath(sessions, "/eco/eco-ai-web").map((s) => s.id).sort()).toEqual([
      "member",
      "project-main",
    ]);
  });

  it("dedupeClaudeSessionsByIdentity keeps richer row", () => {
    const sid = "0123456789abcdef0123456789abcdef";
    const sparse = session({
      id: sid,
      claudeSessionId: sid,
      messages: [],
      createdAt: 10,
    });
    const rich = session({
      id: "tab-local",
      claudeSessionId: sid,
      messages: [{ role: "user", content: "hi", timestamp: 100 }],
      createdAt: 5,
    });
    const next = dedupeClaudeSessionsByIdentity([sparse, rich]);
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("tab-local");
  });

  it("collectRepositoryPathListingCandidates gathers alias paths from sessions", () => {
    const candidates = collectRepositoryPathListingCandidates("/work/repo", [
      session({ id: "x", repositoryPath: "/work/repo/" }),
      session({ id: "y", repositoryPath: "/work/other" }),
    ]);
    expect(candidates).toContain("/work/repo");
    expect(candidates).toContain("/work/repo/");
    expect(candidates).not.toContain("/work/other");
  });

  it("listClaudeDiskSessionsForRepositoryScope resolves without throwing for missing paths", async () => {
    const { listClaudeDiskSessionsForRepositoryScope: listScope } = await import("./sessionHistoryScope");
    const result = await listScope("/tmp/wise-nonexistent-session-history-path", []);
    expect(Array.isArray(result.disk)).toBe(true);
    expect(result.listingPath).toBe("/tmp/wise-nonexistent-session-history-path");
  });
});
