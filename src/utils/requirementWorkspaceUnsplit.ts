import type {
  TrellisRequirementPrdRow,
  TrellisRequirementTaskRow,
  TrellisRequirementWorkspaceSnapshot,
} from "../services/trellisTaskBridge";
import {
  type RequirementSnapshotCountScope,
  isProjectWorkspaceRequirementPrd,
  isRepositoryWorkspaceRequirementPrd,
} from "./taskDrawerCounts";

function parseRequirementIds(requirementsIndexJson: string | null): string[] {
  if (!requirementsIndexJson?.trim()) return [];
  try {
    const idx = JSON.parse(requirementsIndexJson) as { requirements?: Array<{ id?: string }> };
    return (idx.requirements ?? [])
      .map((entry) => entry.id?.trim())
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

function prdMatchesCountScope(
  prd: TrellisRequirementPrdRow,
  scope?: RequirementSnapshotCountScope,
): boolean {
  if (!scope) return true;
  if (scope.kind === "workspace") return isProjectWorkspaceRequirementPrd(prd);
  return isRepositoryWorkspaceRequirementPrd(prd) && prd.repositoryId === scope.repositoryId;
}

function filterActivePrds(
  prds: TrellisRequirementPrdRow[],
  scope?: RequirementSnapshotCountScope,
): TrellisRequirementPrdRow[] {
  return prds.filter((prd) => !prd.archived && prdMatchesCountScope(prd, scope));
}

function buildActiveTaskMap(tasks: TrellisRequirementTaskRow[]): Map<string, TrellisRequirementTaskRow> {
  return new Map(tasks.filter((task) => !task.archived).map((task) => [task.taskId, task]));
}

/** 统计 requirements-index 中尚未被任何子任务 sourceRequirementIds 覆盖的需求条数（未生成过任务）。 */
export function countUnsplitRequirementsInSnapshot(
  snapshot: TrellisRequirementWorkspaceSnapshot,
  scope?: RequirementSnapshotCountScope,
): number {
  const taskById = buildActiveTaskMap(snapshot.tasks);
  const activePrds = filterActivePrds(snapshot.prds, scope);

  let unsplit = 0;
  for (const prd of activePrds) {
    const requirementIds = parseRequirementIds(prd.requirementsIndexJson);
    if (requirementIds.length === 0) continue;

    const coveredRequirementIds = new Set<string>();
    for (const childTaskId of prd.childTaskIds) {
      const childTask = taskById.get(childTaskId);
      if (!childTask) continue;
      for (const requirementId of childTask.sourceRequirementIds ?? []) {
        const trimmed = requirementId.trim();
        if (trimmed) coveredRequirementIds.add(trimmed);
      }
    }

    for (const requirementId of requirementIds) {
      if (!coveredRequirementIds.has(requirementId)) unsplit += 1;
    }
  }

  return unsplit;
}
