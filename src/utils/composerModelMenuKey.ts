/** Ant Design Menu 会把 `.` 当路径分隔；模型 id 如 `grok-4.6` 必须编码后再当 key。 */
const PREFIX = "model:";

export function toComposerModelMenuKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `${PREFIX}${encodeURIComponent(trimmed).replace(/\./g, "%2E")}`;
}

export function fromComposerModelMenuKey(key: string): string | null {
  const raw = key.trim();
  if (!raw || raw === "__no_match__") return null;
  if (!raw.startsWith(PREFIX)) return raw;
  try {
    const decoded = decodeURIComponent(raw.slice(PREFIX.length)).trim();
    return decoded || null;
  } catch {
    return null;
  }
}
