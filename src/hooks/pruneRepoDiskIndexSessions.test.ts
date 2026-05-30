import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { pruneRepoDiskIndexSessions } from "./useClaudeSessions";

const REPO = "/work/repo";

function diskStub(id: string, at: number): ClaudeSession {
  return {
    id,
    claudeSessionId: id,
    repositoryPath: REPO,
    repositoryName: "repo",
    model: "sonnet",
    status: "completed",
    messages: [],
    createdAt: at,
    pendingPrompt: "",
    diskPreview: "preview",
  };
}

describe("pruneRepoDiskIndexSessions", () => {
  test("drops oldest disk-only index rows beyond limit", () => {
    const sessions = Array.from({ length: 60 }, (_, i) => diskStub(`s-${i}`, i));
    const next = pruneRepoDiskIndexSessions(sessions, REPO, 48);
    expect(next.length).toBe(48);
    expect(next.some((s) => s.id === "s-0")).toBe(false);
    expect(next.some((s) => s.id === "s-59")).toBe(true);
  });
});
