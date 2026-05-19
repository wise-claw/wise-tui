import { describe, expect, test } from "bun:test";
import { buildSplitRuntimeModel } from "./splitRuntimeModel";
import type { SplitRuntimeLogItem } from "./types";

function log(overrides: Partial<SplitRuntimeLogItem>): SplitRuntimeLogItem {
  return {
    id: overrides.id ?? String(overrides.at ?? 1),
    role: overrides.role ?? "system",
    text: overrides.text ?? "log",
    at: overrides.at ?? 1,
    ...overrides,
  };
}

describe("buildSplitRuntimeModel", () => {
  test("keeps queued subagents visible with waiting reason", () => {
    const model = buildSplitRuntimeModel([
      log({ id: "a", at: 1, clusterId: "cluster-a", title: "wise", scope: "subagent", status: "queued" }),
      log({ id: "b", at: 2, clusterId: "cluster-b", title: "api", scope: "subagent", status: "queued" }),
    ]);

    expect(model.subagents).toHaveLength(2);
    expect(model.subagents[1]?.status).toBe("queued");
    expect(model.subagents[1]?.waitingReason).toBe("等待 cluster 1 输出候选任务");
    expect(model.subagents[1]?.outputs[0]).toEqual({
      title: "等待子代理输出",
      state: "pending",
    });
  });

  test("projects running subagent steps and thinking summary", () => {
    const model = buildSplitRuntimeModel([
      log({ id: "start", at: 1, clusterId: "cluster-a", title: "wise", scope: "subagent", status: "running" }),
      log({
        id: "parent",
        at: 2,
        clusterId: "cluster-a",
        title: "wise",
        scope: "main",
        status: "running",
        details: [{ label: "parentTask", value: ".trellis/tasks/parent" }],
      }),
    ]);

    const subagent = model.subagents[0];
    expect(subagent?.status).toBe("running");
    expect(subagent?.steps.map((step) => step.state)).toContain("active");
    expect(subagent?.thinking).toContain("任务依赖");
    expect(model.mainSummary).toContain("Cluster 1/1");
  });

  test("shows completed task titles as output chips", () => {
    const model = buildSplitRuntimeModel([
      log({
        id: "done",
        at: 1,
        role: "assistant",
        clusterId: "cluster-a",
        title: "wise",
        scope: "subagent",
        status: "succeeded",
        details: [
          { label: "taskCount", value: "2" },
          { label: "taskTitles", value: "替换 InputStage TextArea\n图片管道接入" },
        ],
      }),
      log({ id: "final", at: 2, scope: "main", status: "succeeded" }),
    ]);

    expect(model.activeStageIndex).toBe(3);
    expect(model.subagents[0]?.outputs).toEqual([
      { title: "替换 InputStage TextArea", state: "done" },
      { title: "图片管道接入", state: "done" },
    ]);
    expect(model.mainSummary).toContain("交给编排层生成 DAG");
  });
});
