import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async (_cmd: string, _payload?: unknown) => ({}));

mock.module("@tauri-apps/api/core", () => ({
  invoke,
  transformCallback: () => 0,
  CHANNEL_PREFIX: "__CHANNEL__",
  isTauri: () => true,
}));
mock.module("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

describe("cursorAgentExecution service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("wraps execute_cursor_acp with params envelope", async () => {
    const { executeCursorCode } = await import("./cursorAgentExecution");

    await executeCursorCode(
      "/repo/demo",
      "fix bug",
      "composer-2.5",
      "inv-1",
      "tab-1",
      "agent-1",
      { demo: { type: "stdio", command: "echo", args: [] } },
      [{ path: "/tmp/a.png", mimeType: "image/png" }],
    );

    expect(invoke).toHaveBeenCalledWith("execute_cursor_acp", {
      params: {
        projectPath: "/repo/demo",
        prompt: "fix bug",
        model: "composer-2.5",
        invocationKey: "inv-1",
        tabSessionId: "tab-1",
        cursorAgentId: "agent-1",
        mode: undefined,
        autoApprovePermissions: undefined,
        cursorAttachments: [{ path: "/tmp/a.png", mimeType: "image/png" }],
      },
    });
  });
});
