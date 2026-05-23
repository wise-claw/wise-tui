import { describe, expect, test } from "bun:test";
import { DEFAULT_WORKFLOW_BRANCH_CONDITIONS } from "../types/workflowBranch";
import { evaluateBranchConditions, normalizeBranchConditions } from "./workflowBranchEvaluation";

describe("workflowBranchEvaluation", () => {
  test("routes by acceptance pass/reject kinds", () => {
    const conditions = normalizeBranchConditions(DEFAULT_WORKFLOW_BRANCH_CONDITIONS);
    const pass = evaluateBranchConditions(conditions, { variables: {}, acceptanceDecision: "pass" });
    expect(pass.portId).toBe("if");
    const reject = evaluateBranchConditions(conditions, { variables: {}, acceptanceDecision: "reject" });
    expect(reject.portId).toBe("else");
  });

  test("evaluates variable rules with and/or logic", () => {
    const conditions = normalizeBranchConditions([
      {
        id: "high",
        label: "高优先级",
        portId: "branch-0",
        kind: "rules",
        logic: "and",
        rules: [{ source: "variable", key: "priority", operator: "eq", value: "high" }],
      },
      {
        id: "default",
        label: "默认",
        portId: "branch-default",
        kind: "default",
        logic: "and",
        rules: [],
      },
    ]);
    const matched = evaluateBranchConditions(conditions, {
      variables: { priority: "high" },
    });
    expect(matched.label).toBe("高优先级");
  });

  test("evaluates expression with contains helper", () => {
    const conditions = normalizeBranchConditions([
      {
        id: "err",
        label: "有错误",
        portId: "branch-err",
        kind: "expression",
        logic: "and",
        rules: [],
        expression: 'contains({{last_output}}, "error")',
      },
      {
        id: "default",
        label: "默认",
        portId: "else",
        kind: "default",
        logic: "and",
        rules: [],
      },
    ]);
    const matched = evaluateBranchConditions(conditions, {
      variables: {},
      lastOutput: "Found an error in tests",
    });
    expect(matched.label).toBe("有错误");
  });
});
