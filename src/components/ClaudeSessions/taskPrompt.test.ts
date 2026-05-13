import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../../types";
import { buildTaskExecutionPrompt } from "./taskPrompt";

describe("taskPrompt", () => {
  test("builds readable execution prompt", () => {
    const task = {
      id: "t1",
      title: "任务",
      description: "说明",
      role: "backend",
      size: "M",
      estimateDays: 3,
      dod: ["验收一"],
    } as unknown as TaskItem;
    expect(buildTaskExecutionPrompt(task)).toContain("角色：后端");
  });
});
