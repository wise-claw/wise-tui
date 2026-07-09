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
  test("ignores streaming growth on running sessions", () => {
    const short = session({
      id: "a",
      status: "running",
      messages: [{ id: "m1", role: "assistant", content: "x".repeat(100), timestamp: 1 }],
    });
    const longer = session({
      id: "a",
      status: "running",
      messages: [{ id: "m1", role: "assistant", content: "x".repeat(900), timestamp: 1 }],
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

  test("changes when a running session receives a new user turn", () => {
    const oneTurn = session({
      id: "w",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        { id: "a1", role: "assistant", content: "ok", timestamp: 2 },
      ],
    });
    const twoTurns = session({
      id: "w",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        { id: "a1", role: "assistant", content: "ok", timestamp: 2 },
        { id: "u2", role: "user", content: "again", timestamp: 3 },
      ],
    });
    expect(monitorSessionsTerminalStatusFingerprint([oneTurn])).not.toBe(
      monitorSessionsTerminalStatusFingerprint([twoTurns]),
    );
  });

  test("changes running fingerprints when only the last user boundary changes", () => {
    const oneTurn = session({
      id: "w",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        { id: "a1", role: "assistant", content: "ok", timestamp: 2 },
        { id: "a2", role: "assistant", content: "still running", timestamp: 3 },
      ],
    });
    const twoTurns = session({
      id: "w",
      status: "running",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        { id: "u2", role: "user", content: "again", timestamp: 2 },
        { id: "a2", role: "assistant", content: "still running", timestamp: 3 },
      ],
    });
    expect(monitorSessionsTerminalStatusFingerprint([oneTurn])).not.toBe(
      monitorSessionsTerminalStatusFingerprint([twoTurns]),
    );
  });

  test("changes settled assistant preview length buckets", () => {
    const short = session({
      id: "w",
      status: "completed",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: "x".repeat(50),
          timestamp: 2,
          parts: [{ type: "text", text: "x".repeat(50) }],
        },
      ],
    });
    const longer = session({
      id: "w",
      status: "completed",
      messages: [
        { id: "u1", role: "user", content: "go", timestamp: 1 },
        {
          id: "a1",
          role: "assistant",
          content: "x".repeat(200),
          timestamp: 2,
          parts: [{ type: "text", text: "x".repeat(200) }],
        },
      ],
    });
    expect(monitorSessionsTerminalStatusFingerprint([short])).not.toBe(
      monitorSessionsTerminalStatusFingerprint([longer]),
    );
  });
});
