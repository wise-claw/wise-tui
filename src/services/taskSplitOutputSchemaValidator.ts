export interface TaskSplitSchemaIssue {
  path: string;
  message: string;
}

export interface TaskSplitSchemaValidationResult {
  ok: boolean;
  issues: TaskSplitSchemaIssue[];
}

interface PlainObject {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function ensureRequiredString(
  issues: TaskSplitSchemaIssue[],
  obj: PlainObject,
  field: string,
  path: string,
): void {
  const value = obj[field];
  if (typeof value !== "string" || !value.trim()) {
    issues.push({ path: `${path}.${field}`, message: "必须为非空字符串" });
  }
}

function ensureStringArray(
  issues: TaskSplitSchemaIssue[],
  obj: PlainObject,
  field: string,
  path: string,
  minItems = 0,
): void {
  const value = obj[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    issues.push({ path: `${path}.${field}`, message: "必须为字符串数组，且元素非空" });
    return;
  }
  if (value.length < minItems) {
    issues.push({ path: `${path}.${field}`, message: `至少需要 ${minItems} 项` });
  }
}

function validateTask(task: unknown, index: number, issues: TaskSplitSchemaIssue[]): void {
  const path = `tasks[${index}]`;
  if (!isRecord(task)) {
    issues.push({ path, message: "必须为对象" });
    return;
  }
  ensureRequiredString(issues, task, "id", path);
  ensureRequiredString(issues, task, "title", path);
  ensureRequiredString(issues, task, "scope", path);
  ensureRequiredString(issues, task, "description", path);

  const type = task.type;
  if (!["feature", "refactor", "fix", "chore"].includes(String(type))) {
    issues.push({ path: `${path}.type`, message: "必须是 feature/refactor/fix/chore 之一" });
  }

  ensureStringArray(issues, task, "depends_on", path);
  ensureStringArray(issues, task, "deliverables", path, 1);
  ensureStringArray(issues, task, "acceptance_criteria", path, 1);
  ensureStringArray(issues, task, "test_plan", path, 1);
  ensureStringArray(issues, task, "missing_prerequisites", path);
  ensureStringArray(issues, task, "risk_notes", path);

  const status = task.status;
  if (status !== "executable" && status !== "not_executable") {
    issues.push({ path: `${path}.status`, message: "必须是 executable 或 not_executable" });
  } else if (status === "executable" && Array.isArray(task.missing_prerequisites) && task.missing_prerequisites.length > 0) {
    issues.push({ path: `${path}.missing_prerequisites`, message: "executable 任务不应包含缺失前置条件" });
  } else if (status === "not_executable" && Array.isArray(task.missing_prerequisites) && task.missing_prerequisites.length === 0) {
    issues.push({ path: `${path}.missing_prerequisites`, message: "not_executable 任务必须列出缺失前置条件" });
  }
}

export function validateTaskSplitOutputShape(payload: unknown): TaskSplitSchemaValidationResult {
  const issues: TaskSplitSchemaIssue[] = [];
  if (!isRecord(payload)) {
    return { ok: false, issues: [{ path: "$", message: "输出必须为 JSON 对象" }] };
  }

  const repoType = payload.repo_type;
  if (repoType !== "frontend" && repoType !== "backend" && repoType !== "document") {
    issues.push({ path: "$.repo_type", message: "必须是 frontend、backend 或 document" });
  }

  if (!isRecord(payload.context_summary)) {
    issues.push({ path: "$.context_summary", message: "必须为对象" });
  } else {
    const context = payload.context_summary as PlainObject;
    ensureStringArray(issues, context, "tech_stack", "$.context_summary");
    ensureStringArray(issues, context, "key_dirs", "$.context_summary");
    ensureStringArray(issues, context, "constraints", "$.context_summary");
    ensureStringArray(issues, context, "existing_capabilities", "$.context_summary");
    ensureStringArray(issues, context, "unknowns", "$.context_summary");
  }

  if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) {
    issues.push({ path: "$.tasks", message: "必须为非空数组" });
  } else {
    payload.tasks.forEach((task, index) => validateTask(task, index, issues));
  }

  if (!isStringArray(payload.execution_order) || payload.execution_order.length === 0) {
    issues.push({ path: "$.execution_order", message: "必须为非空字符串数组" });
  }
  if (!isStringArray(payload.global_missing_prerequisites)) {
    issues.push({ path: "$.global_missing_prerequisites", message: "必须为字符串数组" });
  }
  if (!isStringArray(payload.assumptions)) {
    issues.push({ path: "$.assumptions", message: "必须为字符串数组" });
  }

  return { ok: issues.length === 0, issues };
}

export function extractTaskSplitOutputFromClaudeText(text: string): unknown | null {
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed) && "tasks" in parsed && "execution_order" in parsed) {
        return parsed;
      }
    } catch {
      // ignore invalid json block
    }
  }
  return null;
}

