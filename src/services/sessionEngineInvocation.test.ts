import { beforeEach, describe, expect, it, mock } from "bun:test";

const listeners = new Map<string, (event: { payload: unknown }) => void>();
const invoke = mock(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "cancel_claude_invocation") return false;
  if (cmd === "shutdown_codex_rpc") return undefined;
  const rpcParams = args?.params as Record<string, unknown> | undefined;
  const invocationKey = typeof args?.invocationKey === "string"
    ? args.invocationKey
    : typeof rpcParams?.invocationKey === "string"
      ? rpcParams.invocationKey
      : undefined;
  if (!invocationKey) return undefined;
  if (args?.prompt === "never-complete" || rpcParams?.prompt === "never-complete") {
    return undefined;
  }
  queueMicrotask(() => {
    if (cmd === "execute_codex_code" || cmd === "execute_codex_rpc") {
      listeners.get(`claude-output:invocation:${invocationKey}`)?.({
        payload: JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "fix: polish" }] },
        }),
      });
    }
    listeners.get(`claude-complete:invocation:${invocationKey}`)?.({
      payload: { success: true },
    });
  });
  return undefined;
});

mock.module("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => false,
  transformCallback: () => 0,
  Channel: class {},
  PluginListener: class {},
  addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (s: string) => s,
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return () => {
      listeners.delete(event);
    };
  },
}));

const { executeSessionEngineAndWait, supportsSessionEngineOneshotWait } = await import(
  "./sessionEngineInvocation"
);

describe("sessionEngineInvocation", () => {
  beforeEach(() => {
    listeners.clear();
    invoke.mockClear();
  });

  it("reports gemini as unsupported for oneshot wait", () => {
    expect(supportsSessionEngineOneshotWait("gemini")).toBe(false);
    expect(supportsSessionEngineOneshotWait("codex")).toBe(true);
  });

  it("returns failure without spawning when engine is gemini", async () => {
    const result = await executeSessionEngineAndWait({
      executionEngine: "gemini",
      repositoryPath: "/tmp/repo",
      prompt: "hello",
    });
    expect(result.success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("spawns codex oneshot and resolves on complete event", async () => {
    const result = await executeSessionEngineAndWait({
      executionEngine: "codex",
      repositoryPath: "/tmp/repo",
      prompt: "generate commit",
      timeoutMs: 5_000,
    });

    expect(invoke).toHaveBeenCalled();
    expect(invoke.mock.calls.some((call) => call[0] === "execute_codex_code")).toBe(true);
    const codexCall = invoke.mock.calls.find((call) => call[0] === "execute_codex_code");
    expect(codexCall?.[1]).toMatchObject({
      projectPath: "/tmp/repo",
      forceNewSession: true,
      readOnly: true,
    });
    expect(result.success).toBe(true);
    expect(result.outputLines.some((line) => line.includes("fix: polish"))).toBe(true);
  });

  it("spawns claude oneshot by default", async () => {
    const result = await executeSessionEngineAndWait({
      repositoryPath: "/tmp/repo",
      prompt: "generate commit",
      timeoutMs: 5_000,
    });

    expect(invoke.mock.calls.some((call) => call[0] === "execute_claude_code")).toBe(true);
    const claudeCall = invoke.mock.calls.find((call) => call[0] === "execute_claude_code");
    expect(claudeCall?.[1]).toMatchObject({
      projectPath: "/tmp/repo",
      connectionMode: "oneshot",
      bare: true,
    });
    expect(result.success).toBe(true);
  });

  it("spawns Codex RPC as an isolated low-effort read-only task", async () => {
    const result = await executeSessionEngineAndWait({
      executionEngine: "codex-rpc",
      repositoryPath: "/tmp/repo",
      prompt: "generate commit",
      timeoutMs: 5_000,
    });

    const rpcCall = invoke.mock.calls.find((call) => call[0] === "execute_codex_rpc");
    const params = rpcCall?.[1]?.params as Record<string, unknown> | undefined;
    expect(params).toMatchObject({
      projectPath: "/tmp/repo",
      effort: "low",
      readOnly: true,
    });
    expect(params?.tabSessionId).toBe(params?.invocationKey);
    expect(result.success).toBe(true);
  });

  it("shuts down a timed-out Codex RPC task", async () => {
    const result = await executeSessionEngineAndWait({
      executionEngine: "codex-rpc",
      repositoryPath: "/tmp/repo",
      prompt: "never-complete",
      timeoutMs: 5,
    });

    expect(result.success).toBe(false);
    const rpcCall = invoke.mock.calls.find((call) => call[0] === "execute_codex_rpc");
    const invocationKey = (rpcCall?.[1]?.params as Record<string, unknown>)?.invocationKey;
    expect(invoke.mock.calls.some((call) =>
      call[0] === "shutdown_codex_rpc"
      && (call[1]?.params as Record<string, unknown>)?.sessionId === invocationKey
    )).toBe(true);
  });
});
