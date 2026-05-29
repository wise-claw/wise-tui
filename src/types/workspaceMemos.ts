export type WorkspaceMemoScope = "project" | "repository";

export interface WorkspaceMemoItem {
  id: string;
  title: string;
  bodyMarkdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMemosPayloadV1 {
  version: 1;
  items: WorkspaceMemoItem[];
  lastSelectedId?: string | null;
}

export type WorkspaceMemoDisplayItem = WorkspaceMemoItem & {
  scope: WorkspaceMemoScope;
};

export type WorkspaceMemoSelection = {
  scope: WorkspaceMemoScope;
  id: string;
};

export function workspaceMemoTabKey(scope: WorkspaceMemoScope, id: string): string {
  return `${scope}:${id}`;
}

export function parseWorkspaceMemoTabKey(key: string): WorkspaceMemoSelection | null {
  const trimmed = key.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const scope = trimmed.slice(0, colon);
  const id = trimmed.slice(colon + 1).trim();
  if ((scope !== "project" && scope !== "repository") || !id) return null;
  return { scope, id };
}

export function createWorkspaceMemoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `wmemo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeItem(raw: unknown): WorkspaceMemoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<WorkspaceMemoItem>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const bodyMarkdown = typeof row.bodyMarkdown === "string" ? row.bodyMarkdown : "";
  if (!id) return null;
  const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : Date.now();
  const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
  return {
    id,
    title: title || "无标题",
    bodyMarkdown,
    createdAt,
    updatedAt,
  };
}

export function parseWorkspaceMemosPayload(raw: string | null | undefined): WorkspaceMemosPayloadV1 {
  if (!raw?.trim()) {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceMemosPayloadV1>;
    if (!Array.isArray(parsed.items)) {
      return { version: 1, items: [] };
    }
    const items: WorkspaceMemoItem[] = [];
    const seen = new Set<string>();
    for (const entry of parsed.items) {
      const item = normalizeItem(entry);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    const lastSelectedId =
      typeof parsed.lastSelectedId === "string" && parsed.lastSelectedId.trim()
        ? parsed.lastSelectedId.trim()
        : null;
    return { version: 1, items, lastSelectedId };
  } catch {
    return { version: 1, items: [] };
  }
}

export function mergeWorkspaceMemosPayload(
  items: WorkspaceMemoItem[],
  lastSelectedId?: string | null,
): WorkspaceMemosPayloadV1 {
  return {
    version: 1,
    items: [...items].sort((a, b) => b.updatedAt - a.updatedAt),
    lastSelectedId: lastSelectedId ?? null,
  };
}

/** 从正文首行推导标题（去掉 # 前缀）。 */
export function deriveMemoTitleFromBody(bodyMarkdown: string, fallback = "无标题"): string {
  const first = bodyMarkdown
    .trim()
    .split("\n")
    .find((line) => line.trim().length > 0);
  if (!first) return fallback;
  const stripped = first.replace(/^#+\s*/, "").trim();
  if (!stripped) return fallback;
  return stripped.length > 48 ? `${stripped.slice(0, 48)}…` : stripped;
}
