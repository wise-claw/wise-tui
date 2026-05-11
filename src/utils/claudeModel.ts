/** 将 `ANTHROPIC_MODEL` / CLI 模型 id 格式化为简短展示名（与标签页一致）。 */
export function formatClaudeModelLabel(modelId: string): string {
  const v = modelId.trim();
  if (!v) return "默认";
  const head = v.replace(/^claude-/i, "").split("-")[0] ?? "";
  if (!head) return v;
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}
