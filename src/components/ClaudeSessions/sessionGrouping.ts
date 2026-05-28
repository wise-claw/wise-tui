import type { ClaudeSession } from "../../types";

export interface SessionGroup {
  key: string;
  label: string;
  items: ClaudeSession[];
}

/** Claude jsonl 偶发秒级时间戳；统一为毫秒供分组与排序使用。 */
export function normalizeSessionTimestampMs(value: number): number {
  if (!Number.isFinite(value)) return Date.now();
  return value < 1e12 ? value * 1000 : value;
}

export function getSessionUpdatedAt(session: ClaudeSession): number {
  const lastTimestamp = session.messages[session.messages.length - 1]?.timestamp;
  const raw = typeof lastTimestamp === "number" ? lastTimestamp : session.createdAt;
  return normalizeSessionTimestampMs(raw);
}

export function getDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function groupSessionsByDay(sessions: ClaudeSession[]): SessionGroup[] {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const groups = new Map<string, SessionGroup>();
  for (const item of sessions) {
    const dayStart = getDayStart(getSessionUpdatedAt(item));
    const diffDays = Math.floor((getDayStart(now) - dayStart) / oneDay);
    const label = diffDays <= 0 ? "今天" : diffDays === 1 ? "昨天" : "过去 7 天";
    const key = diffDays <= 0 ? "today" : diffDays === 1 ? "yesterday" : "previous";
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      continue;
    }
    groups.set(key, {
      key,
      label,
      items: [item],
    });
  }
  return ["today", "yesterday", "previous"]
    .map((key) => groups.get(key))
    .filter((item): item is SessionGroup => Boolean(item));
}

/** 先按天分组再截断，避免「今天」会话因排序靠后、在分组前被 slice 掉。 */
export function sliceGroupedSessions(groups: SessionGroup[], maxVisible: number): SessionGroup[] {
  if (maxVisible <= 0) return [];
  let remaining = maxVisible;
  const out: SessionGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const items = group.items.slice(0, remaining);
    if (items.length === 0) continue;
    out.push({ ...group, items });
    remaining -= items.length;
  }
  return out;
}
