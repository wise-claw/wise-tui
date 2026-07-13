import { describe, expect, test } from "bun:test";
import { notificationHub } from "./hub";

describe("notificationHub expireStaleRequests", () => {
  test("prunes old non-pending lifecycles after expiry pass", () => {
    const sessionId = `test-session-${Date.now()}`;
    const requestId = `req-${Date.now()}`;
    notificationHub.setPermissionRequest(sessionId, {
      id: requestId,
      tool: "Bash",
      description: "run echo",
    });
    notificationHub.markRequestAnswered(requestId);

    const lifecycle = notificationHub.getRequestLifecycle(requestId);
    expect(lifecycle?.status).toBe("answered");

    if (lifecycle) {
      lifecycle.updatedAt = Date.now() - 120_000;
    }

    notificationHub.expireStaleRequests(30_000);

    expect(notificationHub.getRequestLifecycle(requestId)).toBeNull();
    notificationHub.removeSession(sessionId);
  });

  test("caps non-pending lifecycle count after expiry pass", () => {
    const sessionId = `lifecycle-cap-${Date.now()}`;
    for (let i = 0; i < 520; i += 1) {
      const requestId = `req-cap-${i}`;
      notificationHub.setPermissionRequest(sessionId, {
        id: requestId,
        tool: "Bash",
        description: `run ${i}`,
      });
      notificationHub.markRequestAnswered(requestId);
      const lifecycle = notificationHub.getRequestLifecycle(requestId);
      if (lifecycle) {
        lifecycle.updatedAt = Date.now() - 30_000;
      }
    }

    notificationHub.expireStaleRequests(60_000);

    let nonPending = 0;
    for (let i = 0; i < 520; i += 1) {
      const lc = notificationHub.getRequestLifecycle(`req-cap-${i}`);
      if (lc && lc.status !== "pending") nonPending += 1;
    }
    expect(nonPending).toBeLessThanOrEqual(500);

    notificationHub.removeSession(sessionId);
  });
});

describe("notificationHub completeRemainingTodos", () => {
  test("marks pending and in_progress todos as completed", () => {
    const sessionId = `todo-complete-${Date.now()}`;
    notificationHub.applyTodoWrite(
      sessionId,
      [
        { id: "a", content: "task a", status: "pending" },
        { id: "b", content: "task b", status: "in_progress" },
        { id: "c", content: "task c", status: "completed" },
      ],
      false,
    );

    notificationHub.completeRemainingTodos(sessionId);

    const todos = notificationHub.getDockSlice(sessionId).todos;
    expect(todos.every((t) => t.status === "completed")).toBe(true);
    notificationHub.removeSession(sessionId);
  });
});

describe("notificationHub pruneOrphanSessions", () => {
  test("removes buckets for sessions no longer in live set", () => {
    const liveId = `live-${Date.now()}`;
    const deadId = `dead-${Date.now()}`;
    notificationHub.applyTodoWrite(deadId, [{ id: "t1", content: "x", status: "pending" }], false);
    notificationHub.applyTodoWrite(liveId, [{ id: "t2", content: "y", status: "pending" }], false);

    notificationHub.pruneOrphanSessions(new Set([liveId]));

    expect(notificationHub.getDockSlice(deadId).todos).toEqual([]);
    expect(notificationHub.getDockSlice(liveId).todos.length).toBe(1);
    notificationHub.removeSession(liveId);
  });
});

describe("notificationHub memory caps", () => {
  test("caps followups, revert items, and queued questions", () => {
    const sessionId = `cap-${Date.now()}`;
    const text = [
      ...Array.from({ length: 30 }, (_, i) => `Follow-up: next ${i}`),
      ...Array.from({ length: 20 }, (_, i) => `Revert: checkpoint ${i}`),
    ].join("\n");

    notificationHub.ingestStreamAssistText(sessionId, text);
    for (let i = 0; i < 12; i += 1) {
      notificationHub.setQuestionRequest(sessionId, {
        id: `q-${i}`,
        question: `Question ${i}?`,
        options: [{ value: "ok", label: "OK" }],
      });
    }

    const slice = notificationHub.getDockSlice(sessionId);
    expect(slice.followupItems).toHaveLength(20);
    expect(slice.followupItems[0]?.text).toBe("next 10");
    expect(slice.revertItems).toHaveLength(12);
    expect(slice.revertItems[0]?.text).toBe("checkpoint 8");
    expect(slice.questionRequest?.id).toBe("q-0");
    expect(slice.questionRequestQueue).toHaveLength(8);
    expect(slice.questionRequestQueue[0]?.id).toBe("q-4");

    notificationHub.removeSession(sessionId);
  });
});

describe("notificationHub setPermissionRequest idempotency", () => {
  test("同 id 已 answered 不被流增量复活", () => {
    const sid = `idem-answered-${Date.now()}`;
    const reqId = `idem-req-${Date.now()}`;
    notificationHub.setPermissionRequest(sid, {
      id: reqId,
      tool: "ExitPlanMode",
      description: "退出规划模式",
    });
    notificationHub.markRequestAnswered(reqId);
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("answered");

    // 流推 plan 内容增量：description 不变但 toolInput 增多，5 字段短路不一定触发，
    // 但 lifecycle 已 answered + 同 id 守卫必须挡住重新写入。
    notificationHub.setPermissionRequest(sid, {
      id: reqId,
      tool: "ExitPlanMode",
      description: "退出规划模式",
      toolInput: { plan: "incremental delta" },
    });
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("answered");
    notificationHub.removeSession(sid);
  });

  test("同 id 已 expired 不被复活", () => {
    const sid = `idem-expired-${Date.now()}`;
    const reqId = `idem-expired-req-${Date.now()}`;
    notificationHub.setPermissionRequest(sid, {
      id: reqId,
      tool: "Bash",
      description: "run echo",
    });
    notificationHub.invalidateControlRequestsForSession(sid, "进程已结束", "expire_keep_visible");
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("expired");

    notificationHub.setPermissionRequest(sid, {
      id: reqId,
      tool: "Bash",
      description: "run echo",
    });
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("expired");
    notificationHub.removeSession(sid);
  });

  test("不同 id 仍允许建立新的 pending lifecycle", () => {
    const sid = `idem-different-${Date.now()}`;
    notificationHub.setPermissionRequest(sid, {
      id: "first-req",
      tool: "Bash",
      description: "x",
    });
    notificationHub.markRequestAnswered("first-req");

    notificationHub.setPermissionRequest(sid, {
      id: "second-req",
      tool: "Bash",
      description: "y",
    });
    expect(notificationHub.getRequestLifecycle("second-req")?.status).toBe("pending");
    notificationHub.removeSession(sid);
  });
});
