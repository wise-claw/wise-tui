import { describe, expect, test } from "bun:test";
import { areChatInspectorPropsEqual } from "./chatInspectorPropsEqual";
import type { ChatInspectorProps } from "./ChatInspector";
import type { ClaudeSession } from "../../types";

function baseProps(overrides: Partial<ChatInspectorProps> = {}): ChatInspectorProps {
  return {
    dark: false,
    collapsed: false,
    ...overrides,
  };
}

function monitorSession(id: string, messages: ClaudeSession["messages"] = []): ClaudeSession {
  return {
    id,
    status: "running",
    messages,
    repositoryPath: "/tmp/demo",
    repositoryName: "demo",
    createdAt: "",
    updatedAt: "",
  };
}

describe("areChatInspectorPropsEqual", () => {
  test("ignores monitor session reference when fingerprint matches", () => {
    const shared = baseProps();
    const message = { id: "m1", role: "assistant" as const, content: "hi", timestamp: 1 };
    const prev = {
      ...shared,
      monitorPanelSessions: [monitorSession("a", [message])],
    };
    const next = {
      ...shared,
      monitorPanelSessions: [
        monitorSession("a", [{ ...message, content: "hi there — streaming grow" }]),
      ],
    };
    expect(areChatInspectorPropsEqual(prev, next)).toBe(true);
  });

  test("detects collapsed changes", () => {
    const prev = baseProps({ collapsed: false });
    const next = baseProps({ collapsed: true });
    expect(areChatInspectorPropsEqual(prev, next)).toBe(false);
  });
});
