import { describe, expect, test } from "bun:test";
import {
  formatScheduledTaskExecutionKindLabel,
  resolveScheduledTaskExecutionKind,
} from "./scheduledTaskExecution";

describe("scheduledTaskExecution", () => {
  test("defaults missing executionKind to claude", () => {
    expect(resolveScheduledTaskExecutionKind({})).toBe("claude");
    expect(resolveScheduledTaskExecutionKind({ executionKind: undefined })).toBe("claude");
  });

  test("maps legacy workflow executionKind to claude", () => {
    expect(resolveScheduledTaskExecutionKind({ executionKind: "workflow" })).toBe("claude");
  });

  test("formatScheduledTaskExecutionKindLabel", () => {
    expect(formatScheduledTaskExecutionKindLabel({ executionKind: "script" })).toBe("脚本执行");
    expect(formatScheduledTaskExecutionKindLabel({ executionKind: "workflow" })).toBe("Claude 提示词");
  });
});
