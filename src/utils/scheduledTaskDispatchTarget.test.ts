import { describe, expect, test } from "bun:test";
import {
  formatScheduledTaskDispatchTargetLabel,
  parseScheduledTaskDispatchTargetKey,
  scheduledTaskDispatchTargetKey,
  SCHEDULED_TASK_DISPATCH_NEW_SESSION,
} from "./scheduledTaskDispatchTarget";

describe("scheduledTaskDispatchTarget", () => {
  test("encodes new session and team keys", () => {
    expect(scheduledTaskDispatchTargetKey({})).toBe(SCHEDULED_TASK_DISPATCH_NEW_SESSION);
    expect(scheduledTaskDispatchTargetKey({ workflowId: "w1" })).toBe("team:w1");
  });

  test("parses keys; legacy main/employee map to session", () => {
    expect(parseScheduledTaskDispatchTargetKey("session")).toEqual({
      type: "session",
      workflowId: null,
    });
    expect(parseScheduledTaskDispatchTargetKey("main")).toEqual({
      type: "session",
      workflowId: null,
    });
    expect(parseScheduledTaskDispatchTargetKey("employee:abc")).toEqual({
      type: "session",
      workflowId: null,
    });
    expect(parseScheduledTaskDispatchTargetKey("team:flow-1")).toEqual({
      type: "team",
      workflowId: "flow-1",
    });
  });

  test("formats display labels", () => {
    expect(formatScheduledTaskDispatchTargetLabel({})).toBe("新建会话");
    expect(
      formatScheduledTaskDispatchTargetLabel({ workflowId: "w1", workflowName: "发布流" }),
    ).toBe("工作流：发布流");
  });
});
