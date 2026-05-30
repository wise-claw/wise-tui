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
