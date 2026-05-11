import type { ProjectItem } from "../types";

export const PINNED_PROJECT_IDS_STORAGE_KEY = "wise.sidebar.pinnedProjectIds.v1";

export function parsePinnedProjectIdsFromSetting(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** 置顶 id 顺序在前，其余保持 `projects` 原有相对顺序。 */
export function sortProjectsByPinOrder(projects: ProjectItem[], pinOrder: string[]): ProjectItem[] {
  if (pinOrder.length === 0) return [...projects];
  const pinSet = new Set(pinOrder);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const pinned: ProjectItem[] = [];
  for (const id of pinOrder) {
    const p = byId.get(id);
    if (p) pinned.push(p);
  }
  const rest = projects.filter((p) => !pinSet.has(p.id));
  return [...pinned, ...rest];
}
