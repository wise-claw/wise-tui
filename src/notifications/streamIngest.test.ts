import { describe, expect, it } from "bun:test";
import { buildPermissionStdinLine, ingestClaudeStreamLineForHub } from "./streamIngest";
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
