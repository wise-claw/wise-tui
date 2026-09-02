import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async () => undefined);

mock.module("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
mock.module("@tauri-apps/api/event", () => ({ listen: mock(async () => () => {}) }));
mock.module("../utils/safeTauriUnlisten", () => ({ safeUnlisten: mock(() => undefined) }));

describe("claude service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("forwards interactive Claude starts with the spawn command payload", async () => {
    const { executeClaudeCode, resumeClaudeCode } = await import("./claude");

    await executeClaudeCode("/repo", "hello", "sonnet", "inv-1", "oneshot", "scope", 2, false);
    await resumeClaudeCode("/repo", "sid-1", "continue", "sonnet", "inv-2", "oneshot", "scope", 2);

    expect(invoke).toHaveBeenCalledWith("execute_claude_code", {
      projectPath: "/repo",
      prompt: "hello",
      model: "sonnet",
      invocationKey: "inv-1",
      connectionMode: "oneshot",
      concurrencyScopeKey: "scope",
      concurrencyLimit: 2,
      bare: false,
      cliExtras: null,
      anthropicProxyBypass: false,
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
      cliExtras: null,
      anthropicProxyBypass: false,
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
      cliExtras: null,
      anthropicProxyBypass: false,
    });
  });
});
