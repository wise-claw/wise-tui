import { beforeEach, expect, mock, test } from "bun:test";
import type { ClaudeEngineHandlersDeps } from "./useClaudeSessions.engines";
import type { ClaudeSession } from "../types";

const invoke = mock(async (command: string) =>
  command === "codex_auth_status"
    ? { ready: true, mode: "chatgpt", detail: "Logged in using ChatGPT" }
    : undefined,
);
let releaseListener: (() => void) | undefined;
let delayListeners = false;
let failListeners = false;
const subscriptions: Array<{ event: string; handler: (event: { payload: unknown }) => void; active: boolean }> = [];
const detached = mock(() => {});
mock.module("@tauri-apps/api/core", () => ({
  invoke, isTauri: () => false, transformCallback: () => 0,
  Channel: class {}, PluginListener: class {}, addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (path: string) => path,
}));
mock.module("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    if (failListeners && event.startsWith("claude-error")) throw new Error("listen failed");
    if (delayListeners) {
      delayListeners = false;
      await new Promise<void>((resolve) => { releaseListener = resolve; });
    }
    const subscription = { event, handler, active: true };
    subscriptions.push(subscription);
    return () => { subscription.active = false; detached(); };
  },
}));
const { createClaudeEngineHandlers } = await import("./useClaudeSessions.engines");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  invoke.mockClear(); detached.mockClear(); releaseListener = undefined;
  delayListeners = false; failListeners = false; subscriptions.length = 0;
});
function harness() {
  const abort = new AbortController();
  const session: ClaudeSession = {
    id: "tab", claudeSessionId: null, repositoryPath: "/tmp/repo", repositoryName: "repo",
    model: "", status: "running", messages: [], createdAt: 0, pendingPrompt: "",
  };
  const deps: ClaudeEngineHandlersDeps = {
    dispatchAbortByTabRef: { current: new Map([["tab", abort]]) },
    streamRuntimeRef: { current: {
      handleOutputForSendTab: () => {}, handleErrorForSendTab: () => {}, handleCompleteForSendTab: () => true,
    } },
    sessionIdMapRef: { current: new Map() }, sessionsRef: { current: [session] },
    claudeInvocationInflightRef: { current: new Map() }, expectedTurnNonceByTabIdRef: { current: new Map([["tab", 1]]) },
    streamingProcessByTabRef: { current: new Map() }, streamingProcessActivityByTabRef: { current: new Map() },
    streamingSessionStreamDetachByTabRef: { current: new Map() }, streamingTargetIdRef: { current: "tab" },
    defaultConnectionKindRef: { current: "oneshot" }, claudeSessionsOptionsRef: { current: undefined },
    detachClaudeInvocationStreamsForTab: (tabId) => {
      for (const [inv, meta] of [...deps.claudeInvocationInflightRef.current]) {
        if (meta.tabId === tabId) { meta.detach(); deps.claudeInvocationInflightRef.current.delete(inv); }
      }
    }, keepInvocationStreamAfterTurnComplete: () => false,
    resolveSpawnExtrasForClaudePrompt: async () => null,
    commitSessions: (update) => { deps.sessionsRef.current = update(deps.sessionsRef.current); },
    scheduleStreamStallTimer: () => {},
  };
  return { abort, deps };
}
const params = { tabSessionId: "tab", turnNonce: 1, invokeConc: null, repositoryPath: "/tmp/repo", prompt: "hello", modelArg: undefined, resumeClaudeSid: null };

test("an unsupported Gemini turn cannot silently execute with Claude", async () => {
  const { deps } = harness();
  deps.claudeSessionsOptionsRef.current = { resolveExecutionEngineRef: { current: () => "gemini" } };
  await expect(createClaudeEngineHandlers(deps).invokeClaudeTurn(params)).rejects.toThrow("尚未支持");
  expect(invoke).not.toHaveBeenCalled();
  expect(subscriptions).toHaveLength(0);
});

function runner(deps: ClaudeEngineHandlersDeps, engine: string) {
  const handlers = createClaudeEngineHandlers(deps);
  return engine === "claude" ? handlers.runClaudeOneshotWithInvocation
    : engine === "codex" ? handlers.runCodexOneshotWithInvocation
    : engine === "codex-rpc" ? handlers.runCodexRpcOneshotWithInvocation
    : engine === "opencode" ? handlers.runOpencodeOneshotWithInvocation
    : engine === "qoder" ? handlers.runQoderOneshotWithInvocation
    : engine === "deepseek" ? handlers.runDeepseekOneshotWithInvocation
    : handlers.runCursorOneshotWithInvocation;
}

for (const engine of ["claude", "codex", "codex-rpc", "opencode", "qoder", "deepseek", "cursor"] as const) {
  test(`${engine} refuses launch and releases partial listeners if event registration fails`, async () => {
    const { deps } = harness();
    failListeners = true;
    await expect(runner(deps, engine)({ ...params, contextExecutionEngine: engine, cursorAgentId: null })).rejects.toThrow("监听注册失败");
    expect(invoke).not.toHaveBeenCalled();
    expect(deps.claudeInvocationInflightRef.current.size).toBe(0);
    expect(subscriptions.filter((s) => s.active)).toHaveLength(0);
  });

  test(`${engine} retires old turn listeners and ignores their queued callbacks`, async () => {
    const { deps } = harness();
    deps.streamRuntimeRef.current!.handleOutputForSendTab = mock(() => {});
    deps.streamRuntimeRef.current!.handleCompleteForSendTab = mock(() => true);
    const run = runner(deps, engine);
    await run({ ...params, contextExecutionEngine: engine, cursorAgentId: null });
    const previous = [...subscriptions];
    for (let nonce = 2; nonce <= 20; nonce += 1) {
      deps.expectedTurnNonceByTabIdRef.current.set("tab", nonce);
      await run({ ...params, turnNonce: nonce, contextExecutionEngine: engine, cursorAgentId: null });
      expect(deps.claudeInvocationInflightRef.current.size).toBe(1);
      expect(subscriptions.filter((s) => s.active)).toHaveLength(6);
    }
    // Tauri may have already queued callbacks when unlisten finishes.
    for (const old of previous) old.handler({ payload: old.event.startsWith("claude-complete") ? { success: true } : "old output" });
    expect(deps.streamRuntimeRef.current!.handleOutputForSendTab).not.toHaveBeenCalled();
    expect(deps.streamRuntimeRef.current!.handleCompleteForSendTab).not.toHaveBeenCalled();
    for (const meta of deps.claudeInvocationInflightRef.current.values()) meta.detach();
  });
}

test("persistent Claude follow-ups keep one session subscription and reject disposed callbacks", async () => {
  const { deps } = harness();
  deps.sessionsRef.current[0]!.claudeSessionId = "real";
  deps.streamingProcessByTabRef.current.set("tab", { claudeSessionId: "real" });
  deps.streamRuntimeRef.current!.handleOutputForSendTab = mock(() => {});
  const run = createClaudeEngineHandlers(deps).runClaudeStreamingWithInvocation;
  await run(params);
  const previous = [...subscriptions];
  await run({ ...params, turnNonce: 2 });
  expect(deps.claudeInvocationInflightRef.current.size).toBe(1);
  expect(subscriptions.filter((s) => s.active)).toHaveLength(3);
  for (const old of previous) old.handler({ payload: "old" });
  expect(deps.streamRuntimeRef.current!.handleOutputForSendTab).not.toHaveBeenCalled();
  for (const meta of deps.claudeInvocationInflightRef.current.values()) meta.detach();
});

for (const engine of ["codex", "codex-rpc"] as const) {
  test(`${engine} interactive turns use the steerable app-server transport`, async () => {
    const { deps } = harness();
    deps.claudeSessionsOptionsRef.current = {
      resolveExecutionEngineRef: { current: () => engine },
    };
    await createClaudeEngineHandlers(deps).invokeClaudeTurn(params);
    expect(invoke.mock.calls.some(([command]) => command === "execute_codex_rpc")).toBe(true);
    expect(invoke.mock.calls.some(([command]) => command === "execute_codex_code")).toBe(false);
  });
}

test("cancelling during Claude spawn configuration prevents launch and releases listeners", async () => {
  const { abort, deps } = harness();
  let release!: () => void;
  deps.resolveSpawnExtrasForClaudePrompt = () => new Promise<null>((resolve) => { release = () => resolve(null); });
  const pending = createClaudeEngineHandlers(deps).runClaudeOneshotWithInvocation(params);
  await tick();
  abort.abort();
  release();
  await expect(pending).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  expect(deps.claudeInvocationInflightRef.current.size).toBe(0);
  expect(detached).toHaveBeenCalledTimes(6);
});

test("a spawn configuration error releases all already registered listeners", async () => {
  const { deps } = harness();
  deps.resolveSpawnExtrasForClaudePrompt = async () => { throw new Error("config failed"); };
  await expect(createClaudeEngineHandlers(deps).runClaudeOneshotWithInvocation(params)).rejects.toThrow("config failed");
  expect(invoke).not.toHaveBeenCalled();
  expect(deps.claudeInvocationInflightRef.current.size).toBe(0);
  expect(detached).toHaveBeenCalledTimes(6);
});

for (const engine of ["codex", "codex-rpc", "opencode", "qoder", "deepseek", "cursor"] as const) {
  test(`cancelling while ${engine} listeners register prevents process launch and stale UI updates`, async () => {
    const { abort, deps } = harness();
    delayListeners = true;
    const handlers = createClaudeEngineHandlers(deps);
    const input = { ...params, contextExecutionEngine: engine };
    const run = engine === "codex" ? handlers.runCodexOneshotWithInvocation
      : engine === "codex-rpc" ? handlers.runCodexRpcOneshotWithInvocation
      : engine === "opencode" ? handlers.runOpencodeOneshotWithInvocation
      : engine === "qoder" ? handlers.runQoderOneshotWithInvocation
      : engine === "deepseek" ? handlers.runDeepseekOneshotWithInvocation
      : handlers.runCursorOneshotWithInvocation;
    const pending = run(input);
    await tick();
    const messagesBeforeCancel = deps.sessionsRef.current[0]!.messages.length;
    abort.abort();
    releaseListener!();
    await expect(pending).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(deps.sessionsRef.current[0]!.messages).toHaveLength(messagesBeforeCancel);
    expect(deps.claudeInvocationInflightRef.current.size).toBe(0);
    expect(detached).toHaveBeenCalledTimes(6);
  });
}
