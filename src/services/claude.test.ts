import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async () => undefined);

mock.module("@tauri-apps/api/core", () => ({ invoke }));
mock.module("@tauri-apps/api/event", () => ({ listen: mock(async () => () => {}) }));
mock.module("../utils/safeTauriUnlisten", () => ({ safeUnlisten: mock(() => undefined) }));

describe("claude service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("passes Trellis context id to interactive Claude starts", async () => {
    const { executeClaudeCode, resumeClaudeCode } = await import("./claude");

    await executeClaudeCode("/repo", "hello", "sonnet", "inv-1", "oneshot", "scope", 2, false, " ctx-1 ");
    await resumeClaudeCode("/repo", "sid-1", "continue", "sonnet", "inv-2", "oneshot", "scope", 2, "ctx-1");

    expect(invoke).toHaveBeenCalledWith("execute_claude_code", {
      projectPath: "/repo",
      prompt: "hello",
      model: "sonnet",
      invocationKey: "inv-1",
      connectionMode: "oneshot",
      concurrencyScopeKey: "scope",
      concurrencyLimit: 2,
      bare: false,
      trellisContextId: "ctx-1",
      cliExtras: null,
    });
    expect(invoke).toHaveBeenCalledWith("resume_claude_code", {
      projectPath: "/repo",
      sessionId: "sid-1",
      prompt: "continue",
      model: "sonnet",
      invocationKey: "inv-2",
      connectionMode: "oneshot",
      concurrencyScopeKey: "scope",
      concurrencyLimit: 2,
      trellisContextId: "ctx-1",
      cliExtras: null,
    });
  });

  test("keeps orchestrated bare invocations unbound by default", async () => {
    const { executeClaudeCode } = await import("./claude");

    await executeClaudeCode("/repo", "dispatch", undefined, "inv-1", "oneshot", undefined, undefined, true);

    expect(invoke).toHaveBeenCalledWith("execute_claude_code", {
      projectPath: "/repo",
      prompt: "dispatch",
      model: undefined,
      invocationKey: "inv-1",
      connectionMode: "oneshot",
      concurrencyScopeKey: undefined,
      concurrencyLimit: undefined,
      bare: true,
      trellisContextId: null,
      cliExtras: null,
    });
  });
});
