import type { ClaudeMessage, MessagePart, TodoItem } from "../types";

const TODO_WRITE_NAMES = new Set(["todowrite", "todo_write"]);

function normalizeTodoStatus(raw: unknown): TodoItem["status"] | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "pending") return "pending";
  if (s === "in_progress" || s === "in-progress" || s === "inprogress") return "in_progress";
  if (s === "completed" || s === "done" || s === "cancelled" || s === "canceled") return "completed";
  return null;
}

function stableTodoId(content: string, index: number, explicitId?: string): string {
  const trimmed = explicitId?.trim();
  if (trimmed) return trimmed;
  const base = content.trim().slice(0, 40) || `item_${index}`;
  return `todo_${base.replace(/\s+/g, "_")}`;
}

/** 解析 TodoWrite 工具 input → TodoItem[]；无法识别时返回 null。 */
export function parseTodoWriteInput(input: unknown): { items: TodoItem[]; merge: boolean } | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  const rawTodos = rec.todos;
  if (!Array.isArray(rawTodos) || rawTodos.length === 0) return null;

  const items: TodoItem[] = [];
  rawTodos.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;
    const content =
      (typeof row.content === "string" && row.content.trim()) ||
      (typeof row.title === "string" && row.title.trim()) ||
      "";
    if (!content) return;
    const status = normalizeTodoStatus(row.status) ?? "pending";
    const explicitId = typeof row.id === "string" ? row.id : undefined;
    items.push({
      id: stableTodoId(content, index, explicitId),
      content: content.trim(),
      status,
    });
  });

  if (items.length === 0) return null;
  const merge = rec.merge === true;
  return { items, merge };
}

export function isTodoWriteToolName(name: string | undefined | null): boolean {
  if (!name) return false;
  return TODO_WRITE_NAMES.has(name.trim().toLowerCase());
}

/** 从已解析的 message parts 提取 TodoWrite 并返回最后一次有效写入。 */
export function extractTodoWriteFromMessageParts(
  parts: readonly MessagePart[],
): { items: TodoItem[]; merge: boolean } | null {
  let last: { items: TodoItem[]; merge: boolean } | null = null;
  for (const part of parts) {
    if (part.type !== "tool_use") continue;
    if (!isTodoWriteToolName(part.name)) continue;
    const parsed = parseTodoWriteInput(part.input);
    if (parsed) last = parsed;
  }
  return last;
}

export function computeTodoProgress(items: readonly TodoItem[]): {
  total: number;
  progressed: number;
  completed: number;
  allCompleted: boolean;
} {
  const total = items.length;
  const completed = items.filter((t) => t.status === "completed").length;
  const progressed = items.filter(
    (t) => t.status === "completed" || t.status === "in_progress",
  ).length;
  return {
    total,
    progressed,
    completed,
    allCompleted: total > 0 && completed === total,
  };
}

/** 折叠条标题：优先进行中，其次待办，否则最后一项。 */
export function pickActiveTodoTitle(items: readonly TodoItem[]): string | null {
  const inProgress = items.find((t) => t.status === "in_progress");
  if (inProgress) return inProgress.content;
  const pending = items.find((t) => t.status === "pending");
  if (pending) return pending.content;
  if (items.length === 0) return null;
  return items[items.length - 1]?.content ?? null;
}

export function truncateTodoTitle(text: string, maxLen = 42): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

/** 从会话 transcript 取最后一次 TodoWrite（含 merge 语义）。 */
export function extractLatestTodoWriteFromMessages(
  messages: readonly ClaudeMessage[],
): { items: TodoItem[]; merge: boolean } | null {
  let last: { items: TodoItem[]; merge: boolean } | null = null;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const batch = extractTodoWriteFromMessageParts(msg.parts);
    if (batch) last = batch;
  }
  return last;
}

export function todosSnapshotEqual(a: readonly TodoItem[], b: readonly TodoItem[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((t) => [t.id, t]));
  return a.every((t) => {
    const other = byId.get(t.id);
    return other && other.content === t.content && other.status === t.status;
  });
}

export function mergeTodoLists(
  existing: TodoItem[],
  incoming: TodoItem[],
  merge: boolean,
): TodoItem[] {
  if (!merge || existing.length === 0) return incoming;

  const byId = new Map(existing.map((t) => [t.id, t]));
  const byContent = new Map(existing.map((t) => [t.content.trim(), t]));

  for (const item of incoming) {
    const prev = byId.get(item.id) ?? byContent.get(item.content.trim());
    if (prev) {
      const merged: TodoItem = {
        id: prev.id,
        content: item.content.trim() || prev.content,
        status: item.status,
      };
      byId.set(prev.id, merged);
      byContent.set(merged.content, merged);
    } else {
      byId.set(item.id, item);
      byContent.set(item.content.trim(), item);
    }
  }
  return [...byId.values()];
}
