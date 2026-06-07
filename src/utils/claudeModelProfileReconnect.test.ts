import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { resolveClaudeResumePromptAfterModelSwitch } from "./claudeModelProfileReconnect";

function sessionWithMessages(
  messages: ClaudeSession["messages"],
): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: "cc-1",
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "running",
    messages,
    createdAt: 0,
    pendingPrompt: "",
  };
}

describe("resolveClaudeResumePromptAfterModelSwitch", () => {
  test("prefers pending turn prompt", () => {
    const session = sessionWithMessages([
      { id: 1, role: "user", content: "older", timestamp: 1 },
      { id: 2, role: "user", content: "latest", timestamp: 2 },
    ]);
    expect(
      resolveClaudeResumePromptAfterModelSwitch({
        session,
        pendingTurnPrompt: "in-flight",
      }),
    ).toBe("in-flight");
  });

  test("falls back to last renderable user message", () => {
    const session = sessionWithMessages([
      { id: 1, role: "user", content: "older", timestamp: 1 },
      { id: 2, role: "user", content: "latest", timestamp: 2 },
    ]);
    expect(
      resolveClaudeResumePromptAfterModelSwitch({
        session,
        pendingTurnPrompt: "  ",
      }),
    ).toBe("latest");
  });

  test("returns null when no user prompt exists", () => {
    const session = sessionWithMessages([
      { id: 1, role: "assistant", content: "hi", timestamp: 1 },
    ]);
    expect(
      resolveClaudeResumePromptAfterModelSwitch({
        session,
        pendingTurnPrompt: null,
      }),
    ).toBeNull();
  });
});
