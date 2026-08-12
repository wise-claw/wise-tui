export type WorkspaceRequirementStatus = "open" | "verifying" | "done";

export interface WorkspaceRequirementItem {
  id: string;
  title: string;
  /**
   * 图文正文（Markdown）。图片可为 data URL（编辑中）或本地绝对路径（落盘后）。
   * 兼容旧字段：若缺失则回退 `description`。
   */
  bodyMarkdown: string;
  /** @deprecated 旧版纯文本说明；读取时并入 bodyMarkdown */
  description?: string;
  /** 已落盘的本地图片绝对路径（派发用）；与 body 内图片引用对齐 */
  imagePaths: string[];
  status: WorkspaceRequirementStatus;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  /** 最近一次派发到待执行队列的时间；未派发为 null */
  lastDispatchedAt: number | null;
  /**
   * 归属仓库 id（Wise `Repository.id`）。
   * 旧数据可能为 null；新增时必须指定。
   */
  repositoryId: string | null;
}

export interface WorkspaceRequirementsPayloadV1 {
  version: 1;
  items: WorkspaceRequirementItem[];
}

export function createWorkspaceRequirementId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `wreq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 从 Markdown 推导列表标题：首个非空、非纯图片行。 */
export function deriveRequirementTitle(bodyMarkdown: string): string {
  const text = typeof bodyMarkdown === "string" ? bodyMarkdown : "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) continue;
    const withoutHeading = trimmed.replace(/^#{1,6}\s+/, "");
    const withoutMd = withoutHeading
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (withoutMd) return withoutMd.slice(0, 120);
  }
  return "无标题需求";
}

export function createWorkspaceRequirementItem(
  bodyMarkdown: string,
  now = Date.now(),
  repositoryId: string | null = null,
): WorkspaceRequirementItem {
  const body = typeof bodyMarkdown === "string" ? bodyMarkdown : "";
  const repoId =
    typeof repositoryId === "string" && repositoryId.trim() ? repositoryId.trim() : null;
  return {
    id: createWorkspaceRequirementId(),
    title: deriveRequirementTitle(body),
    bodyMarkdown: body,
    imagePaths: [],
    status: "open",
    sortOrder: now,
    createdAt: now,
    updatedAt: now,
    lastDispatchedAt: null,
    repositoryId: repoId,
  };
}

function normalizeStatus(raw: unknown): WorkspaceRequirementStatus {
  if (raw === "done") return "done";
  if (raw === "verifying") return "verifying";
  return "open";
}

function normalizeImagePaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const p = entry.trim();
    if (p.startsWith("/") && !out.includes(p)) out.push(p);
  }
  return out;
}

function normalizeItem(raw: unknown): WorkspaceRequirementItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<WorkspaceRequirementItem> & { description?: unknown };
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  const createdAt =
    typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : Date.now();
  const updatedAt =
    typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
  const sortOrder =
    typeof row.sortOrder === "number" && Number.isFinite(row.sortOrder) ? row.sortOrder : createdAt;
  const lastDispatchedAt =
    typeof row.lastDispatchedAt === "number" && Number.isFinite(row.lastDispatchedAt) && row.lastDispatchedAt > 0
      ? row.lastDispatchedAt
      : null;

  const legacyDescription = typeof row.description === "string" ? row.description : "";
  const bodyMarkdown =
    typeof row.bodyMarkdown === "string"
      ? row.bodyMarkdown
      : legacyDescription;
  const titleRaw = typeof row.title === "string" ? row.title.trim() : "";
  const title = titleRaw || deriveRequirementTitle(bodyMarkdown) || "无标题需求";
  const repositoryIdRaw = typeof row.repositoryId === "string" ? row.repositoryId.trim() : "";
  const repositoryId = repositoryIdRaw || null;

  return {
    id,
    title,
    bodyMarkdown,
    imagePaths: normalizeImagePaths(row.imagePaths),
    status: normalizeStatus(row.status),
    sortOrder,
    createdAt,
    updatedAt,
    lastDispatchedAt,
    repositoryId,
  };
}

export function sortWorkspaceRequirementItems(
  items: WorkspaceRequirementItem[],
): WorkspaceRequirementItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "done" ? 1 : -1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return b.updatedAt - a.updatedAt;
  });
}

export function parseWorkspaceRequirementsPayload(
  raw: string | null | undefined,
): WorkspaceRequirementsPayloadV1 {
  if (!raw?.trim()) {
    return { version: 1, items: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceRequirementsPayloadV1>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return { version: 1, items: [] };
    }
    const items: WorkspaceRequirementItem[] = [];
    const seen = new Set<string>();
    for (const entry of parsed.items) {
      const item = normalizeItem(entry);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    return { version: 1, items: sortWorkspaceRequirementItems(items) };
  } catch {
    return { version: 1, items: [] };
  }
}

export function mergeWorkspaceRequirementsPayload(
  items: WorkspaceRequirementItem[],
): WorkspaceRequirementsPayloadV1 {
  return { version: 1, items: sortWorkspaceRequirementItems(items) };
}

/**
 * 从旧版备忘录 Markdown 中提取 checklist / 列表行，作为需求种子。
 * 仅识别 `- [ ]` / `- [x]` / `* ` / `- ` 开头的行。
 */
export function extractRequirementsFromMemoMarkdown(markdown: string): WorkspaceRequirementItem[] {
  const text = typeof markdown === "string" ? markdown : "";
  if (!text.trim()) return [];
  const items: WorkspaceRequirementItem[] = [];
  const seenTitles = new Set<string>();
  let order = Date.now();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const checklist = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    const bullet = checklist ? null : trimmed.match(/^[-*]\s+(.+)$/);
    let title = "";
    let status: WorkspaceRequirementStatus = "open";
    if (checklist) {
      status = checklist[1]!.toLowerCase() === "x" ? "done" : "open";
      title = checklist[2]!.trim();
    } else if (bullet) {
      title = bullet[1]!.trim();
    } else {
      continue;
    }
    if (!title || seenTitles.has(title)) continue;
    seenTitles.add(title);
    const item = createWorkspaceRequirementItem(title, order);
    item.status = status;
    items.push(item);
    order += 1;
  }
  return sortWorkspaceRequirementItems(items);
}

/** @deprecated 请用 buildRequirementDispatchPayload；保留给旧调用方的纯文本回退 */
export function formatRequirementDispatchPrompt(item: WorkspaceRequirementItem): string {
  const title = item.title.trim() || "无标题需求";
  const body = (item.bodyMarkdown || item.description || "").trim();
  if (!body || body === title) {
    return `请实现以下需求：\n\n${title}`;
  }
  return `请实现以下需求：\n\n## ${title}\n\n${body}`;
}
