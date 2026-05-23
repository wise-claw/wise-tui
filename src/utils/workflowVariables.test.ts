import { describe, expect, test } from "bun:test";
import { applyWorkflowVariableSubstitution, normalizeWorkflowVariables } from "./workflowVariables";

describe("workflowVariables", () => {
  test("normalizes variable definitions and substitutes placeholders", () => {
    expect(
      normalizeWorkflowVariables([
        { name: "topic", label: "主题", defaultValue: "工作流" },
        { name: "topic", label: "重复" },
        { name: "bad name", label: "无效" },
      ]),
    ).toEqual([{ name: "topic", label: "主题", defaultValue: "工作流" }]);

    expect(
      applyWorkflowVariableSubstitution("请处理 {{topic}} 相关需求", { topic: "PRD 拆分" }),
    ).toBe("请处理 PRD 拆分 相关需求");
    expect(applyWorkflowVariableSubstitution("未知 {{missing}}", {})).toBe("未知 {{missing}}");
  });
});
