import { describe, expect, test } from "bun:test";
import {
  inferPendingQueueTargetFromPrompt,
  PENDING_QUEUE_MAIN_EXECUTOR_LABEL,
  resolvePendingQueueExecutorDisplayLabel,
} from "./pendingQueueExecutor";

describe("pendingQueueExecutor", () => {
  test("main session queue uses executor label without model", () => {
    expect(
      inferPendingQueueTargetFromPrompt([{ type: "text", text: "继续增强" }], "火山 glm-latest"),
    ).toEqual({
      executorLabel: PENDING_QUEUE_MAIN_EXECUTOR_LABEL,
      targetType: "main",
    });
  });

  test("display label ignores legacy model executor labels for main tasks", () => {
    expect(
      resolvePendingQueueExecutorDisplayLabel({
        executorLabel: "火山 glm-latest",
        targetType: "main",
      }),
    ).toBe("主会话");
  });
});
