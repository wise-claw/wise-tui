export interface SplitDeltaPlan {
  affectedRequirements: string[];
  affectedTaskIds: string[];
  boundaryTaskIds: string[];
}

interface RequirementEntry {
  id: string;
}

interface SplitTaskLike {
  id: string;
  sourceRequirementIds: string[];
  dependencies: string[];
}

interface ParsedSplitData {
  tasks: SplitTaskLike[];
  taskIdSet: Set<string>;
  requirementIdsFromTasks: string[];
}

const EMPTY_PLAN: SplitDeltaPlan = {
  affectedRequirements: [],
  affectedTaskIds: [],
  boundaryTaskIds: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    values.push(trimmed);
  }
  return values;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function parseRequirementIndex(requirementIndex: unknown): RequirementEntry[] {
  const source = Array.isArray(requirementIndex)
    ? requirementIndex
    : isRecord(requirementIndex) && Array.isArray(requirementIndex.requirements)
      ? requirementIndex.requirements
      : [];

  const entries: RequirementEntry[] = [];
  for (const item of source) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string") continue;
    const id = item.id.trim();
    if (!id) continue;
    entries.push({ id });
  }
  return entries;
}

function parseSplitResult(splitResult: unknown): ParsedSplitData | null {
  if (!isRecord(splitResult)) return null;
  const rawTasks = Array.isArray(splitResult.splitTasks)
    ? splitResult.splitTasks
    : Array.isArray(splitResult.tasks)
      ? splitResult.tasks
      : null;
  if (!rawTasks) return null;
  const tasks: SplitTaskLike[] = [];
  const requirementIdSet = new Set<string>();
  const taskIdSet = new Set<string>();

  for (const item of rawTasks) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string") continue;
    const id = item.id.trim();
    if (!id) continue;
    const sourceRequirementIds = asStringArray(item.sourceRequirementIds);
    const dependencies = asStringArray(item.dependencies);
    for (const requirementId of sourceRequirementIds) requirementIdSet.add(requirementId);
    tasks.push({ id, sourceRequirementIds, dependencies });
    taskIdSet.add(id);
  }

  return {
    tasks,
    taskIdSet,
    requirementIdsFromTasks: uniqueSorted(requirementIdSet),
  };
}

function selectAffectedRequirements(input: {
  tags: string[];
  requirementIdsFromIndex: string[];
  requirementIdsFromTasks: string[];
}): string[] {
  const tagSet = new Set(input.tags);
  const hasMissingCoverage = tagSet.has("missing_coverage");
  const hasStructureIssue = tagSet.has("dependency") || tagSet.has("parallelism") || tagSet.has("granularity");
  const hasRequirementScope = hasMissingCoverage || hasStructureIssue;
  if (!hasRequirementScope) return [];

  if (input.requirementIdsFromIndex.length > 0) {
    return input.requirementIdsFromIndex;
  }
  return input.requirementIdsFromTasks;
}

export function buildSplitDeltaPlan(input: {
  feedbackTags: string[];
  splitResult: unknown;
  requirementIndex: unknown;
}): SplitDeltaPlan {
  const tags = uniqueSorted(asStringArray(input.feedbackTags));
  if (tags.length === 0) return EMPTY_PLAN;

  const parsed = parseSplitResult(input.splitResult);
  if (!parsed || parsed.tasks.length === 0) return EMPTY_PLAN;

  const requirementEntries = parseRequirementIndex(input.requirementIndex);
  const requirementIdsFromIndex = uniqueSorted(requirementEntries.map((entry) => entry.id));
  const affectedRequirements = selectAffectedRequirements({
    tags,
    requirementIdsFromIndex,
    requirementIdsFromTasks: parsed.requirementIdsFromTasks,
  });

  if (affectedRequirements.length === 0) return EMPTY_PLAN;

  const affectedRequirementSet = new Set(affectedRequirements);
  const affectedTaskSet = new Set<string>();
  for (const task of parsed.tasks) {
    if (task.sourceRequirementIds.some((requirementId) => affectedRequirementSet.has(requirementId))) {
      affectedTaskSet.add(task.id);
    }
  }

  const boundaryTaskSet = new Set<string>();
  for (const task of parsed.tasks) {
    if (!affectedTaskSet.has(task.id)) continue;
    for (const dep of task.dependencies) {
      if (!parsed.taskIdSet.has(dep)) continue;
      if (affectedTaskSet.has(dep)) continue;
      boundaryTaskSet.add(dep);
    }
  }

  return {
    affectedRequirements: uniqueSorted(affectedRequirements),
    affectedTaskIds: uniqueSorted(affectedTaskSet),
    boundaryTaskIds: uniqueSorted(boundaryTaskSet),
  };
}
