export interface WorkflowVariableDefinition {
  name: string;
  label: string;
  defaultValue?: string;
}

const WORKFLOW_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function normalizeWorkflowVariables(raw: unknown): WorkflowVariableDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowVariableDefinition[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name || !WORKFLOW_VARIABLE_NAME_PATTERN.test(name) || seen.has(name)) continue;
    seen.add(name);
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : name;
    const defaultValue = typeof record.defaultValue === "string" ? record.defaultValue : "";
    out.push({ name, label, defaultValue });
  }
  return out;
}

export function workflowVariablesToRecord(variables: WorkflowVariableDefinition[]): Record<string, string> {
  return Object.fromEntries(variables.map((item) => [item.name, item.defaultValue ?? ""]));
}

/** 将 `{{varName}}` 替换为工作流变量值；未定义时保留占位符。 */
export function applyWorkflowVariableSubstitution(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return variables[name] ?? "";
    }
    return match;
  });
}
