/** 左栏可拖拽重排的分区 id（与 VS Code sidebar view 类似）。 */
export const LEFT_SIDEBAR_SECTION_IDS = [
  "workspace",
  "requirements",
  "repoPanel",
  "monitor",
] as const;

export type LeftSidebarSectionId = (typeof LEFT_SIDEBAR_SECTION_IDS)[number];

export const LEFT_SIDEBAR_SECTION_ORDER_DEFAULT: LeftSidebarSectionId[] = [
  "workspace",
  "requirements",
  "repoPanel",
  "monitor",
];

/** 兼容旧「工作区置底」：需求 / Git 在上，工作区贴底。 */
export const LEFT_SIDEBAR_SECTION_ORDER_WORKSPACE_BOTTOM: LeftSidebarSectionId[] = [
  "requirements",
  "repoPanel",
  "monitor",
  "workspace",
];

const SECTION_ID_SET = new Set<string>(LEFT_SIDEBAR_SECTION_IDS);

export function isLeftSidebarSectionId(raw: unknown): raw is LeftSidebarSectionId {
  return typeof raw === "string" && SECTION_ID_SET.has(raw);
}

/**
 * 归一化分区顺序：去重、补全缺失项，保留已知顺序偏好。
 */
export function normalizeLeftSidebarSectionOrder(raw: unknown): LeftSidebarSectionId[] {
  const seen = new Set<LeftSidebarSectionId>();
  const next: LeftSidebarSectionId[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isLeftSidebarSectionId(entry) || seen.has(entry)) continue;
      seen.add(entry);
      next.push(entry);
    }
  }
  for (const id of LEFT_SIDEBAR_SECTION_ORDER_DEFAULT) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

/** 将 `fromId` 移动到 `toId` 之前（同 id 则不变）。 */
export function moveLeftSidebarSectionBefore(
  order: readonly LeftSidebarSectionId[],
  fromId: LeftSidebarSectionId,
  toId: LeftSidebarSectionId,
): LeftSidebarSectionId[] {
  if (fromId === toId) return normalizeLeftSidebarSectionOrder(order);
  const base = normalizeLeftSidebarSectionOrder(order);
  const without = base.filter((id) => id !== fromId);
  const toIndex = without.indexOf(toId);
  if (toIndex < 0) {
    return normalizeLeftSidebarSectionOrder([...without, fromId]);
  }
  const next = [...without.slice(0, toIndex), fromId, ...without.slice(toIndex)];
  return normalizeLeftSidebarSectionOrder(next);
}

/** 将 `fromId` 移动到 `toId` 之后。 */
export function moveLeftSidebarSectionAfter(
  order: readonly LeftSidebarSectionId[],
  fromId: LeftSidebarSectionId,
  toId: LeftSidebarSectionId,
): LeftSidebarSectionId[] {
  if (fromId === toId) return normalizeLeftSidebarSectionOrder(order);
  const base = normalizeLeftSidebarSectionOrder(order);
  const without = base.filter((id) => id !== fromId);
  const toIndex = without.indexOf(toId);
  if (toIndex < 0) {
    return normalizeLeftSidebarSectionOrder([...without, fromId]);
  }
  const next = [...without.slice(0, toIndex + 1), fromId, ...without.slice(toIndex + 1)];
  return normalizeLeftSidebarSectionOrder(next);
}

/**
 * 根据拖放到目标分区的位置（上半 / 下半）计算新顺序。
 */
export function reorderLeftSidebarSectionByDrop(
  order: readonly LeftSidebarSectionId[],
  fromId: LeftSidebarSectionId,
  toId: LeftSidebarSectionId,
  placeAfter: boolean,
): LeftSidebarSectionId[] {
  return placeAfter
    ? moveLeftSidebarSectionAfter(order, fromId, toId)
    : moveLeftSidebarSectionBefore(order, fromId, toId);
}

export function leftSidebarSectionOrderIndex(
  order: readonly LeftSidebarSectionId[],
  id: LeftSidebarSectionId,
): number {
  const normalized = normalizeLeftSidebarSectionOrder(order);
  const index = normalized.indexOf(id);
  return index < 0 ? normalized.length : index;
}
