import type {
  WorkflowBranchCondition,
  WorkflowBranchConditionKind,
  WorkflowBranchRule,
  WorkflowBranchRuleOperator,
} from "../types/workflowBranch";
import { DEFAULT_WORKFLOW_BRANCH_CONDITIONS } from "../types/workflowBranch";
import type { AcceptanceDecision } from "./workflow/acceptanceVerdict";

export interface BranchEvaluationContext {
  variables: Record<string, string>;
  taskContent?: string;
  lastOutput?: string;
  acceptanceDecision?: AcceptanceDecision;
}

const VALID_KINDS = new Set<WorkflowBranchConditionKind>([
  "acceptance_pass",
  "acceptance_reject",
  "rules",
  "expression",
  "default",
]);

const VALID_OPERATORS = new Set<WorkflowBranchRuleOperator>([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "not_empty",
  "regex",
]);

function normalizeRule(raw: unknown): WorkflowBranchRule | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const source = record.source === "variable" || record.source === "last_output" || record.source === "acceptance"
    ? record.source
    : "variable";
  const operator =
    typeof record.operator === "string" && VALID_OPERATORS.has(record.operator as WorkflowBranchRuleOperator)
      ? (record.operator as WorkflowBranchRuleOperator)
      : "eq";
  const key = typeof record.key === "string" ? record.key.trim() : "";
  const value = typeof record.value === "string" ? record.value : "";
  if (source === "variable" && !key) return null;
  return { source, key: key || undefined, operator, value };
}

export function normalizeBranchConditions(raw: unknown): WorkflowBranchCondition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_WORKFLOW_BRANCH_CONDITIONS.map((item) => ({ ...item, rules: [...item.rules] }));
  }
  const out: WorkflowBranchCondition[] = [];
  const seenPort = new Set<string>();
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `bc-${index + 1}`;
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : `分支 ${index + 1}`;
    const portIdRaw = typeof record.portId === "string" && record.portId.trim() ? record.portId.trim() : `branch-${index}`;
    const portId = seenPort.has(portIdRaw) ? `${portIdRaw}-${index}` : portIdRaw;
    seenPort.add(portId);
    const kind =
      typeof record.kind === "string" && VALID_KINDS.has(record.kind as WorkflowBranchConditionKind)
        ? (record.kind as WorkflowBranchConditionKind)
        : "rules";
    const logic = record.logic === "or" ? "or" : "and";
    const rules = Array.isArray(record.rules)
      ? record.rules.map(normalizeRule).filter((rule): rule is WorkflowBranchRule => Boolean(rule))
      : [];
    const expression = typeof record.expression === "string" ? record.expression.trim() : "";
    out.push({ id, label, portId, kind, logic, rules, ...(expression ? { expression } : {}) });
  });
  if (out.length === 0) {
    return DEFAULT_WORKFLOW_BRANCH_CONDITIONS.map((item) => ({ ...item, rules: [...item.rules] }));
  }
  if (!out.some((item) => item.kind === "default")) {
    out.push({
      id: "bc-default",
      label: "默认",
      portId: out.some((item) => item.portId === "else") ? "branch-default" : "else",
      kind: "default",
      logic: "and",
      rules: [],
    });
  }
  return out;
}

function resolveRuleLeftValue(rule: WorkflowBranchRule, ctx: BranchEvaluationContext): string {
  if (rule.source === "last_output") return ctx.lastOutput?.trim() ?? "";
  if (rule.source === "acceptance") return ctx.acceptanceDecision ?? "";
  return ctx.variables[rule.key ?? ""] ?? "";
}

function compareValues(leftRaw: string, operator: WorkflowBranchRuleOperator, rightRaw: string): boolean {
  const left = leftRaw.trim();
  const right = rightRaw.trim();
  switch (operator) {
    case "empty":
      return left.length === 0;
    case "not_empty":
      return left.length > 0;
    case "contains":
      return left.toLowerCase().includes(right.toLowerCase());
    case "not_contains":
      return !left.toLowerCase().includes(right.toLowerCase());
    case "regex": {
      if (!right) return false;
      try {
        return new RegExp(right, "i").test(left);
      } catch {
        return false;
      }
    }
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    default: {
      const leftNum = Number(left);
      const rightNum = Number(right);
      if (!Number.isFinite(leftNum) || !Number.isFinite(rightNum)) {
        return false;
      }
      if (operator === "gt") return leftNum > rightNum;
      if (operator === "gte") return leftNum >= rightNum;
      if (operator === "lt") return leftNum < rightNum;
      if (operator === "lte") return leftNum <= rightNum;
      return false;
    }
  }
}

function evaluateRules(condition: WorkflowBranchCondition, ctx: BranchEvaluationContext): boolean {
  if (condition.rules.length === 0) return false;
  const results = condition.rules.map((rule) => compareValues(resolveRuleLeftValue(rule, ctx), rule.operator, rule.value ?? ""));
  return condition.logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

function substituteExpression(expr: string, ctx: BranchEvaluationContext): string {
  return expr
    .replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(ctx.variables, name) ? (ctx.variables[name] ?? "") : match,
    )
    .replace(/\$\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(ctx.variables, name) ? (ctx.variables[name] ?? "") : match,
    )
    .replace(/\{\{\s*last_output\s*\}\}/gi, ctx.lastOutput?.trim() ?? "")
    .replace(/\$\{\s*last_output\s*\}/gi, ctx.lastOutput?.trim() ?? "")
    .replace(/\{\{\s*acceptance\s*\}\}/gi, ctx.acceptanceDecision ?? "")
    .replace(/\$\{\s*acceptance\s*\}/gi, ctx.acceptanceDecision ?? "");
}

function evaluateExpression(expression: string, ctx: BranchEvaluationContext): boolean {
  const normalized = substituteExpression(expression, ctx).trim();
  if (!normalized) return false;

  const containsMatch = normalized.match(/^contains\s*\(\s*(.*)\s*,\s*["']([^"']+)["']\s*\)\s*$/i);
  if (containsMatch) {
    return containsMatch[1].trim().toLowerCase().includes(containsMatch[2].trim().toLowerCase());
  }

  const acceptanceMatch = normalized.match(/^acceptance\s*(==|!=)\s*(pass|reject|approve|通过|驳回)$/i);
  if (acceptanceMatch) {
    const actual = ctx.acceptanceDecision ?? "";
    const expected = acceptanceMatch[3].toLowerCase();
    const passLike = expected === "pass" || expected === "approve" || expected === "通过";
    const rejectLike = expected === "reject" || expected === "驳回";
    const expectedDecision = passLike ? "pass" : rejectLike ? "reject" : expected;
    const isEqual = actual === expectedDecision;
    return acceptanceMatch[2] === "==" ? isEqual : !isEqual;
  }

  const compareMatch = normalized.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(['"])(.*?)\4\s*$/);
  if (compareMatch) {
    const left = compareMatch[1].trim();
    const op = compareMatch[2];
    const right = compareMatch[5].trim();
    if (op === "==") return left === right;
    if (op === "!=") return left !== right;
    const leftNum = Number(left);
    const rightNum = Number(right);
    if (!Number.isFinite(leftNum) || !Number.isFinite(rightNum)) return false;
    if (op === ">") return leftNum > rightNum;
    if (op === ">=") return leftNum >= rightNum;
    if (op === "<") return leftNum < rightNum;
    if (op === "<=") return leftNum <= rightNum;
  }

  return normalized.toLowerCase() === "true";
}

function evaluateConditionKind(condition: WorkflowBranchCondition, ctx: BranchEvaluationContext): boolean {
  switch (condition.kind) {
    case "acceptance_pass":
      return ctx.acceptanceDecision === "pass";
    case "acceptance_reject":
      return ctx.acceptanceDecision === "reject";
    case "rules":
      return evaluateRules(condition, ctx);
    case "expression":
      return evaluateExpression(condition.expression ?? "", ctx);
    case "default":
      return true;
    default:
      return false;
  }
}

export function evaluateBranchConditions(
  conditions: WorkflowBranchCondition[],
  ctx: BranchEvaluationContext,
): WorkflowBranchCondition {
  const normalized = normalizeBranchConditions(conditions);
  const regular = normalized.filter((item) => item.kind !== "default");
  const fallback = normalized.find((item) => item.kind === "default");
  for (const condition of regular) {
    if (evaluateConditionKind(condition, ctx)) {
      return condition;
    }
  }
  if (fallback) return fallback;
  throw new Error("WF_BRANCH_NO_MATCH");
}

export function summarizeBranchCondition(condition: WorkflowBranchCondition): string {
  switch (condition.kind) {
    case "acceptance_pass":
      return "验收通过";
    case "acceptance_reject":
      return "验收驳回";
    case "default":
      return "默认";
    case "expression":
      return condition.expression?.trim() ? `表达式：${condition.expression.trim().slice(0, 36)}…` : "表达式未配置";
    case "rules":
      if (condition.rules.length === 0) return "规则未配置";
      return `${condition.logic === "or" ? "任一" : "全部"}满足 ${condition.rules.length} 条规则`;
    default:
      return condition.label;
  }
}

export function branchPortLabelFromId(portId: string, conditions?: WorkflowBranchCondition[]): string | undefined {
  const normalized = conditions ? normalizeBranchConditions(conditions) : DEFAULT_WORKFLOW_BRANCH_CONDITIONS;
  const matched = normalized.find((item) => item.portId === portId);
  if (matched?.label) return matched.label;
  if (portId === "if") return "通过";
  if (portId === "else") return "驳回";
  return undefined;
}
