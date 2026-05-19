import { describe, expect, test } from "bun:test";
import { getWorkflowValidationGroupTitle, getWorkflowValidationSuggestion } from "./workflowValidationCopy";

describe("workflowValidationCopy", () => {
  test("uses delegation protocol terminology for structure errors", () => {
    expect(getWorkflowValidationGroupTitle("WF_GRAPH_START_MISSING")).toBe("委派结构错误");
    expect(getWorkflowValidationSuggestion("WF_GRAPH_NODES_EMPTY")).toContain("智能体阶段");
    expect(getWorkflowValidationSuggestion("WF_GRAPH_EDGES_EMPTY")).toContain("有效委派路径");
  });
});
