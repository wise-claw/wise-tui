export interface SubagentFormState {
  description: string;
  model: string;
  tools: string;
  disallowedTools: string;
  permissionMode: string;
  memory: string;
  effort: string;
  background: string;
  prompt: string;
}

export function splitCsv(input: string): string[] {
  return input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function readFrontmatterField(frontmatter: string, key: string): string {
  const line = frontmatter
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${key}:`));
  if (!line) return "";
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

export function composeSubagentRawFromForm(name: string, form: SubagentFormState): string {
  const rows = [`name: ${name}`, `description: ${form.description.trim()}`];
  if (form.model.trim()) rows.push(`model: ${form.model.trim()}`);
  const tools = splitCsv(form.tools);
  if (tools.length > 0) rows.push(`tools: ${tools.join(", ")}`);
  const disallowed = splitCsv(form.disallowedTools);
  if (disallowed.length > 0) rows.push(`disallowedTools: ${disallowed.join(", ")}`);
  if (form.permissionMode.trim()) rows.push(`permissionMode: ${form.permissionMode.trim()}`);
  if (form.memory.trim()) rows.push(`memory: ${form.memory.trim()}`);
  if (form.effort.trim()) rows.push(`effort: ${form.effort.trim()}`);
  if (form.background.trim()) rows.push(`background: ${form.background.trim()}`);
  return `---\n${rows.join("\n")}\n---\n\n${form.prompt}`;
}

export function validateSubagentForm(form: SubagentFormState): string[] {
  const errors: string[] = [];
  if (!form.description.trim()) errors.push("description 不能为空");
  if (form.model.trim() && !/^[A-Za-z0-9._:-]+$/.test(form.model.trim())) {
    errors.push("model 包含非法字符");
  }
  if ([...splitCsv(form.tools), ...splitCsv(form.disallowedTools)].some((x) => /[\n\r]/.test(x))) {
    errors.push("tools / disallowedTools 不能包含换行");
  }
  if (form.permissionMode && !["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan"].includes(form.permissionMode)) {
    errors.push("permissionMode 非法");
  }
  if (form.memory && !["user", "project", "local"].includes(form.memory)) {
    errors.push("memory 非法");
  }
  if (form.effort && !["low", "medium", "high", "max"].includes(form.effort)) {
    errors.push("effort 非法");
  }
  if (form.background && !["true", "false"].includes(form.background)) {
    errors.push("background 仅支持 true/false");
  }
  return errors;
}

