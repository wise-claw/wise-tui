export function buildPrdSplitMissionId(projectId: string, prdMarkdown: string): string {
  const source = `${projectId}:${prdMarkdown.trim()}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mission-${normalizePrdSplitMissionId(projectId)}-${(hash >>> 0).toString(16)}`;
}

export function buildPrdSplitMissionAssignmentId(
  missionId: string,
  clusterId: string,
  stage: string,
): string {
  return `${normalizePrdSplitMissionId(missionId)}-${normalizePrdSplitMissionId(clusterId)}-${normalizePrdSplitMissionId(stage)}`;
}

export function normalizePrdSplitMissionId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mission";
}
