import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { appendAssistantStreamParts } from "./claudeStreamAssembler";

function session(messages: ClaudeSession["messages"]): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: "claude-1",
    repositoryPath: "/repo",
    repositoryName: "demo/员工:终端02",
    model: "sonnet",
    status: "running",
    messages,
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("appendAssistantStreamParts", () => {
  test("does not drop assistant reply that starts with the same greeting as user prompt", () => {
    const base = session([{ role: "user", content: "你好", timestamp: 1 }]);
    const next = appendAssistantStreamParts(base, [{ type: "text", text: "你好" }]);
    expect(next.messages.some((item) => item.role === "assistant")).toBe(true);
    expect(next.messages[next.messages.length - 1]?.content).toBe("你好");
  });

  test("appends full assistant reply after short greeting prompt", () => {
    const base = session([{ role: "user", content: "你好", timestamp: 1 }]);
    const next = appendAssistantStreamParts(base, [
      { type: "text", text: "你好！👋 有什么我可以帮你的？" },
    ]);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[1]?.role).toBe("assistant");
    expect(next.messages[1]?.content).toBe("你好！👋 有什么我可以帮你的？");
  });
});
