import { describe, expect, test } from "bun:test";
import { buildOptimizeTonePrompt } from "./optimizeTone";

describe("buildOptimizeTonePrompt", () => {
  test("includes the field, tone and current content", () => {
    const prompt = buildOptimizeTonePrompt({
      field: "stageTask",
      current: "foo",
      title: "阶段一",
      tone: "risk",
    });
    expect(prompt).toContain("阶段名称：阶段一");
    expect(prompt).toContain("字段类型：执行任务");
    expect(prompt).toContain("foo");
    expect(prompt).toContain("风险点与兜底策略");
  });
});
