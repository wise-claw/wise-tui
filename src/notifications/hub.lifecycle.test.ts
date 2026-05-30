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
