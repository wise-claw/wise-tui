export type WorkflowBranchConditionKind =
  | "acceptance_pass"
  | "acceptance_reject"
  | "rules"
  | "expression"
  | "default";

export type WorkflowBranchRuleSource = "variable" | "last_output" | "acceptance";

export type WorkflowBranchRuleOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "not_empty"
  | "regex";

export interface WorkflowBranchRule {
  source: WorkflowBranchRuleSource;
  /** 当 source=variable 时必填 */
  key?: string;
  operator: WorkflowBranchRuleOperator;
  value?: string;
}

export interface WorkflowBranchCondition {
  id: string;
  label: string;
  /** 画布连线 sourcePort；兼容 legacy if/else */
  portId: string;
  kind: WorkflowBranchConditionKind;
  logic: "and" | "or";
  rules: WorkflowBranchRule[];
  /** kind=expression 时使用 */
  expression?: string;
}

export const DEFAULT_WORKFLOW_BRANCH_CONDITIONS: WorkflowBranchCondition[] = [
  {
    id: "bc-pass",
    label: "通过",
    portId: "if",
    kind: "acceptance_pass",
    logic: "and",
    rules: [],
  },
  {
    id: "bc-reject",
    label: "驳回",
    portId: "else",
    kind: "acceptance_reject",
    logic: "and",
    rules: [],
  },
];
