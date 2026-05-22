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
      execute: "waiting",
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
      execute: "waiting",
    });
  });

  test("marks every stage done when execution succeeds", () => {
    const stages = buildRequirementAssistantStageItems({
      hasInput: true,
      parsing: false,
      hasPlannedSummary: false,
      hasResult: true,
      allTasksConfirmed: true,
      hasMaterializedResult: true,
      executionStatus: "succeeded",
    });

    expect(stages.map((stage) => stage.status)).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(stages.at(-1)?.label).toBe("主会话接管");
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
      execute: "failed",
    });
    expect(stages.at(-1)?.label).toBe("派发失败");
  });
});

function statusByKey(stages: ReturnType<typeof buildRequirementAssistantStageItems>): Record<string, string> {
  return Object.fromEntries(stages.map((stage) => [stage.key, stage.status]));
}
