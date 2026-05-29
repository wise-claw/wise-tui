import { describe, expect, it } from "bun:test";
import type { ClaudeMessage, PermissionRequest } from "../types";
import {
  buildPermissionRequestFromControl,
  extractPendingExitPlanModeFromMessages,
  mergePermissionRequestUpdate,
} from "./permissionIngest";

describe("mergePermissionRequestUpdate", () => {
  it("prefers control request id over tool_use fallback id", () => {
    const toolUseFallback: PermissionRequest = {
      id: "toolu_abc",
      tool: "ExitPlanMode",
      description: "plan",
      toolUseId: "toolu_abc",
      controlSubtype: "can_use_tool",
    };
    const controlLine: PermissionRequest = {
      id: "req-exit-1",
      tool: "ExitPlanMode",
      description: "plan",
      toolInput: {},
      toolUseId: "toolu_abc",
      controlSubtype: "can_use_tool",
    };
    const merged = mergePermissionRequestUpdate(toolUseFallback, controlLine);
    expect(merged.id).toBe("req-exit-1");
    expect(merged.toolUseId).toBe("toolu_abc");
  });
});

describe("buildPermissionRequestFromControl", () => {
  it("captures tool_use_id from can_use_tool request", () => {
    const built = buildPermissionRequestFromControl(
      { request_id: "req-1" },
      {
        subtype: "can_use_tool",
        tool_name: "ExitPlanMode",
        input: {},
        tool_use_id: "toolu_xyz",
      },
      "can_use_tool",
    );
    expect(built?.id).toBe("req-1");
    expect(built?.toolUseId).toBe("toolu_xyz");
  });
});

describe("extractPendingExitPlanModeFromMessages", () => {
  it("finds running ExitPlanMode tool_use in transcript", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "assistant",
        content: "",
        timestamp: 1,
        parts: [
          {
            type: "tool_use",
            id: "toolu_plan",
            name: "ExitPlanMode",
            input: {},
            status: "running",
          },
        ],
      },
    ];
    const pending = extractPendingExitPlanModeFromMessages(messages);
    expect(pending?.id).toBe("toolu_plan");
    expect(pending?.tool).toBe("ExitPlanMode");
  });
});
