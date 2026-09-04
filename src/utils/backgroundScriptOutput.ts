/** 去掉 ANSI 转义并折叠连续重复行（terminal-output 偶发双采时避免「你好」展示两遍）。 */
export function normalizeBackgroundScriptOutputText(raw: string): string {
  const stripped = raw.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r\n/g, "\n");
  const lines = stripped.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (out.length > 0 && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** 实时 terminal-output 与 store 回落二选一，避免同一段 stdout 拼接两遍。 */
export function resolveBackgroundScriptDisplayText(
  chunks: readonly string[],
  fallback: string,
): string {
  const live = normalizeBackgroundScriptOutputText(chunks.join(""));
  if (live) return live;
  return normalizeBackgroundScriptOutputText(fallback);
}
