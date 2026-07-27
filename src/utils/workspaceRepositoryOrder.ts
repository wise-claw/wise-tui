import type { Repository } from "../types";
import { repositoryFolderBasename } from "./repositoryType";

export const WORKSPACE_REPOSITORY_ORDER_STORAGE_KEY = "wise.sidebar.workspaceRepositoryOrder.v1";

/** 扁平工作区拖拽共用 source id（与 project 内拖拽区分）。 */
export const FLAT_WORKSPACE_DRAG_SOURCE_ID = "__flat_workspace__";

export function parseWorkspaceRepositoryOrderFromSetting(
  raw: string | null | undefined,
): number[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0,
    );
  } catch {
    return [];
  }
}

function compareRepositoryBasename(a: Repository, b: Repository): number {
  return repositoryFolderBasename(a).localeCompare(repositoryFolderBasename(b), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * 按侧栏自定义顺序排工作区；无顺序时按显示名。
 * 顺序里未知 id 忽略；未出现在顺序中的仓库按显示名追加在末尾。
 */
export function sortRepositoriesByWorkspaceOrder(
  repositories: readonly Repository[],
  order: readonly number[],
): Repository[] {
  if (repositories.length <= 1) return [...repositories];
  if (order.length === 0) {
    return [...repositories].sort(compareRepositoryBasename);
  }
  const byId = new Map(repositories.map((repo) => [repo.id, repo] as const));
  const ordered: Repository[] = [];
  const used = new Set<number>();
  for (const id of order) {
    const repo = byId.get(id);
    if (!repo || used.has(id)) continue;
    ordered.push(repo);
    used.add(id);
  }
  const rest = repositories.filter((repo) => !used.has(repo.id)).sort(compareRepositoryBasename);
  return [...ordered, ...rest];
}

/** 写入设置前剪枝：只保留仍存在的 id，并补上遗漏的（末尾、按名）。 */
export function normalizeWorkspaceRepositoryOrder(
  order: readonly number[],
  repositoryIds: readonly number[],
  basenameById?: ReadonlyMap<number, string>,
): number[] {
  const valid = new Set(repositoryIds);
  const next: number[] = [];
  const used = new Set<number>();
  for (const id of order) {
    if (!valid.has(id) || used.has(id)) continue;
    next.push(id);
    used.add(id);
  }
  const missing = repositoryIds.filter((id) => !used.has(id));
  if (missing.length === 0) return next;
  if (basenameById) {
    missing.sort((a, b) =>
      (basenameById.get(a) ?? "").localeCompare(basenameById.get(b) ?? "", "zh-CN", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }
  return [...next, ...missing];
}
