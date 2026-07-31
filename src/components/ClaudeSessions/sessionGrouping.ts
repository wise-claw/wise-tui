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

/**
 * 侧栏 / 历史列表排序用「最近活跃」时间。
 *
 * 末条消息可能缺 timestamp（工具行、部分 Codex RPC 行）；从尾部向前找第一条有效时间。
 * 与 `createdAt` 取 max：切走会话清空 messages 前会把活跃时间写回 `createdAt`，
 * 避免回落到更早的建标签时间导致「新会话」短暂顶到「你好」前面再跳回。
 */
export function getSessionUpdatedAt(session: ClaudeSession): number {
  const created = normalizeSessionTimestampMs(session.createdAt);
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const ts = session.messages[i]?.timestamp;
    if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
      return Math.max(created, normalizeSessionTimestampMs(ts));
    }
  }
  return created;
}

/** 丢弃 messages 前：把当前活跃时间锁进 createdAt，保证侧栏排序不因空 messages 抖动。 */
export function bumpSessionCreatedAtForSortActivity(session: ClaudeSession): number {
  return getSessionUpdatedAt(session);
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
