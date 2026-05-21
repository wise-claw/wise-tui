import {
  SESSION_QUICK_BUILTIN_ASSISTANTS,
  type SessionQuickBuiltinAssistantId,
} from "./sessionQuickBuiltinAssistants";

export const SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY = "wise.session.quickActionsLayout.v2";
/** @deprecated 读取后迁移到 v2，并确保「需求」外显 */
export const SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1 = "wise.session.quickActionsLayout.v1";

export type SessionQuickActionId =
  | "new-session"
  | "push"
  | "compact-context"
  | SessionQuickBuiltinAssistantId
  | "work-trajectory"
  | "work-tree";

export type SessionQuickActionZone = "primary" | "overflow";

export interface SessionQuickActionLayoutItem {
  id: SessionQuickActionId;
  visible: boolean;
  zone: SessionQuickActionZone;
}

export interface SessionQuickActionsLayoutV1 {
  version: 1;
  items: SessionQuickActionLayoutItem[];
}

export interface SessionQuickActionMeta {
  id: SessionQuickActionId;
  label: string;
  pillLabel: string;
}

function builtinMeta(id: SessionQuickBuiltinAssistantId, menuLabel: string): SessionQuickActionMeta {
  const pillLabel =
    id === "builtin:prd-split"
      ? "需求"
      : menuLabel.replace(/助手$/, "") || menuLabel;
  return {
    id,
    label: id === "builtin:prd-split" ? "需求" : menuLabel,
    pillLabel,
  };
}

const BUILTIN_QUICK_ACTION_META = Object.fromEntries(
  SESSION_QUICK_BUILTIN_ASSISTANTS.map((row) => [
    row.id,
    builtinMeta(row.id, row.menuLabel),
  ]),
) as Record<SessionQuickBuiltinAssistantId, SessionQuickActionMeta>;

export const SESSION_QUICK_ACTION_META: Record<SessionQuickActionId, SessionQuickActionMeta> = {
  "new-session": { id: "new-session", label: "新建会话", pillLabel: "新建会话" },
  push: { id: "push", label: "推送", pillLabel: "推送" },
  "compact-context": { id: "compact-context", label: "压缩上下文", pillLabel: "压缩上下文" },
  ...BUILTIN_QUICK_ACTION_META,
  "work-trajectory": { id: "work-trajectory", label: "工作轨迹", pillLabel: "工作轨迹" },
  "work-tree": { id: "work-tree", label: "工作树", pillLabel: "工作树" },
};

/** 配置面板与合并时的稳定目录顺序 */
export const SESSION_QUICK_ACTION_CATALOG_ORDER: SessionQuickActionId[] = [
  "new-session",
  "push",
  "compact-context",
  ...SESSION_QUICK_BUILTIN_ASSISTANTS.map((row) => row.id),
  "work-trajectory",
  "work-tree",
];

export const DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT: SessionQuickActionsLayoutV1 = {
  version: 1,
  items: [
    { id: "new-session", visible: true, zone: "primary" },
    { id: "builtin:prd-split", visible: true, zone: "primary" },
    { id: "push", visible: true, zone: "primary" },
    { id: "compact-context", visible: false, zone: "overflow" },
    { id: "builtin:word-doc", visible: true, zone: "overflow" },
    { id: "builtin:ppt-deck", visible: true, zone: "overflow" },
    { id: "builtin:excel-data", visible: true, zone: "overflow" },
    { id: "builtin:code-review", visible: true, zone: "overflow" },
    { id: "builtin:tech-docs", visible: true, zone: "overflow" },
    { id: "builtin:test-gen", visible: true, zone: "overflow" },
    { id: "builtin:release-notes", visible: true, zone: "overflow" },
    { id: "work-trajectory", visible: true, zone: "overflow" },
    { id: "work-tree", visible: true, zone: "overflow" },
  ],
};

function isSessionQuickActionId(value: unknown): value is SessionQuickActionId {
  return typeof value === "string" && value in SESSION_QUICK_ACTION_META;
}

/** 旧版「需求」与「需求拆分助手」合并为 builtin:prd-split */
function normalizeSessionQuickActionId(value: unknown): SessionQuickActionId | null {
  if (value === "requirement-split") return "builtin:prd-split";
  return isSessionQuickActionId(value) ? value : null;
}

function isZone(value: unknown): value is SessionQuickActionZone {
  return value === "primary" || value === "overflow";
}

function mergeQuickActionLayoutItem(
  prev: SessionQuickActionLayoutItem | undefined,
  next: SessionQuickActionLayoutItem,
): SessionQuickActionLayoutItem {
  if (!prev) return next;
  return {
    id: next.id,
    visible: prev.visible && next.visible,
    zone: prev.zone === "primary" || next.zone === "primary" ? "primary" : "overflow",
  };
}

/** 「需求」默认外显；用于 v1 布局迁移与恢复默认 */
export function ensurePrdSplitQuickActionPrimary(
  layout: SessionQuickActionsLayoutV1,
): SessionQuickActionsLayoutV1 {
  return updateLayoutItem(mergeSessionQuickActionsLayout(layout), "builtin:prd-split", {
    visible: true,
    zone: "primary",
  });
}

/** 与目录合并：保留用户顺序，补齐缺失项，剔除未知 id */
export function mergeSessionQuickActionsLayout(
  input: SessionQuickActionsLayoutV1 | null | undefined,
): SessionQuickActionsLayoutV1 {
  const source = input?.version === 1 && Array.isArray(input.items) ? input.items : [];
  const byId = new Map<SessionQuickActionId, SessionQuickActionLayoutItem>();

  for (const raw of source) {
    const id = normalizeSessionQuickActionId(raw?.id);
    if (!raw || !id) continue;
    const next: SessionQuickActionLayoutItem = {
      id,
      visible: raw.visible !== false,
      zone: isZone(raw.zone) ? raw.zone : "overflow",
    };
    byId.set(id, mergeQuickActionLayoutItem(byId.get(id), next));
  }

  const defaultById = new Map(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT.items.map((item) => [item.id, item]));

  const orderedKnown: SessionQuickActionLayoutItem[] = [];
  for (const item of source) {
    const id = normalizeSessionQuickActionId(item?.id);
    if (!item || !id || orderedKnown.some((x) => x.id === id)) continue;
    orderedKnown.push(byId.get(id)!);
  }

  for (const id of SESSION_QUICK_ACTION_CATALOG_ORDER) {
    if (!orderedKnown.some((item) => item.id === id)) {
      orderedKnown.push(byId.get(id) ?? defaultById.get(id) ?? { id, visible: true, zone: "overflow" });
    }
  }

  return { version: 1, items: orderedKnown };
}

export function parseSessionQuickActionsLayout(raw: string | null | undefined): SessionQuickActionsLayoutV1 {
  if (!raw?.trim()) {
    return mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
    }
    return mergeSessionQuickActionsLayout(parsed as SessionQuickActionsLayoutV1);
  } catch {
    return mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
  }
}

export interface SessionQuickActionsAvailability {
  canNewSession: boolean;
  canWorkTree: boolean;
  canCompactContext: boolean;
}

export function isSessionQuickActionAvailable(
  id: SessionQuickActionId,
  availability: SessionQuickActionsAvailability,
): boolean {
  if (id === "new-session") return availability.canNewSession;
  if (id === "work-tree") return availability.canWorkTree;
  /** 已迁至输入框底栏（分支后），快捷条不再展示 */
  if (id === "compact-context") return false;
  return true;
}

export function partitionSessionQuickActions(
  layout: SessionQuickActionsLayoutV1,
  availability: SessionQuickActionsAvailability,
): { primary: SessionQuickActionId[]; overflow: SessionQuickActionId[] } {
  const normalized = mergeSessionQuickActionsLayout(layout);
  const primary: SessionQuickActionId[] = [];
  const overflow: SessionQuickActionId[] = [];

  for (const item of normalized.items) {
    if (!item.visible) continue;
    if (!isSessionQuickActionAvailable(item.id, availability)) continue;
    if (item.zone === "primary") primary.push(item.id);
    else overflow.push(item.id);
  }

  return { primary, overflow };
}

export function moveLayoutItem(
  layout: SessionQuickActionsLayoutV1,
  id: SessionQuickActionId,
  direction: "up" | "down",
): SessionQuickActionsLayoutV1 {
  const normalized = mergeSessionQuickActionsLayout(layout);
  const index = normalized.items.findIndex((item) => item.id === id);
  if (index < 0) return normalized;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= normalized.items.length) return normalized;
  const next = [...normalized.items];
  const [removed] = next.splice(index, 1);
  next.splice(target, 0, removed);
  return { version: 1, items: next };
}

export function updateLayoutItem(
  layout: SessionQuickActionsLayoutV1,
  id: SessionQuickActionId,
  patch: Partial<Pick<SessionQuickActionLayoutItem, "visible" | "zone">>,
): SessionQuickActionsLayoutV1 {
  const normalized = mergeSessionQuickActionsLayout(layout);
  return {
    version: 1,
    items: normalized.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  };
}
