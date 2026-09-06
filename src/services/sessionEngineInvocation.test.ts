import { beforeEach, describe, expect, it, mock } from "bun:test";

let failListenPrefix: string | null = null;
let delayListenPrefix: string | null = null;
let releaseListen: (() => void) | null = null;
let releaseSpawn: (() => void) | null = null;
let hangCancellation = false;
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const invoke = mock(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "cancel_claude_invocation") return hangCancellation ? new Promise(() => {}) : false;
  if (cmd === "shutdown_codex_rpc") return undefined;
  const rpcParams = args?.params as Record<string, unknown> | undefined;
  const invocationKey = typeof args?.invocationKey === "string"
    ? args.invocationKey
    : typeof rpcParams?.invocationKey === "string"
      ? rpcParams.invocationKey
      : undefined;
  if (!invocationKey) return undefined;
  if (args?.prompt === "hung-spawn") return new Promise<void>((resolve) => { releaseSpawn = resolve; });
  if (args?.prompt === "failed-spawn") throw new Error("spawn rejected");
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
    if (failListenPrefix && event.startsWith(failListenPrefix)) throw new Error("listen rejected");
    if (delayListenPrefix && event.startsWith(delayListenPrefix)) {
      await new Promise<void>((resolve) => { releaseListen = resolve; });
    }
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
    failListenPrefix = null;
    delayListenPrefix = null;
    releaseListen = null;
    releaseSpawn = null;
    hangCancellation = false;
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
  it("releases partial subscriptions when registration fails", async () => {
    failListenPrefix = "claude-error";
    await expect(executeSessionEngineAndWait({
      executionEngine: "codex", repositoryPath: "/tmp/repo", prompt: "hello",
    })).rejects.toThrow("listen rejected");
    expect(listeners.size).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("releases all subscriptions when spawn fails", async () => {
    await expect(executeSessionEngineAndWait({
      executionEngine: "codex", repositoryPath: "/tmp/repo", prompt: "failed-spawn",
    })).rejects.toThrow("spawn rejected");
    expect(listeners.size).toBe(0);
  });

  it("bounds startup IPC and retries cancellation when startup returns late", async () => {
    const result = await executeSessionEngineAndWait({
      executionEngine: "codex", repositoryPath: "/tmp/repo", prompt: "hung-spawn", timeoutMs: 10,
    });
    expect(result.success).toBe(false);
    expect(listeners.size).toBe(0);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "cancel_claude_invocation")).toHaveLength(1);
    releaseSpawn?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "cancel_claude_invocation")).toHaveLength(2);
  });

  it("returns timeout even if cancellation IPC never settles", async () => {
    hangCancellation = true;
    const result = await executeSessionEngineAndWait({
      executionEngine: "codex", repositoryPath: "/tmp/repo", prompt: "never-complete", timeoutMs: 10,
    });
    expect(result.success).toBe(false);
    expect(result.errorLines.join(" ")).toContain("timeout");
    expect(listeners.size).toBe(0);
  }, 1000);

  it("cleans late listener registrations and never spawns after setup times out", async () => {
    delayListenPrefix = "claude-error";
    const result = await executeSessionEngineAndWait({
      executionEngine: "codex", repositoryPath: "/tmp/repo", prompt: "hello", timeoutMs: 10,
    });
    expect(result.success).toBe(false);
    expect(listeners.size).toBe(0);
    releaseListen?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listeners.size).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("drains trailing output and ignores duplicate completion events", async () => {
    const pending = executeSessionEngineAndWait({
      executionEngine: "codex", repositoryPath: "/tmp/repo", prompt: "never-complete", timeoutMs: 1000,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const complete = [...listeners.entries()].find(([name]) => name.startsWith("claude-complete"))![1];
    const output = [...listeners.entries()].find(([name]) => name.startsWith("claude-output"))![1];
    complete({ payload: { success: true } });
    complete({ payload: { success: false } });
    output({ payload: "tail output" });
    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.outputLines).toContain("tail output");
    expect(listeners.size).toBe(0);
  });

});
