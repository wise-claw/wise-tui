import { afterAll, afterEach, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { Window } from "happy-dom";
import { createClaudeStreamRuntime } from "./claudeStreamRuntime";
import { ONESHOT_DEFERRED_COMPLETE_FORCE_MS } from "../hooks/useClaudeSessions.transcript";
import type { ClaudeSession } from "../types";

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
const dom = new Window();
beforeAll(() => {
  Object.assign(globalThis, { window: dom, document: dom.document });
});
afterAll(() => {
  Object.assign(globalThis, { window: previousWindow, document: previousDocument });
  dom.happyDOM.cancelAsync();
});
afterEach(() => setSystemTime());
function harness() {
  const session: ClaudeSession = {
    id: "tab", claudeSessionId: "real", repositoryPath: "/tmp/repo", repositoryName: "repo",
    model: "", status: "running", connectionKind: "oneshot", createdAt: 0, pendingPrompt: "",
    messages: [
      { id: "u", role: "user", content: "hello", timestamp: 1 },
      { id: "a", role: "assistant", content: "done", timestamp: 2, parts: [{ type: "text", text: "done" }] },
    ],
  };
  const deps: Parameters<typeof createClaudeStreamRuntime>[0] = {
    sessionsRef: { current: [session] }, streamingTargetIdRef: { current: "tab" },
    sessionIdMapRef: { current: new Map() }, lastStreamLineBySessionRef: { current: new Map() },
    lastStreamTextBySessionRef: { current: new Map() }, lastUserSendNonceRef: { current: 1 },
    assistantStreamTextByTabRef: { current: new Map() },
    expectedTurnNonceByTabIdRef: { current: new Map([["tab", 1], ["real", 1]]) },
    setSessions: (update) => { deps.sessionsRef.current = update(deps.sessionsRef.current); },
    setActiveSessionId: () => {}, ingestAskUserQuestionFromMessageParts: () => {},
    ingestStreamAssistText: () => {}, ingestTodosFromSessionMessages: () => {},
    finalizeTodosAfterSuccessfulTurn: () => {}, migrateSessionKey: () => {},
    notifyCompletion: mock(() => {}), resolveTabIdForClaudeStream: () => "tab",
    resolveTabIdFromCompletePayload: () => "tab",
    resolveSuccessFromCompletePayload: (payload) => (payload as { success: boolean }).success,
  };
  return { deps, runtime: createClaudeStreamRuntime(deps) };
}

describe("stream completion lifecycle", () => {
  test("hidden windows commit final status before notifying and consume completion only once", () => {
    Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "hidden" });
    const { deps, runtime } = harness();
    let notifications = 0;
    deps.notifyCompletion = () => {};
    // The runtime captures callbacks at construction, so bind the observer before rebuilding.
    runtime.dispose();
    const bound = createClaudeStreamRuntime({ ...deps, notifyCompletion: () => {
      notifications += 1;
      expect(deps.sessionsRef.current[0]!.status).toBe("completed");
      expect(bound.handleCompleteForSendTab("tab", { success: true }, 1)).toBe(false);
    } });
    try {
      expect(bound.handleCompleteForSendTab("tab", { success: true }, 1)).toBe(true);
      expect(deps.sessionsRef.current[0]!.status).toBe("completed");
      expect(deps.expectedTurnNonceByTabIdRef!.current.size).toBe(0);
      expect(notifications).toBe(1);
      dom.document.dispatchEvent(new dom.Event("visibilitychange"));
      expect(notifications).toBe(1);
    } finally { bound.dispose(); }
  });

  test("an old completion cannot finish a newer turn", () => {
    const { deps, runtime } = harness();
    deps.expectedTurnNonceByTabIdRef!.current = new Map([["tab", 2], ["real", 2]]);
    try {
      expect(runtime.handleCompleteForSendTab("tab", { success: true }, 1)).toBe(false);
      expect(deps.sessionsRef.current[0]!.status).toBe("running");
      expect(deps.notifyCompletion).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
  });

  test("quiet tool-only output reaches the forced finalizer even after duplicate complete", () => {
    Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "visible" });
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = ((callback: () => void, delay: number) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }) as typeof window.setTimeout;
    const now = Date.now();
    setSystemTime(now);
    const { deps, runtime } = harness();
    deps.sessionsRef.current[0]!.messages[1]!.parts = [
      { type: "tool_use", id: "tool", name: "Read", input: {}, status: "running" },
    ];
    try {
      expect(runtime.handleCompleteForSendTab("tab", { success: true }, 1)).toBe(false);
      const count = scheduled.length;
      setSystemTime(now + 1000);
      expect(runtime.handleCompleteForSendTab("tab", { success: true }, 1)).toBe(false);
      expect(scheduled).toHaveLength(count);
      const last = scheduled.at(-1)!;
      expect(last.delay).toBeGreaterThanOrEqual(ONESHOT_DEFERRED_COMPLETE_FORCE_MS);
      setSystemTime(now + last.delay);
      last.callback();
      expect(deps.sessionsRef.current[0]!.status).toBe("completed");
      expect(deps.notifyCompletion).toHaveBeenCalledTimes(1);
    } finally {
      runtime.dispose();
      window.setTimeout = originalSetTimeout;
    }
  });
});
