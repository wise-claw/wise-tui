import type { ClaudeSession } from "../../types";

export interface SessionGroup {
  key: string;
  label: string;
  items: ClaudeSession[];
}

export function getSessionUpdatedAt(session: ClaudeSession): number {
  const lastTimestamp = session.messages[session.messages.length - 1]?.timestamp;
  return typeof lastTimestamp === "number" ? lastTimestamp : session.createdAt;
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
    const label = diffDays <= 0 ? "Today" : diffDays === 1 ? "Yesterday" : "Previous 7 days";
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
