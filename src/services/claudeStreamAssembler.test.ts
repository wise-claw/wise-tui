import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  appendAssistantStreamParts,
  applyToolResultPartsToMessages,
  foldToolResultUserMessagesIntoAssistant,
} from "./claudeStreamAssembler";

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

describe("foldToolResultUserMessagesIntoAssistant", () => {
  function assistantTool(id: string, name: string): ClaudeMessage {
    return {
      id: 1,
      role: "assistant",
      content: "",
      timestamp: 1,
      parts: [
        {
          type: "tool_use",
          id,
          name,
          input: { taskId: "3" },
          status: "completed",
        },
      ],
    };
  }

  function toolResultUser(id: string, output: string): ClaudeMessage {
    return {
      id: 2,
      role: "user",
      content: output,
      timestamp: 2,
      parts: [
        {
          type: "tool_use",
          id,
          name: "",
          input: {},
          output,
          status: "completed",
        },
      ],
    };
  }

  test("merges tool-only user message into preceding assistant tool_use", () => {
    const folded = foldToolResultUserMessagesIntoAssistant([
      assistantTool("toolu_1", "TaskUpdate"),
      toolResultUser("toolu_1", "Updated task #3 status"),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.parts[0]).toMatchObject({
      name: "TaskUpdate",
      output: "Updated task #3 status",
    });
  });

  test("applyToolResultPartsToMessages reports matched ids", () => {
    const messages: ClaudeMessage[] = [assistantTool("toolu_1", "TaskList")];
    const updates = [
      {
        type: "tool_use" as const,
        id: "toolu_1",
        name: "",
        input: {},
        output: "task list body",
        status: "completed" as const,
      },
    ];
    const applied = applyToolResultPartsToMessages(messages, updates);
    expect(applied.matchedIds.has("toolu_1")).toBe(true);
    expect(applied.messages[0]?.parts[0]).toMatchObject({ output: "task list body" });
  });
});
