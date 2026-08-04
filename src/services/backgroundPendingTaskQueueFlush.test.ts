import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  canBackgroundDispatchPendingTask,
  flushBackgroundPendingTaskQueueForSession,
  resetBackgroundPendingTaskQueueFlushForTests,
  shouldSkipBackgroundPendingFlush,
  type BackgroundPendingFlushContext,
} from "../services/backgroundPendingTaskQueueFlush";
import {
  claimPendingTaskQueueOwner,
  resetPendingTaskQueueOwnerStoreForTests,
} from "../stores/pendingTaskQueueOwnerStore";
import {
  beginSessionTurn,
  endSessionTurn,
  resetSessionTurnStoreForTests,
} from "../stores/sessionTurnStore";
import type { ClaudeSession, PendingExecutionTask } from "../types";

const queueByKey = new Map<string, PendingExecutionTask[]>();
const deferredByKey = new Map<string, boolean>();

function storageKey(sessionId: string, repositoryPath: string): string {
  return `${repositoryPath}::${sessionId}`;
}

mock.module("../services/pendingTaskQueueStore", () => ({
  readPendingTaskQueue: async (sessionId: string, repositoryPath: string) =>
    queueByKey.get(storageKey(sessionId, repositoryPath)) ?? [],
  writePendingTaskQueue: async (sessionId: string, repositoryPath: string, tasks: PendingExecutionTask[]) => {
    queueByKey.set(storageKey(sessionId, repositoryPath), tasks);
    return true;
  },
  readDeferredSendNext: async (sessionId: string, repositoryPath: string) =>
    deferredByKey.get(storageKey(sessionId, repositoryPath)) ?? false,
  writeDeferredSendNext: async (sessionId: string, repositoryPath: string, value: boolean) => {
    if (value) deferredByKey.set(storageKey(sessionId, repositoryPath), true);
    else deferredByKey.delete(storageKey(sessionId, repositoryPath));
  },
}));

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id" | "status">): ClaudeSession {
  return {
    id: partial.id,
    status: partial.status,
    repositoryPath: partial.repositoryPath ?? "/repo",
    repositoryName: partial.repositoryName ?? "repo",
    messages: [],
    pendingPrompt: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  } as ClaudeSession;
}

function task(partial: Partial<PendingExecutionTask> & Pick<PendingExecutionTask, "id" | "promptText">): PendingExecutionTask {
  return {
    id: partial.id,
    promptText: partial.promptText,
    executorLabel: partial.executorLabel ?? "主会话",
    createdAt: partial.createdAt ?? Date.now(),
    targetType: partial.targetType ?? "main",
    ...partial,
  };
}

describe("backgroundPendingTaskQueueFlush", () => {
  beforeEach(() => {
    queueByKey.clear();
    deferredByKey.clear();
    resetBackgroundPendingTaskQueueFlushForTests();
    resetPendingTaskQueueOwnerStoreForTests();
    resetSessionTurnStoreForTests();
  });

  afterEach(() => {
    resetBackgroundPendingTaskQueueFlushForTests();
    resetPendingTaskQueueOwnerStoreForTests();
    resetSessionTurnStoreForTests();
  });

  test("shouldSkip when ClaudeChat owns the session", () => {
    const release = claimPendingTaskQueueOwner("s1");
    expect(shouldSkipBackgroundPendingFlush(session({ id: "s1", status: "idle" }))).toBe(true);
    release();
    expect(shouldSkipBackgroundPendingFlush(session({ id: "s1", status: "idle" }))).toBe(false);
  });

  test("shouldSkip when session turn active or running", () => {
    beginSessionTurn("s1");
    expect(shouldSkipBackgroundPendingFlush(session({ id: "s1", status: "idle" }))).toBe(true);
    endSessionTurn("s1");
    expect(shouldSkipBackgroundPendingFlush(session({ id: "s1", status: "running" }))).toBe(true);
    expect(shouldSkipBackgroundPendingFlush(session({ id: "s1", status: "idle" }))).toBe(false);
  });

  test("canDispatch main only when idle and no turn", () => {
    const ctx: BackgroundPendingFlushContext = {
      sessions: [],
      employees: [],
      workflowTasks: [],
      taskPendingEmployeesByTaskId: {},
      workflowGraphStatusByWorkflowId: {},
      omcMonitorPipelineBusy: false,
      onExecute: () => true,
    };
    const t = task({ id: "t1", promptText: "hi" });
    expect(canBackgroundDispatchPendingTask(t, session({ id: "s1", status: "idle" }), ctx)).toBe(true);
    expect(canBackgroundDispatchPendingTask(t, session({ id: "s1", status: "running" }), ctx)).toBe(false);
  });

  test("flush dispatches and removes head for unowned idle session", async () => {
    const executed: string[] = [];
    const s = session({ id: "s1", status: "idle" });
    queueByKey.set(storageKey("s1", "/repo"), [
      task({ id: "t1", promptText: "one" }),
      task({ id: "t2", promptText: "two" }),
    ]);

    const ctx: BackgroundPendingFlushContext = {
      sessions: [s],
      employees: [],
      workflowTasks: [],
      taskPendingEmployeesByTaskId: {},
      workflowGraphStatusByWorkflowId: {},
      omcMonitorPipelineBusy: false,
      onExecute: (sessionId, prompt) => {
        executed.push(`${sessionId}:${prompt}`);
        beginSessionTurn(sessionId);
        return true;
      },
    };

    await flushBackgroundPendingTaskQueueForSession(s, ctx);

    expect(executed).toEqual(["s1:one"]);
    expect(queueByKey.get(storageKey("s1", "/repo"))?.map((t) => t.id)).toEqual(["t2"]);
  });

  test("flush is no-op when session has UI owner", async () => {
    const executed: string[] = [];
    const release = claimPendingTaskQueueOwner("s1");
    const s = session({ id: "s1", status: "idle" });
    queueByKey.set(storageKey("s1", "/repo"), [task({ id: "t1", promptText: "one" })]);

    await flushBackgroundPendingTaskQueueForSession(s, {
      sessions: [s],
      employees: [],
      workflowTasks: [],
      taskPendingEmployeesByTaskId: {},
      workflowGraphStatusByWorkflowId: {},
      omcMonitorPipelineBusy: false,
      onExecute: (_id, prompt) => {
        executed.push(prompt);
        return true;
      },
    });

    expect(executed).toEqual([]);
    expect(queueByKey.get(storageKey("s1", "/repo"))?.map((t) => t.id)).toEqual(["t1"]);
    release();
  });
});
