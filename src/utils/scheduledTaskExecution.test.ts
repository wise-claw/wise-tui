import { describe, expect, test } from "bun:test";
import {
  ccWorkflowSlashCommand,
  formatScheduledTaskExecutionKindLabel,
  resolveScheduledTaskExecutionKind,
} from "./scheduledTaskExecution";

describe("scheduledTaskExecution", () => {
  test("defaults missing executionKind to claude", () => {
    expect(resolveScheduledTaskExecutionKind({})).toBe("claude");
    expect(resolveScheduledTaskExecutionKind({ executionKind: undefined })).toBe("claude");
  });

  test("formatScheduledTaskExecutionKindLabel", () => {
    expect(formatScheduledTaskExecutionKindLabel({ executionKind: "script" })).toBe("脚本执行");
    expect(formatScheduledTaskExecutionKindLabel({ executionKind: "workflow" })).toBe("工作流执行");
  });

  test("ccWorkflowSlashCommand", () => {
    expect(ccWorkflowSlashCommand("my-flow")).toBe("/my-flow");
    expect(ccWorkflowSlashCommand("/already")).toBe("/already");
  });
});
