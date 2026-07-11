export interface WorkspaceTodoItem {
  id: string;
  title: string;
  completed: boolean;
  dueAt: number | null;
  notes: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceTodosPayloadV1 {
  version: 1;
  items: WorkspaceTodoItem[];
}

export function createWorkspaceTodoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `wtodo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createWorkspaceTodoItem(title: string, now = Date.now()): WorkspaceTodoItem {
  const trimmed = title.trim();
  return {
    id: createWorkspaceTodoId(),
    title: trimmed || "无标题",
    completed: false,
    dueAt: null,
    notes: "",
    sortOrder: now,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeItem(raw: unknown): WorkspaceTodoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<WorkspaceTodoItem>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  const titleRaw = typeof row.title === "string" ? row.title.trim() : "";
  const createdAt =
    typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : Date.now();
  const updatedAt =
    typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
  const dueAt =
    typeof row.dueAt === "number" && Number.isFinite(row.dueAt) && row.dueAt > 0 ? row.dueAt : null;
  const sortOrder =
    typeof row.sortOrder === "number" && Number.isFinite(row.sortOrder) ? row.sortOrder : createdAt;
  return {
    id,
    title: titleRaw || "无标题",
    completed: row.completed === true,
    dueAt,
    notes: typeof row.notes === "string" ? row.notes : "",
    sortOrder,
    createdAt,
    updatedAt,
  };
}

export function parseWorkspaceTodosPayload(raw: string | null | undefined): WorkspaceTodosPayloadV1 {
  if (!raw?.trim()) {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceTodosPayloadV1>;
    if (!Array.isArray(parsed.items)) {
      return { version: 1, items: [] };
    }
    const items: WorkspaceTodoItem[] = [];
    const seen = new Set<string>();
    for (const entry of parsed.items) {
      const item = normalizeItem(entry);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    return { version: 1, items: sortWorkspaceTodoItems(items) };
  } catch {
    return { version: 1, items: [] };
  }
}

export function sortWorkspaceTodoItems(items: WorkspaceTodoItem[]): WorkspaceTodoItem[] {
  return [...items].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return b.updatedAt - a.updatedAt;
  });
}

export function mergeWorkspaceTodosPayload(items: WorkspaceTodoItem[]): WorkspaceTodosPayloadV1 {
  return { version: 1, items: sortWorkspaceTodoItems(items) };
}

export function formatWorkspaceTodoDueLabel(dueAt: number): string {
  const date = new Date(dueAt);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();
  if (isTomorrow) {
    return `明天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function isWorkspaceTodoOverdue(item: WorkspaceTodoItem, nowMs = Date.now()): boolean {
  if (item.completed || item.dueAt == null) return false;
  return item.dueAt < nowMs;
}
