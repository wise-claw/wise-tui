import { beforeEach, expect, mock, test } from "bun:test";
import type { ClaudeEngineHandlersDeps } from "./useClaudeSessions.engines";
import type { ClaudeSession } from "../types";

const invoke = mock(async () => undefined);
let releaseListener: (() => void) | undefined;
let delayListeners = false;
const detached = mock(() => {});
mock.module("@tauri-apps/api/core", () => ({
  invoke, isTauri: () => false, transformCallback: () => 0,
  Channel: class {}, PluginListener: class {}, addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (path: string) => path,
}));
mock.module("@tauri-apps/api/event", () => ({
  listen: async () => {
    if (delayListeners) {
      delayListeners = false;
      await new Promise<void>((resolve) => { releaseListener = resolve; });
    }
    return detached;
  },
}));
const { createClaudeEngineHandlers } = await import("./useClaudeSessions.engines");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => { invoke.mockClear(); detached.mockClear(); releaseListener = undefined; delayListeners = false; });
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
    detachClaudeInvocationStreamsForTab: () => {}, keepInvocationStreamAfterTurnComplete: () => false,
    resolveSpawnExtrasForClaudePrompt: async () => null,
    commitSessions: (update) => { deps.sessionsRef.current = update(deps.sessionsRef.current); },
    scheduleStreamStallTimer: () => {},
  };
  return { abort, deps };
}
const params = { tabSessionId: "tab", turnNonce: 1, invokeConc: null, repositoryPath: "/tmp/repo", prompt: "hello", modelArg: undefined, resumeClaudeSid: null };

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

for (const engine of ["codex", "codex-rpc", "opencode", "qoder", "cursor"] as const) {
  test(`cancelling while ${engine} listeners register prevents process launch and stale UI updates`, async () => {
    const { abort, deps } = harness();
    delayListeners = true;
    const handlers = createClaudeEngineHandlers(deps);
    const input = { ...params, contextExecutionEngine: engine };
    const run = engine === "codex" ? handlers.runCodexOneshotWithInvocation
      : engine === "codex-rpc" ? handlers.runCodexRpcOneshotWithInvocation
      : engine === "opencode" ? handlers.runOpencodeOneshotWithInvocation
      : engine === "qoder" ? handlers.runQoderOneshotWithInvocation
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
