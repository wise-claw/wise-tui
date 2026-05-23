import { describe, expect, test } from "bun:test";
import {
  formatScheduledTaskDispatchTargetLabel,
  parseScheduledTaskDispatchTargetKey,
  scheduledTaskDispatchTargetKey,
} from "./scheduledTaskDispatchTarget";

describe("scheduledTaskDispatchTarget", () => {
  test("encodes main, employee, and team keys", () => {
    expect(scheduledTaskDispatchTargetKey({})).toBe("main");
    expect(scheduledTaskDispatchTargetKey({ employeeId: "e1" })).toBe("employee:e1");
    expect(scheduledTaskDispatchTargetKey({ workflowId: "w1" })).toBe("team:w1");
    expect(
      scheduledTaskDispatchTargetKey({ employeeId: "e1", workflowId: "w1" }),
    ).toBe("team:w1");
  });

  test("parses keys back to ids", () => {
    expect(parseScheduledTaskDispatchTargetKey("main")).toEqual({
      type: "main",
      employeeId: null,
      workflowId: null,
    });
    expect(parseScheduledTaskDispatchTargetKey("employee:abc")).toEqual({
      type: "employee",
      employeeId: "abc",
      workflowId: null,
    });
    expect(parseScheduledTaskDispatchTargetKey("team:flow-1")).toEqual({
      type: "team",
      employeeId: null,
      workflowId: "flow-1",
    });
  });

  test("formats display labels", () => {
    expect(formatScheduledTaskDispatchTargetLabel({})).toBe("主会话");
    expect(
      formatScheduledTaskDispatchTargetLabel({ employeeId: "e1", employeeName: "Alice" }),
    ).toBe("员工：Alice");
    expect(
      formatScheduledTaskDispatchTargetLabel({ workflowId: "w1", workflowName: "发布流" }),
    ).toBe("团队：发布流");
  });
});
