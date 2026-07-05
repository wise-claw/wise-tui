export type WorkspaceQuickActionKind = "link" | "directory";

export type WorkspaceQuickActionScope = "project" | "repository";

export interface WorkspaceQuickActionItem {
  id: string;
  kind: WorkspaceQuickActionKind;
  label: string;
  /** 外链 URL 或本地目录绝对路径 */
  target: string;
  /** 固定到中栏顶栏「远程」之后展示 */
  pinnedToTopbar?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceQuickActionsPayloadV1 {
  version: 1;
  items: WorkspaceQuickActionItem[];
}

export type WorkspaceQuickActionDisplayItem = WorkspaceQuickActionItem & {
  scope: WorkspaceQuickActionScope;
  /** 该条目所属 scope 的具体 id：project 时为 projectId，repository 时为 repositoryId 字符串。
   *  用于在「合并多个仓库展示」的场景下定位编辑/删除/置顶的正确 scope。 */
  scopeId: string;
};

export function resolveWorkspaceQuickActionPinnedToTopbar(
  item: Pick<WorkspaceQuickActionItem, "pinnedToTopbar">,
): boolean {
  return item.pinnedToTopbar === true;
}

export function filterWorkspaceQuickActionsForTopbar(
  items: readonly WorkspaceQuickActionDisplayItem[],
): WorkspaceQuickActionDisplayItem[] {
  return items.filter((item) => resolveWorkspaceQuickActionPinnedToTopbar(item));
}

export function createWorkspaceQuickActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `wqa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeKind(raw: unknown): WorkspaceQuickActionKind | null {
  return raw === "link" || raw === "directory" ? raw : null;
}

function normalizeItem(raw: unknown): WorkspaceQuickActionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<WorkspaceQuickActionItem>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const kind = normalizeKind(row.kind);
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const target = typeof row.target === "string" ? row.target.trim() : "";
  if (!id || !kind || !label || !target) return null;
  const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : Date.now();
  const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
  const pinnedToTopbar = row.pinnedToTopbar === true ? true : undefined;
  return pinnedToTopbar
    ? { id, kind, label, target, pinnedToTopbar, createdAt, updatedAt }
    : { id, kind, label, target, createdAt, updatedAt };
}

export function parseWorkspaceQuickActionsPayload(raw: string | null | undefined): WorkspaceQuickActionsPayloadV1 {
  if (!raw?.trim()) {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceQuickActionsPayloadV1>;
    if (!Array.isArray(parsed.items)) {
      return { version: 1, items: [] };
    }
    const items: WorkspaceQuickActionItem[] = [];
    const seen = new Set<string>();
    for (const entry of parsed.items) {
      const item = normalizeItem(entry);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return { version: 1, items };
  } catch {
    return { version: 1, items: [] };
  }
}

export function mergeWorkspaceQuickActionsPayload(
  items: WorkspaceQuickActionItem[],
): WorkspaceQuickActionsPayloadV1 {
  return { version: 1, items: [...items].sort((a, b) => b.updatedAt - a.updatedAt) };
}
