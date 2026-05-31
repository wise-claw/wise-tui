import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async (_cmd: string, _payload?: unknown) => ({}));

mock.module("@tauri-apps/api/core", () => ({ invoke }));

describe("cursorAgentExecution service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("wraps execute_cursor_code with camelCase payload", async () => {
    const { executeCursorCode } = await import("./cursorAgentExecution");

    await executeCursorCode(
      "/repo/demo",
      "fix bug",
      "composer-2.5",
      "inv-1",
      "tab-1",
      "agent-1",
      "ctx-1",
      { demo: { type: "stdio", command: "echo", args: [] } },
      [{ path: "/tmp/a.png", mimeType: "image/png" }],
    );

    expect(invoke).toHaveBeenCalledWith("execute_cursor_code", {
      projectPath: "/repo/demo",
      prompt: "fix bug",
      model: "composer-2.5",
      mcpServers: { demo: { type: "stdio", command: "echo", args: [] } },
      cursorAttachments: [{ path: "/tmp/a.png", mimeType: "image/png" }],
      invocationKey: "inv-1",
      tabSessionId: "tab-1",
      cursorAgentId: "agent-1",
      trellisContextId: "ctx-1",
    });
  });
});
