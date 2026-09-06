import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClaudeSession } from "../types";
import type { SessionActionHandlersDeps } from "./useClaudeSessions.sessionActions";
import { beginSessionTurn, endSessionTurn, hasActiveSessionTurn, observeSessionTurnStatus, subscribeSessionTurns, resetSessionTurnStoreForTests } from "../stores/sessionTurnStore";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => undefined,
  isTauri: () => false,
  Channel: class {},
  transformCallback: () => 0,
  PluginListener: class {},
  addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (path: string) => path,
}));
const { createSessionActionHandlers } = await import("./useClaudeSessions.sessionActions");

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function harness() {
  const session: ClaudeSession = {
    id: "tab", claudeSessionId: null, repositoryPath: "/tmp/repo", repositoryName: "repo",
    model: "", status: "idle", messages: [], createdAt: 0, pendingPrompt: "",
  };
  const deps: SessionActionHandlersDeps = {
    sessionsRef: { current: [session] },
    dispatchAbortByTabRef: { current: new Map() },
    executionTeardownByTabRef: { current: new Map() },
    sessionIdMapRef: { current: new Map() },
    executeSessionRetryCountRef: { current: new Map() },
    recentExecutePromptBySessionRef: { current: new Map() },
    streamingProcessByTabRef: { current: new Map() },
    streamingProcessActivityByTabRef: { current: new Map() },
    streamingTargetIdRef: { current: null },
    streamTurnSeqRef: { current: 0 },
    lastUserSendNonceRef: { current: 0 },
    assistantStreamTextByTabRef: { current: new Map() },
    expectedTurnNonceByTabIdRef: { current: new Map() },
    registryBootstrapDeadlineByClaudeSidRef: { current: new Map() },
    claudeInvocationInflightRef: { current: new Map() },
    pendingTurnFailoverRef: { current: null },
    attemptTurnFailoverAndRetryRef: { current: async () => false },
    claudeSessionsOptionsRef: { current: undefined },
    streamingSessionStreamDetachByTabRef: { current: new Map() },
    diskLoadDoneRef: { current: new Set() },
    diskTailLinesBySessionRef: { current: new Map() },
    workflowRunBySessionRef: { current: new Map() },
    deferredBackgroundCompactRef: { current: new Map() },
    activeSessionId: "tab", setActiveSessionId: () => {},
    setSessions: (action) => {
      deps.sessionsRef.current = typeof action === "function" ? action(deps.sessionsRef.current) : action;
      for (const row of deps.sessionsRef.current) observeSessionTurnStatus(row.id, row.status === "running" || row.status === "connecting");
    },
    commitSessions: (update) => deps.setSessions(update),
    clearStreamStallTimer: mock(() => {}), scheduleStreamStallTimer: mock(() => {}),
    resolveSessionExecutionEngine: () => "claude",
    runClaudeTurnWithContextGuard: mock(async () => {}),
    cancelHostExecutionForTab: mock(async () => {}),
    detachClaudeInvocationsForSessionKey: () => {},
    purgeStreamSidecarsForSession: () => new Set(),
  };
  return { deps, actions: createSessionActionHandlers(deps) };
}

beforeEach(resetSessionTurnStoreForTests);
describe("session dispatch lifecycle", () => {
  test("a rejected missing session never starts later in the background", async () => {
    const { deps, actions } = harness();
    expect(actions.executeSession("missing", "hello")).toBe(false);
    deps.sessionsRef.current.push({ ...deps.sessionsRef.current[0]!, id: "missing" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(deps.runClaudeTurnWithContextGuard).not.toHaveBeenCalled();
    expect(deps.executeSessionRetryCountRef.current.size).toBe(0);
  });
  test("empty input is rejected without creating a turn or bubble", () => {
    const { deps, actions } = harness();
    expect(actions.executeSession("tab", "  ")).toBe(false);
    expect(hasActiveSessionTurn("tab")).toBe(false);
    expect(deps.sessionsRef.current[0]!.messages).toHaveLength(0);
  });
  test("repeated clicks spawn once; a different message stays with its caller", () => {
    const { deps, actions } = harness();
    expect(actions.executeSession("tab", "hello")).toBe(true);
    expect(actions.executeSession("tab", "hello")).toBe(true);
    expect(actions.executeSession("tab", "next")).toBe(false);
    expect(deps.runClaudeTurnWithContextGuard).toHaveBeenCalledTimes(1);
    expect(deps.sessionsRef.current[0]!.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });
  test("blocked fresh dispatch does not erase the existing process mapping", () => {
    const { deps, actions } = harness();
    deps.sessionIdMapRef.current.set("tab", "real");
    deps.streamingProcessByTabRef.current.set("tab", { claudeSessionId: "real" });
    deps.claudeSessionsOptionsRef.current = { beforeSpawnClaudeRef: { current: () => ({ ok: false, message: "blocked" }) } };
    expect(actions.executeTerminalSession("tab", "hello")).toBe(false);
    expect(deps.sessionIdMapRef.current.get("tab")).toBe("real");
    expect(deps.streamingProcessByTabRef.current.has("tab")).toBe(true);
  });
  test("late failure of a superseded turn cannot overwrite the new turn", async () => {
    const { deps, actions } = harness();
    const old = deferred();
    deps.runClaudeTurnWithContextGuard = mock(() => old.promise);
    const bound = createSessionActionHandlers(deps);
    bound.executeSession("tab", "old");
    endSessionTurn("tab");
    beginSessionTurn("tab");
    deps.pendingTurnFailoverRef.current = { ...deps.pendingTurnFailoverRef.current!, prompt: "new", turnNonce: 999 };
    old.reject(new Error("old startup failed"));
    await tick();
    expect(deps.sessionsRef.current[0]!.status).toBe("running");
    expect(deps.pendingTurnFailoverRef.current?.prompt).toBe("new");
    expect(hasActiveSessionTurn("tab")).toBe(true);
  });
  test("startup failure allows immediate retry of the same text", async () => {
    const { deps } = harness();
    deps.runClaudeTurnWithContextGuard = mock(async () => { throw new Error("spawn failed"); });
    const actions = createSessionActionHandlers(deps);
    actions.executeSession("tab", "hello");
    await tick();
    expect(hasActiveSessionTurn("tab")).toBe(false);
    expect(actions.executeSession("tab", "hello")).toBe(true);
    expect(deps.runClaudeTurnWithContextGuard).toHaveBeenCalledTimes(2);
    await tick();
  });
  test("cancel blocks a new spawn until the old host cancellation completes", async () => {
    const { deps } = harness();
    const stop = deferred();
    deps.cancelHostExecutionForTab = mock(() => stop.promise);
    const actions = createSessionActionHandlers(deps);
    actions.executeSession("tab", "hello");
    const signal = deps.dispatchAbortByTabRef.current.get("tab")!.signal;
    actions.cancelSession("tab");
    expect(signal.aborted).toBe(true);
    expect(actions.executeSession("tab", "next")).toBe(false);
    expect(hasActiveSessionTurn("tab")).toBe(true);
    let wokeAfterStop = false;
    const unsubscribe = subscribeSessionTurns(() => {
      if (!hasActiveSessionTurn("tab")) wokeAfterStop = true;
    });
    stop.resolve();
    await deps.executionTeardownByTabRef.current.get("tab");
    unsubscribe();
    expect(wokeAfterStop).toBe(true);
    expect(actions.executeSession("tab", "next")).toBe(true);
  });
  test("blocked send rejects before clearing buffers or advancing the nonce", async () => {
    const { deps, actions } = harness();
    deps.assistantStreamTextByTabRef.current.set("tab", "keep");
    deps.claudeSessionsOptionsRef.current = { beforeSpawnClaudeRef: { current: () => ({ ok: false, message: "blocked" }) } };
    await expect(actions.sendMessageToSession("tab", "hello")).rejects.toThrow("blocked");
    expect(deps.streamTurnSeqRef.current).toBe(0);
    expect(deps.assistantStreamTextByTabRef.current.get("tab")).toBe("keep");
    expect(hasActiveSessionTurn("tab")).toBe(false);
  });
  test("send registers a turn and clears it on failure", async () => {
    const { deps } = harness();
    const run = deferred();
    deps.runClaudeTurnWithContextGuard = mock(() => run.promise);
    const actions = createSessionActionHandlers(deps);
    const pending = actions.sendMessageToSession("tab", "hello");
    expect(hasActiveSessionTurn("tab")).toBe(true);
    run.reject(new Error("failed"));
    await expect(pending).rejects.toThrow("failed");
    expect(hasActiveSessionTurn("tab")).toBe(false);
    expect(deps.clearStreamStallTimer).toHaveBeenCalledWith("tab");
  });
  test("close cancels the host and late startup rejection cannot restore the removed tab", async () => {
    const { deps } = harness();
    const run = deferred();
    deps.runClaudeTurnWithContextGuard = mock(() => run.promise);
    const actions = createSessionActionHandlers(deps);
    actions.executeSession("tab", "hello");
    actions.closeSession("tab");
    expect(deps.cancelHostExecutionForTab).toHaveBeenCalledWith("tab", null);
    expect(deps.sessionsRef.current).toHaveLength(0);
    run.reject(new Error("late failure"));
    await tick();
    expect(deps.sessionsRef.current).toHaveLength(0);
    expect(hasActiveSessionTurn("tab")).toBe(false);
  });
  test("send passes normalized slash commands to execution", async () => {
    const { deps, actions } = harness();
    await actions.sendMessageToSession("tab", "  /compact  ");
    expect(deps.runClaudeTurnWithContextGuard).toHaveBeenCalledWith(expect.objectContaining({ prompt: "/compact" }));
  });

});
