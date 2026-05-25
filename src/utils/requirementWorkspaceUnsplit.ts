import type {
  TrellisRequirementPrdRow,
  TrellisRequirementTaskRow,
  TrellisRequirementWorkspaceSnapshot,
} from "../services/trellisTaskBridge";

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

function filterActivePrds(
  prds: TrellisRequirementPrdRow[],
  repositoryId?: number | null,
): TrellisRequirementPrdRow[] {
  return prds.filter((prd) => {
    if (prd.archived) return false;
    if (repositoryId != null) return prd.repositoryId === repositoryId;
    return true;
  });
}

function buildActiveTaskMap(tasks: TrellisRequirementTaskRow[]): Map<string, TrellisRequirementTaskRow> {
  return new Map(tasks.filter((task) => !task.archived).map((task) => [task.taskId, task]));
}

/** 统计 requirements-index 中尚未被任何子任务 sourceRequirementIds 覆盖的需求条数（未生成过任务）。 */
export function countUnsplitRequirementsInSnapshot(
  snapshot: TrellisRequirementWorkspaceSnapshot,
  options?: { repositoryId?: number | null },
): number {
  const taskById = buildActiveTaskMap(snapshot.tasks);
  const activePrds = filterActivePrds(snapshot.prds, options?.repositoryId);

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
