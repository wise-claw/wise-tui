import { describe, expect, it } from "bun:test";
import { buildPermissionStdinLine, ingestClaudeStreamLineForHub, ingestPendingPermissionsFromSessionMessages } from "./streamIngest";
import { notificationHub } from "./hub";

describe("ingestClaudeStreamLineForHub can_use_tool", () => {
  it("parses control_request with top-level request_id for ExitPlanMode", () => {
    const sessionId = "tab-test-can-use-tool";
    notificationHub.clearPermission(sessionId);
    notificationHub.clearTodos(sessionId);

    ingestClaudeStreamLineForHub(
      sessionId,
      JSON.stringify({
        type: "control_request",
        request_id: "req-exit-plan-1",
        request: {
          subtype: "can_use_tool",
          tool_name: "ExitPlanMode",
          input: {},
        },
      }),
    );

    const slice = notificationHub.getDockSlice(sessionId);
    expect(slice.permissionRequest?.id).toBe("req-exit-plan-1");
    expect(slice.permissionRequest?.tool).toBe("ExitPlanMode");
    expect(slice.permissionRequest?.controlSubtype).toBe("can_use_tool");
    expect(slice.permissionRequest?.description).toContain("退出规划模式");
  });

  it("clears expired permission dock after process end (expire_keep_visible)", () => {
    const sessionId = "tab-test-permission-expired-dismiss";
    notificationHub.clearPermission(sessionId);

    ingestClaudeStreamLineForHub(
      sessionId,
      JSON.stringify({
        type: "control_request",
        request_id: "req-exit-plan-expired",
        request: {
          subtype: "can_use_tool",
          tool_name: "ExitPlanMode",
          input: {},
        },
      }),
    );
    notificationHub.invalidateControlRequestsForSession(sessionId, "进程已结束", "expire_keep_visible");

    expect(notificationHub.getDockSlice(sessionId).permissionRequest?.id).toBe("req-exit-plan-expired");
    expect(notificationHub.getRequestLifecycle("req-exit-plan-expired")?.status).toBe("expired");

    notificationHub.clearPermission(sessionId);

    expect(notificationHub.getDockSlice(sessionId).permissionRequest).toBeNull();
  });
});

describe("buildPermissionStdinLine", () => {
  it("includes updatedInput for allow responses", () => {
    const line = buildPermissionStdinLine("req-1", "allow_once", { plan: "demo" });
    const parsed = JSON.parse(line) as {
      response: { response: { behavior: string; updatedInput: Record<string, unknown> } };
    };
    expect(parsed.response.response.behavior).toBe("allow");
    expect(parsed.response.response.updatedInput).toEqual({ plan: "demo" });
  });

  it("includes toolUseID when provided", () => {
    const line = buildPermissionStdinLine("req-1", "allow_once", {}, "toolu_abc");
    const parsed = JSON.parse(line) as {
      response: { response: { toolUseID?: string } };
    };
    expect(parsed.response.response.toolUseID).toBe("toolu_abc");
  });
});

describe("ingestPendingPermissionsFromSessionMessages lifecycle guard", () => {
  it("lifecycle 已 answered 时不复活 dock", () => {
    const sid = `tf-answered-${Date.now()}`;
    const reqId = `tf-req-${Date.now()}`;
    notificationHub.setPermissionRequest(sid, {
      id: reqId,
      tool: "ExitPlanMode",
      description: "退出规划模式",
    });
    notificationHub.markRequestAnswered(reqId);
    notificationHub.clearPermission(sid);

    // transcript 重放：仍带同 id 的 ExitPlanMode 不应复活 dock
    const messages = [
      {
        role: "assistant" as const,
        parts: [
          {
            type: "tool_use" as const,
            id: reqId,
            name: "ExitPlanMode",
            input: { plan: "..." },
            status: "running" as const,
          },
        ],
      },
    ];
    ingestPendingPermissionsFromSessionMessages(sid, messages);
    expect(notificationHub.getDockSlice(sid).permissionRequest).toBeNull();
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("answered");
    notificationHub.removeSession(sid);
  });

  it("lifecycle 已 answered 时不复活 dock（expired 后 clearPermission 落为 answered 路径）", () => {
    const sid = `tf-expired-${Date.now()}`;
    const reqId = `tf-expired-req-${Date.now()}`;
    notificationHub.setPermissionRequest(sid, {
      id: reqId,
      tool: "ExitPlanMode",
      description: "退出规划模式",
    });
    notificationHub.invalidateControlRequestsForSession(sid, "退出", "expire_keep_visible");
    // clearPermission 把 lifecycle 落为 answered（系统既有行为），仍然是非 pending。
    notificationHub.clearPermission(sid);
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("answered");

    const messages = [
      {
        role: "assistant" as const,
        parts: [
          {
            type: "tool_use" as const,
            id: reqId,
            name: "ExitPlanMode",
            input: {},
            status: "running" as const,
          },
        ],
      },
    ];
    ingestPendingPermissionsFromSessionMessages(sid, messages);
    expect(notificationHub.getDockSlice(sid).permissionRequest).toBeNull();
    // 仍保持 answered（转录回放不会复活 / 不会降级回 expired）
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("answered");
    notificationHub.removeSession(sid);
  });

  it("lifecycle 不存在时正常写入新 pr", () => {
    const sid = `tf-new-${Date.now()}`;
    const reqId = `tf-new-req-${Date.now()}`;
    const messages = [
      {
        role: "assistant" as const,
        parts: [
          {
            type: "tool_use" as const,
            id: reqId,
            name: "ExitPlanMode",
            input: {},
            status: "running" as const,
          },
        ],
      },
    ];
    ingestPendingPermissionsFromSessionMessages(sid, messages);
    expect(notificationHub.getDockSlice(sid).permissionRequest?.id).toBe(reqId);
    expect(notificationHub.getRequestLifecycle(reqId)?.status).toBe("pending");
    notificationHub.removeSession(sid);
  });
});
