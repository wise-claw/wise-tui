import type {
  WorkspaceTodoDisplayItem,
  WorkspaceTodoItem,
  WorkspaceTodoScope,
} from "../types/workspaceTodos";

function todoItemFieldsEqual(a: WorkspaceTodoItem, b: WorkspaceTodoItem): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.completed === b.completed &&
    a.dueAt === b.dueAt &&
    a.notes === b.notes &&
    a.sortOrder === b.sortOrder &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt
  );
}

function sortDisplayItems(rows: WorkspaceTodoDisplayItem[]): WorkspaceTodoDisplayItem[] {
  return [...rows].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return b.updatedAt - a.updatedAt;
  });
}

/** 合并展示行时保留未变化条目的引用，避免 TodoRow memo 因全量 spread 失效。 */
export function reconcileWorkspaceTodoDisplayItems(
  previous: readonly WorkspaceTodoDisplayItem[],
  projectId: string | null,
  repositoryId: number | null,
  projectItems: readonly WorkspaceTodoItem[],
  repositoryItems: readonly WorkspaceTodoItem[],
): WorkspaceTodoDisplayItem[] {
  const prevByKey = new Map(previous.map((item) => [`${item.scope}:${item.id}`, item]));
  const rows: WorkspaceTodoDisplayItem[] = [];

  if (projectId?.trim()) {
    for (const item of projectItems) {
      const key = `project:${item.id}`;
      const existing = prevByKey.get(key);
      if (existing?.scope === "project" && todoItemFieldsEqual(existing, item)) {
        rows.push(existing);
      } else {
        rows.push({ ...item, scope: "project" });
      }
    }
  }

  if (repositoryId != null) {
    for (const item of repositoryItems) {
      const key = `repository:${item.id}`;
      const existing = prevByKey.get(key);
      if (existing?.scope === "repository" && todoItemFieldsEqual(existing, item)) {
        rows.push(existing);
      } else {
        rows.push({ ...item, scope: "repository" });
      }
    }
  }

  return sortDisplayItems(rows);
}

export function scopeItemsFromDisplay(
  displayItems: readonly WorkspaceTodoDisplayItem[],
  scope: WorkspaceTodoScope,
): WorkspaceTodoItem[] {
  const rows: WorkspaceTodoItem[] = [];
  for (const row of displayItems) {
    if (row.scope !== scope) continue;
    const { scope: _scope, ...rest } = row;
    rows.push(rest);
  }
  return rows;
}
