import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  monitorSessionsOverviewFingerprint,
  monitorSessionsTerminalStatusFingerprint,
} from "./useMonitorSessionsForOverview";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    id: partial.id,
    claudeSessionId: partial.claudeSessionId ?? partial.id,
    repositoryPath: partial.repositoryPath ?? "/repo",
    repositoryName: partial.repositoryName ?? "repo",
    model: "",
    status: partial.status ?? "idle",
    createdAt: 1,
    pendingPrompt: "",
    messages: partial.messages ?? [],
    ...partial,
  };
}

describe("monitorSessionsOverviewFingerprint", () => {
  test("ignores small streaming growth within same bucket", () => {
    const short = session({
      id: "a",
      status: "running",
      messages: [{ id: "m1", role: "assistant", content: "x".repeat(100), timestamp: 1 }],
    });
    const longer = session({
      id: "a",
      status: "running",
      messages: [{ id: "m1", role: "assistant", content: "x".repeat(150), timestamp: 1 }],
    });
    expect(monitorSessionsOverviewFingerprint([short])).toBe(
      monitorSessionsOverviewFingerprint([longer]),
    );
  });

  test("changes when status changes", () => {
    const idle = session({ id: "a", status: "idle" });
    const running = session({ id: "a", status: "running" });
    expect(monitorSessionsOverviewFingerprint([idle])).not.toBe(
      monitorSessionsOverviewFingerprint([running]),
    );
  });
});

describe("monitorSessionsTerminalStatusFingerprint", () => {
  test("ignores assistant content growth without new messages", () => {
    const short = session({
      id: "w",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        { id: "a1", role: "assistant", content: "x".repeat(50), timestamp: 2 },
      ],
    });
    const longer = session({
      id: "w",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        { id: "a1", role: "assistant", content: "x".repeat(500), timestamp: 2 },
      ],
    });
    expect(monitorSessionsTerminalStatusFingerprint([short])).toBe(
      monitorSessionsTerminalStatusFingerprint([longer]),
    );
  });

  test("changes when a new message is appended", () => {
    const one = session({
      id: "w",
      status: "running",
      messages: [{ id: "u1", role: "user", content: "go", timestamp: 1 }],
    });
    const two = session({
      id: "w",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        { id: "a1", role: "assistant", content: "ok", timestamp: 2 },
      ],
    });
    expect(monitorSessionsTerminalStatusFingerprint([one])).not.toBe(
      monitorSessionsTerminalStatusFingerprint([two]),
    );
  });
});
