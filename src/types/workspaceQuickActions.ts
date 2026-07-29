export type WorkspaceQuickActionKind = "link" | "directory";

export type WorkspaceQuickActionScope = "project" | "repository";

/** 未填写分类时的展示标签。 */
export const WORKSPACE_QUICK_ACTION_UNCATEGORIZED_LABEL = "未分类";

/** 分类名称最大长度。 */
export const WORKSPACE_QUICK_ACTION_CATEGORY_MAX_LENGTH = 40;

export interface WorkspaceQuickActionItem {
  id: string;
  kind: WorkspaceQuickActionKind;
  label: string;
  /** 外链 URL 或本地目录绝对路径 */
  target: string;
  /** 用户自定义分类；空或缺省表示未分类。 */
  category?: string;
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

/** 按用户自定义分类分组后的展示单元。 */
export type WorkspaceQuickActionCategoryGroup = {
  /** 归一化后的分类名；空字符串表示未分类。 */
  category: string;
  /** 展示用标题（空分类时为「未分类」）。 */
  label: string;
  items: WorkspaceQuickActionDisplayItem[];
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

export function normalizeWorkspaceQuickActionCategory(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, WORKSPACE_QUICK_ACTION_CATEGORY_MAX_LENGTH);
}

export function resolveWorkspaceQuickActionCategoryLabel(
  item: Pick<WorkspaceQuickActionItem, "category">,
): string {
  const category = normalizeWorkspaceQuickActionCategory(item.category);
  return category || WORKSPACE_QUICK_ACTION_UNCATEGORIZED_LABEL;
}

/**
 * 按用户自定义分类分组，保留条目在输入中的相对顺序，
 * 分组顺序取各组首次出现的位置；未分类组始终排在最后。
 */
export function groupWorkspaceQuickActionsByCategory(
  items: readonly WorkspaceQuickActionDisplayItem[],
): WorkspaceQuickActionCategoryGroup[] {
  const groups: WorkspaceQuickActionCategoryGroup[] = [];
  const indexByCategory = new Map<string, number>();
  let uncategorized: WorkspaceQuickActionCategoryGroup | null = null;

  for (const item of items) {
    const category = normalizeWorkspaceQuickActionCategory(item.category);
    if (!category) {
      if (!uncategorized) {
        uncategorized = {
          category: "",
          label: WORKSPACE_QUICK_ACTION_UNCATEGORIZED_LABEL,
          items: [],
        };
      }
      uncategorized.items.push(item);
      continue;
    }
    const existing = indexByCategory.get(category);
    if (existing == null) {
      indexByCategory.set(category, groups.length);
      groups.push({ category, label: category, items: [item] });
      continue;
    }
    groups[existing].items.push(item);
  }

  if (uncategorized && uncategorized.items.length > 0) {
    groups.push(uncategorized);
  }
  return groups;
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
  const category = normalizeWorkspaceQuickActionCategory(row.category);
  const item: WorkspaceQuickActionItem = { id, kind, label, target, createdAt, updatedAt };
  if (category) item.category = category;
  if (pinnedToTopbar) item.pinnedToTopbar = true;
  return item;
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

/** 从现有条目收集去重后的分类名，供编辑表单联想。 */
export function collectWorkspaceQuickActionCategories(
  items: readonly Pick<WorkspaceQuickActionItem, "category">[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const category = normalizeWorkspaceQuickActionCategory(item.category);
    if (!category || seen.has(category)) continue;
    seen.add(category);
    out.push(category);
  }
  out.sort((a, b) => a.localeCompare(b, "zh-CN"));
  return out;
}
