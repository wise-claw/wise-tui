/**
 * 扫描项目下已有的 PRD-split 父任务（带 clusterId + requirements-index.json），
 * 为 wizard 的 diff replay 提供基线。
 */

import { invoke } from "@tauri-apps/api/core";
import { upgradeRequirementsIndex, type RequirementsIndexV2 } from "./requirementsIndexVersion";

export interface ScannedParentTask {
  parentTaskName: string;
  parentTaskPath: string;
  clusterId: string;
  primaryRepositoryId: number | null;
  requirementsIndexJson: string | null;
}

interface RustScanOutput {
  parents: ScannedParentTask[];
}

export interface ExistingParentRef {
  parentTaskName: string;
  parentTaskPath: string;
  primaryRepositoryId: number | null;
  requirementsIndex: RequirementsIndexV2 | null;
}

export async function scanProjectParents(projectRootPath: string): Promise<ScannedParentTask[]> {
  const out = await invoke<RustScanOutput>("prd_split_scan_project_parents", { projectRootPath });
  return out.parents;
}

export async function scanProjectParentsAcrossRoots(rootPaths: string[]): Promise<ScannedParentTask[]> {
  return collectProjectParentsAcrossRoots(rootPaths, scanProjectParents);
}

export async function collectProjectParentsAcrossRoots(
  rootPaths: string[],
  scan: (rootPath: string) => Promise<ScannedParentTask[]>,
): Promise<ScannedParentTask[]> {
  const unique = [...new Set(rootPaths.map((path) => path.trim()).filter(Boolean))];
  const settled = await Promise.allSettled(unique.map((rootPath) => scan(rootPath)));
  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

/** 按 clusterId 索引；同 clusterId 多次出现时保留 parentTaskName 最大者（按名称的 MM-DD 前缀粗略排序）。 */
export function indexParentsByClusterId(
  parents: ScannedParentTask[],
): Map<string, ExistingParentRef> {
  const grouped = new Map<string, ScannedParentTask>();
  for (const parent of parents) {
    const existing = grouped.get(parent.clusterId);
    if (!existing || parent.parentTaskName > existing.parentTaskName) {
      grouped.set(parent.clusterId, parent);
    }
  }
  const out = new Map<string, ExistingParentRef>();
  for (const [clusterId, parent] of grouped.entries()) {
    out.set(clusterId, {
      parentTaskName: parent.parentTaskName,
      parentTaskPath: parent.parentTaskPath,
      primaryRepositoryId: parent.primaryRepositoryId,
      requirementsIndex: parseIndex(parent.requirementsIndexJson),
    });
  }
  return out;
}

function parseIndex(raw: string | null): RequirementsIndexV2 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return upgradeRequirementsIndex(parsed as Parameters<typeof upgradeRequirementsIndex>[0]);
  } catch {
    return null;
  }
}
