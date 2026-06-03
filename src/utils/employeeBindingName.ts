/** 员工绑定名规范化：`终端01` 与 `终端1` 视为同一终端（与终端派发、监控侧栏一致）。 */
export function normalizeEmployeeBindingName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return trimmed;
  const prefix = match[1] ?? "";
  const digits = match[2] ?? "";
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed)) return trimmed;
  return `${prefix}${parsed}`;
}
