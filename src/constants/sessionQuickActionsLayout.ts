import { SESSION_QUICK_BUILTIN_ASSISTANTS } from "./sessionQuickBuiltinAssistants";

export const SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY = "wise.session.quickActionsLayout.v1";

export type SessionQuickActionId =
  | "new-session"
  | "requirement-split"
  | "push"
  | "builtin:prd-split"
  | "builtin:word-doc"
  | "builtin:ppt-deck"
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

function builtinMeta(id: SessionQuickActionId, menuLabel: string): SessionQuickActionMeta {
  return {
    id,
    label: menuLabel,
    pillLabel: menuLabel.replace(/助手$/, "") || menuLabel,
  };
}

export const SESSION_QUICK_ACTION_META: Record<SessionQuickActionId, SessionQuickActionMeta> = {
  "new-session": { id: "new-session", label: "新建会话", pillLabel: "新建会话" },
  "requirement-split": { id: "requirement-split", label: "需求", pillLabel: "需求" },
  push: { id: "push", label: "推送", pillLabel: "推送" },
  "builtin:prd-split": builtinMeta("builtin:prd-split", SESSION_QUICK_BUILTIN_ASSISTANTS[0].menuLabel),
  "builtin:word-doc": builtinMeta("builtin:word-doc", SESSION_QUICK_BUILTIN_ASSISTANTS[1].menuLabel),
  "builtin:ppt-deck": builtinMeta("builtin:ppt-deck", SESSION_QUICK_BUILTIN_ASSISTANTS[2].menuLabel),
  "work-trajectory": { id: "work-trajectory", label: "工作轨迹", pillLabel: "工作轨迹" },
  "work-tree": { id: "work-tree", label: "工作树", pillLabel: "工作树" },
};

/** 配置面板与合并时的稳定目录顺序 */
export const SESSION_QUICK_ACTION_CATALOG_ORDER: SessionQuickActionId[] = [
  "new-session",
  "requirement-split",
  "push",
  "builtin:prd-split",
  "builtin:word-doc",
  "builtin:ppt-deck",
  "work-trajectory",
  "work-tree",
];

export const DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT: SessionQuickActionsLayoutV1 = {
  version: 1,
  items: [
    { id: "new-session", visible: true, zone: "primary" },
    { id: "requirement-split", visible: true, zone: "primary" },
    { id: "push", visible: true, zone: "primary" },
    { id: "builtin:prd-split", visible: true, zone: "overflow" },
    { id: "builtin:word-doc", visible: true, zone: "overflow" },
    { id: "builtin:ppt-deck", visible: true, zone: "overflow" },
    { id: "work-trajectory", visible: true, zone: "overflow" },
    { id: "work-tree", visible: true, zone: "overflow" },
  ],
};

function isSessionQuickActionId(value: unknown): value is SessionQuickActionId {
  return typeof value === "string" && value in SESSION_QUICK_ACTION_META;
}

function isZone(value: unknown): value is SessionQuickActionZone {
  return value === "primary" || value === "overflow";
}

/** 与目录合并：保留用户顺序，补齐缺失项，剔除未知 id */
export function mergeSessionQuickActionsLayout(
  input: SessionQuickActionsLayoutV1 | null | undefined,
): SessionQuickActionsLayoutV1 {
  const source = input?.version === 1 && Array.isArray(input.items) ? input.items : [];
  const byId = new Map<SessionQuickActionId, SessionQuickActionLayoutItem>();

  for (const raw of source) {
    if (!raw || !isSessionQuickActionId(raw.id)) continue;
    byId.set(raw.id, {
      id: raw.id,
      visible: raw.visible !== false,
      zone: isZone(raw.zone) ? raw.zone : "overflow",
    });
  }

  const defaultById = new Map(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT.items.map((item) => [item.id, item]));

  const orderedKnown: SessionQuickActionLayoutItem[] = [];
  for (const item of source) {
    if (!item || !isSessionQuickActionId(item.id) || orderedKnown.some((x) => x.id === item.id)) continue;
    orderedKnown.push(byId.get(item.id)!);
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

export function readSessionQuickActionsLayoutFromLocalStorage(): SessionQuickActionsLayoutV1 {
  if (typeof window === "undefined") {
    return mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
  }
  return parseSessionQuickActionsLayout(window.localStorage.getItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY));
}

export function writeSessionQuickActionsLayoutToLocalStorage(layout: SessionQuickActionsLayoutV1): void {
  if (typeof window === "undefined") return;
  const normalized = mergeSessionQuickActionsLayout(layout);
  window.localStorage.setItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
}

export interface SessionQuickActionsAvailability {
  canNewSession: boolean;
  canWorkTree: boolean;
}

export function isSessionQuickActionAvailable(
  id: SessionQuickActionId,
  availability: SessionQuickActionsAvailability,
): boolean {
  if (id === "new-session") return availability.canNewSession;
  if (id === "work-tree") return availability.canWorkTree;
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
