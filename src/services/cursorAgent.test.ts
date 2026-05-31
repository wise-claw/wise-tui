import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async (_cmd: string, _payload?: unknown) => ({}));

mock.module("@tauri-apps/api/core", () => ({ invoke }));

describe("cursorAgent service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("wraps status and probe commands", async () => {
    const { getCursorAgentStatus, probeCursorAgent } = await import("./cursorAgent");

    await getCursorAgentStatus();
    await probeCursorAgent();

    expect(invoke).toHaveBeenCalledWith("cursor_agent_get_status");
    expect(invoke).toHaveBeenCalledWith("cursor_agent_probe");
  });

  test("wraps api key commands with trimmed payload", async () => {
    const { clearCursorApiKey, setCursorApiKey } = await import("./cursorAgent");

    await setCursorApiKey("  cursor_test_key  ");
    await clearCursorApiKey();

    expect(invoke).toHaveBeenCalledWith("cursor_agent_set_api_key", {
      apiKey: "cursor_test_key",
    });
    expect(invoke).toHaveBeenCalledWith("cursor_agent_clear_api_key");
  });

  test("rejects empty api key before invoke", async () => {
    const { setCursorApiKey } = await import("./cursorAgent");

    await expect(setCursorApiKey("   ")).rejects.toThrow("Cursor API Key 不能为空");
    expect(invoke).not.toHaveBeenCalled();
  });
});
