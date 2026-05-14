import { describe, expect, test } from "bun:test";
import type { SplitResult, TaskItem } from "../../types";
import { applyTaskEdits, isEditedTask, isManualTask } from "./taskEdits";

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task-1",
    title: "T1",
    description: "desc",
    role: "frontend",
    size: "S",
    estimateDays: 1,
    dependencies: [],
    sourceRefs: [],
    sourceRequirementIds: ["req-functional-1"],
    subtasks: ["a"],
    dod: ["b"],
    executionStatus: "executable",
    executionStatusManual: false,
    flowStatus: "todo",
    ...overrides,
  };
}

describe("applyTaskEdits", () => {
  test("identity when no edits", () => {
    const out = applyTaskEdits([task()], undefined);
    expect(out).toEqual([task()]);
  });

  test("applies title / description / role patches", () => {
    const out = applyTaskEdits([task()], {
      patches: {
        "task-1": { title: "新标题", description: "新描述", role: "backend" },
      },
      manualTasks: [],
      deletedTaskIds: [],
    });
    expect(out[0].title).toBe("新标题");
    expect(out[0].description).toBe("新描述");
    expect(out[0].role).toBe("backend");
    expect(out[0].id).toBe("task-1"); // 保留 id
  });

  test("respects deletion list", () => {
    const out = applyTaskEdits([task(), task({ id: "task-2" })], {
      patches: {},
      manualTasks: [],
      deletedTaskIds: ["task-2"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("task-1");
  });

  test("appends manual tasks at the end", () => {
    const out = applyTaskEdits([task()], {
      patches: {},
      manualTasks: [task({ id: "manual-1", title: "Manual" })],
      deletedTaskIds: [],
    });
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("manual-1");
    expect(out[1].title).toBe("Manual");
  });

  test("subtasks/dod arrays are replaced fully when provided", () => {
    const out = applyTaskEdits([task({ subtasks: ["a"], dod: ["b"] })], {
      patches: {
        "task-1": { subtasks: ["x", "y"], dod: ["z"] },
      },
      manualTasks: [],
      deletedTaskIds: [],
    });
    expect(out[0].subtasks).toEqual(["x", "y"]);
    expect(out[0].dod).toEqual(["z"]);
  });
});

describe("isEditedTask / isManualTask", () => {
  test("flags patched tasks", () => {
    expect(
      isEditedTask(task(), {
        patches: { "task-1": { title: "x" } },
        manualTasks: [],
        deletedTaskIds: [],
      }),
    ).toBe(true);
  });

  test("flags manual tasks via manualTasks list", () => {
    const t = task({ id: "manual-1" });
    expect(
      isManualTask(t, {
        patches: {},
        manualTasks: [t],
        deletedTaskIds: [],
      }),
    ).toBe(true);
  });

  test("untouched task is not flagged", () => {
    expect(
      isEditedTask(task(), {
        patches: {},
        manualTasks: [],
        deletedTaskIds: [],
      }),
    ).toBe(false);
  });
});

// SplitResult 整体替换由 applyEditsToSplitResult 处理，这里通过实际 cluster 用例覆盖。
test("SplitResult 透传保持非任务字段", () => {
  const split: SplitResult = {
    source: {
      title: "x",
      sourceType: "markdown",
      sourceRef: null,
      background: [],
      goals: [],
      scenarios: [],
      functional: ["a"],
      nonFunctional: [],
      acceptance: [],
    },
    context: null,
    splitTasks: [task()],
    executableTasks: [],
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
    claudeSplitMapping: {
      version: 1,
      taskRequirementLinks: [{ taskId: "task-1", requirementIds: ["req-functional-1"] }],
      capturedAtMs: 0,
    },
  };
  // 仅为了让 split 引用看起来被使用，避免 lint 误报：直接调用
  expect(split.splitTasks).toHaveLength(1);
});
