import { describe, expect, test } from "bun:test";
import { buildRequirementAssistantStageItems } from "./stageModel";

describe("buildRequirementAssistantStageItems", () => {
  test("moves from generated tasks to review", () => {
    const stages = buildRequirementAssistantStageItems({
      hasInput: true,
      parsing: false,
      hasPlannedSummary: false,
      hasResult: true,
      allTasksConfirmed: false,
      hasMaterializedResult: false,
      executionStatus: null,
    });

    expect(statusByKey(stages)).toMatchObject({
      write: "done",
      draft: "done",
      split: "done",
      review: "active",
      plan: "waiting",
      run: "waiting",
      verify: "waiting",
      spec: "waiting",
    });
  });

  test("moves confirmed tasks to the execution plan stage", () => {
    const stages = buildRequirementAssistantStageItems({
      hasInput: true,
      parsing: false,
      hasPlannedSummary: false,
      hasResult: true,
      allTasksConfirmed: true,
      hasMaterializedResult: false,
      executionStatus: null,
    });

    expect(statusByKey(stages)).toMatchObject({
      review: "done",
      plan: "active",
      run: "waiting",
      verify: "waiting",
      spec: "waiting",
    });
  });

  test("keeps verify active after implementation fanout succeeds", () => {
    const stages = buildRequirementAssistantStageItems({
      hasInput: true,
      parsing: false,
      hasPlannedSummary: false,
      hasResult: true,
      allTasksConfirmed: true,
      hasMaterializedResult: true,
      executionStatus: "succeeded",
    });

    expect(statusByKey(stages)).toMatchObject({
      write: "done",
      draft: "done",
      split: "done",
      review: "done",
      plan: "done",
      run: "done",
      verify: "active",
      spec: "waiting",
    });
    expect(stages.find((stage) => stage.key === "run")?.label).toBe("实现完成");
    expect(stages.find((stage) => stage.key === "verify")?.label).toBe("待校验");
  });

  test("keeps execution active and failed when fanout fails", () => {
    const stages = buildRequirementAssistantStageItems({
      hasInput: true,
      parsing: false,
      hasPlannedSummary: false,
      hasResult: true,
      allTasksConfirmed: true,
      hasMaterializedResult: true,
      executionStatus: "failed",
    });

    expect(statusByKey(stages)).toMatchObject({
      write: "done",
      draft: "done",
      split: "done",
      review: "done",
      plan: "done",
      run: "failed",
      verify: "waiting",
      spec: "waiting",
    });
    expect(stages.find((stage) => stage.key === "run")?.label).toBe("执行失败");
  });
});

function statusByKey(stages: ReturnType<typeof buildRequirementAssistantStageItems>): Record<string, string> {
  return Object.fromEntries(stages.map((stage) => [stage.key, stage.status]));
}
