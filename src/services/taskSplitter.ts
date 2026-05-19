import type { PrdDocument, SplitResult, TaskFlowStatus, TaskItem, TaskSplitContext, TaskExecutionStatus } from "../types";
import { buildCriticalPath, buildParallelGroups } from "./taskDependency";
import { collectSplitContextGapLines, computeTaskUnmetPoints } from "./taskUnmetPoints";
import { listPrdRequirementIndexEntries } from "./prdRequirementIndex";
import { normalizeSplitResultTaskLists } from "./splitResultModel";

function collectUnmetPreconditions(
  context: TaskSplitContext | null,
  tasks: TaskItem[],
): string[] {
  const issues: string[] = [];
  issues.push(...collectSplitContextGapLines(context, tasks));
  for (const task of tasks) {
    for (const p of computeTaskUnmetPoints(task, context, tasks)) {
      issues.push(`${task.id}：${p}`);
    }
  }
  return Array.from(new Set(issues));
}

function initialExecutionStatusForTask(): TaskExecutionStatus {
  return "not_executable";
}

function normalizeFlowStatus(raw: unknown): TaskFlowStatus {
  if (raw === "todo") return "todo";
  if (raw === "in_progress") return "in_progress";
  if (raw === "blocked") return "blocked";
  if (raw === "pending_review") return "pending_review";
  if (raw === "done") return "done";
  if (raw === "cancelled") return "cancelled";
  return "pending_review";
}

function withInitialExecutionStatuses(_context: TaskSplitContext | null, tasks: TaskItem[]): TaskItem[] {
  return tasks.map((task) => ({
    ...task,
    executionStatus: initialExecutionStatusForTask(),
    executionStatusManual: false,
    flowStatus: normalizeFlowStatus(task.flowStatus),
  }));
}

function isValidTaskAnchorDescriptor(value: unknown): value is NonNullable<TaskItem["taskAnchors"]> {
  if (!value || typeof value !== "object") return false;
  const v = value as NonNullable<TaskItem["taskAnchors"]>;
  const from = Number(v.from);
  const to = Number(v.to);
  const textHash = String(v.textHash ?? "").trim();
  return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from && textHash.length > 0;
}

function sanitizeLegacyGeneratedDescription(raw: string): string {
  const source = raw.replace(/\r\n/g, "\n").trim();
  if (!source) return source;
  const lines = source.split("\n");
  const isTaskHeading = (line: string) => /^#{1,6}\s*task-\d+\b/i.test(line.trim());
  const isTaskContentHeading = (line: string) => /^#{1,6}\s*任务内容\s*$/.test(line.trim());
  const isMetaLine = (line: string) => {
    const t = line.trim();
    return /^[-*]\s*(大小|预估|角色|依赖|前置依赖)\s*[:：]/.test(t);
  };
  let i = 0;
  let changed = false;
  while (i < lines.length && lines[i].trim().length === 0) i += 1;
  if (i < lines.length && isTaskHeading(lines[i])) {
    changed = true;
    i += 1;
  }
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }
    if (isMetaLine(line)) {
      changed = true;
      i += 1;
      continue;
    }
    break;
  }
  if (i < lines.length && isTaskContentHeading(lines[i])) {
    changed = true;
    i += 1;
  }
  while (i < lines.length && lines[i].trim().length === 0) i += 1;
  if (!changed) return source;
  const cleaned = lines.slice(i).join("\n").trim();
  return cleaned || source;
}

function collectTaskAnchorDescriptorsFromTasks(
  tasks: TaskItem[],
): NonNullable<SplitResult["taskAnchorDescriptors"]> | undefined {
  const out: NonNullable<SplitResult["taskAnchorDescriptors"]> = {};
  for (const task of tasks) {
    const taskId = task.id.trim();
    if (!taskId || !isValidTaskAnchorDescriptor(task.taskAnchors)) continue;
    out[taskId] = task.taskAnchors;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function syncTaskAnchorsIntoTasks(
  tasks: TaskItem[],
  taskAnchorDescriptors: SplitResult["taskAnchorDescriptors"],
): TaskItem[] {
  return tasks.map((task) => {
    const anchor = taskAnchorDescriptors?.[task.id];
    if (anchor) return { ...task, taskAnchors: anchor };
    if (!task.taskAnchors) return task;
    const rest = { ...task };
    delete rest.taskAnchors;
    return rest;
  });
}

/** 刷新关键路径、并行组与全局不满足条件列表（任务列表未改 id 时调用）。 */
export function refreshSplitResultDerivedFields(result: SplitResult): SplitResult {
  const mergedTaskAnchors = result.taskAnchorDescriptors ?? collectTaskAnchorDescriptorsFromTasks(result.splitTasks);
  const splitWithAnchors = syncTaskAnchorsIntoTasks(result.splitTasks, mergedTaskAnchors);
  return {
    ...result,
    splitTasks: splitWithAnchors,
    executableTasks: result.executableTasks,
    taskAnchorDescriptors: mergedTaskAnchors,
    criticalPath: buildCriticalPath(splitWithAnchors),
    parallelGroups: buildParallelGroups(splitWithAnchors),
    unmetPreconditions: collectUnmetPreconditions(result.context, splitWithAnchors),
  };
}

/** 在任务列表被外部合并/改写后，按当前缺口重算每条任务的默认可执行性（会清除手动状态）。 */
export function normalizeSplitResultAfterTasksMutation(result: SplitResult): SplitResult {
  const splitTasks = withInitialExecutionStatuses(result.context, result.splitTasks);
  const mergedTaskAnchors = result.taskAnchorDescriptors ?? collectTaskAnchorDescriptorsFromTasks(splitTasks);
  const splitWithAnchors = syncTaskAnchorsIntoTasks(splitTasks, mergedTaskAnchors);
  return {
    ...result,
    splitTasks: splitWithAnchors,
    executableTasks: result.executableTasks,
    taskAnchorDescriptors: mergedTaskAnchors,
    criticalPath: buildCriticalPath(splitWithAnchors),
    parallelGroups: buildParallelGroups(splitWithAnchors),
    unmetPreconditions: collectUnmetPreconditions(result.context, splitWithAnchors),
  };
}

/** 兼容旧持久化数据：无 executionStatus 时补算并刷新派生字段。 */
export function migrateStoredSplitResult(result: SplitResult): SplitResult {
  const lists = normalizeSplitResultTaskLists(result as unknown);
  const base: SplitResult = lists ? { ...result, splitTasks: lists.splitTasks, executableTasks: lists.executableTasks } : result;
  const normalizeAnchorTexts = (input: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!input) return undefined;
    const out: Record<string, string> = {};
    for (const [taskId, text] of Object.entries(input)) {
      const key = taskId.trim();
      const value = text.trim();
      if (!key || !value) continue;
      out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const normalizeAnchorPositions = (
    input: Record<string, { from: number; to: number }> | undefined,
  ): Record<string, { from: number; to: number }> | undefined => {
    if (!input) return undefined;
    const out: Record<string, { from: number; to: number }> = {};
    for (const [taskId, pos] of Object.entries(input)) {
      const key = taskId.trim();
      if (!key) continue;
      const from = Number(pos?.from);
      const to = Number(pos?.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      if (from < 0 || to <= from) continue;
      out[key] = { from: Math.floor(from), to: Math.floor(to) };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const normalizeAnchorDescriptors = (
    input: Record<
      string,
      {
        from: number;
        to: number;
        textHash: string;
        contextBefore: string;
        contextAfter: string;
        mdFrom?: number;
        mdTo?: number;
      }
    > | undefined,
  ):
    | Record<
      string,
      { from: number; to: number; textHash: string; contextBefore: string; contextAfter: string; mdFrom?: number; mdTo?: number }
    >
    | undefined => {
    if (!input) return undefined;
    const out: Record<
      string,
      { from: number; to: number; textHash: string; contextBefore: string; contextAfter: string; mdFrom?: number; mdTo?: number }
    > = {};
    for (const [taskId, d] of Object.entries(input)) {
      const key = taskId.trim();
      if (!key) continue;
      const from = Number(d?.from);
      const to = Number(d?.to);
      const mdFromRaw = Number((d as { mdFrom?: unknown })?.mdFrom);
      const mdToRaw = Number((d as { mdTo?: unknown })?.mdTo);
      const textHash = String(d?.textHash ?? "").trim();
      const contextBefore = String(d?.contextBefore ?? "");
      const contextAfter = String(d?.contextAfter ?? "");
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) continue;
      if (!textHash) continue;
      out[key] = {
        from: Math.floor(from),
        to: Math.floor(to),
        textHash,
        contextBefore,
        contextAfter,
        mdFrom: Number.isFinite(mdFromRaw) ? Math.floor(mdFromRaw) : undefined,
        mdTo: Number.isFinite(mdToRaw) ? Math.floor(mdToRaw) : undefined,
      };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const anchorTexts = normalizeAnchorTexts(base.taskAnchorTexts);
  const anchorPositions = normalizeAnchorPositions(base.taskAnchorPositions);
  const taskLevelAnchorDescriptors = collectTaskAnchorDescriptorsFromTasks(base.splitTasks);
  const normalizedAnchorDescriptors = normalizeAnchorDescriptors(base.taskAnchorDescriptors);
  const anchorDescriptors = {
    ...(taskLevelAnchorDescriptors ?? {}),
    ...(normalizedAnchorDescriptors ?? {}),
  };
  const mergedAnchorDescriptors = Object.keys(anchorDescriptors).length > 0 ? anchorDescriptors : undefined;
  const sanitizedSplit = base.splitTasks.map((task) => ({
    ...task,
    description: sanitizeLegacyGeneratedDescription(task.description ?? ""),
    flowStatus: normalizeFlowStatus(task.flowStatus),
  }));
  const sanitizedExec = base.executableTasks.map((task) => ({
    ...task,
    description: sanitizeLegacyGeneratedDescription(task.description ?? ""),
    flowStatus: normalizeFlowStatus(task.flowStatus),
  }));
  const deduped = dedupeDuplicateStoredTaskIds({
    ...base,
    taskAnchorDescriptors: mergedAnchorDescriptors,
    taskAnchorTexts: anchorTexts,
    taskAnchorPositions: anchorPositions,
    splitTasks: sanitizedSplit,
    executableTasks: sanitizedExec,
  });
  const hasAnyStatus =
    deduped.splitTasks.some((task) => task.executionStatus !== undefined)
    || deduped.executableTasks.some((task) => task.executionStatus !== undefined);
  if (hasAnyStatus) {
    return refreshSplitResultDerivedFields(deduped);
  }
  const splitReinit = withInitialExecutionStatuses(deduped.context, deduped.splitTasks);
  const splitWithAnchors = syncTaskAnchorsIntoTasks(splitReinit, deduped.taskAnchorDescriptors);
  return {
    ...deduped,
    splitTasks: splitWithAnchors,
    executableTasks: deduped.executableTasks,
    criticalPath: buildCriticalPath(splitWithAnchors),
    parallelGroups: buildParallelGroups(splitWithAnchors),
    unmetPreconditions: collectUnmetPreconditions(deduped.context, splitWithAnchors),
  };
}

function dedupeDuplicateStoredTaskIds(result: SplitResult): SplitResult {
  const counts = new Map<string, number>();
  for (const task of result.splitTasks) {
    const id = task.id.trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (![...counts.values()].some((count) => count > 1)) return result;

  const seen = new Map<string, number>();
  const firstIdRemap = new Map<string, string>();
  const splitTasks = result.splitTasks.map((task) => {
    const originalId = task.id.trim();
    if (!originalId || (counts.get(originalId) ?? 0) <= 1) {
      firstIdRemap.set(originalId, originalId);
      return task;
    }
    const occurrence = (seen.get(originalId) ?? 0) + 1;
    seen.set(originalId, occurrence);
    const nextId = occurrence === 1 ? originalId : `${originalId}-${occurrence}`;
    if (!firstIdRemap.has(originalId)) firstIdRemap.set(originalId, nextId);
    return {
      ...task,
      id: nextId,
      dependencies: task.dependencies.map((dep) => firstIdRemap.get(dep) ?? dep),
    };
  });
  const taskIds = new Set(splitTasks.map((task) => task.id));
  const remapRef = (taskId: string): string => firstIdRemap.get(taskId) ?? taskId;
  const remapRecord = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!record) return undefined;
    const out: Record<string, T> = {};
    for (const [taskId, value] of Object.entries(record)) {
      const nextId = remapRef(taskId);
      if (taskIds.has(nextId)) out[nextId] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    ...result,
    splitTasks,
    executableTasks: result.executableTasks.map((task) => ({
      ...task,
      dependencies: task.dependencies.map(remapRef),
      splitSourceTaskId: task.splitSourceTaskId ? remapRef(task.splitSourceTaskId) : task.splitSourceTaskId,
    })),
    taskAnchorDescriptors: remapRecord(result.taskAnchorDescriptors),
    taskAnchorTexts: remapRecord(result.taskAnchorTexts),
    taskAnchorPositions: remapRecord(result.taskAnchorPositions),
    claudeSplitMapping: result.claudeSplitMapping
      ? {
        ...result.claudeSplitMapping,
        taskRequirementLinks: result.claudeSplitMapping.taskRequirementLinks.map((link) => ({
          ...link,
          taskId: remapRef(link.taskId),
        })),
      }
      : undefined,
  };
}

/**
 * 基于当前 `splitTasks[].sourceRequirementIds` 与 `source` 需求正文重建 taskAnchorTexts。
 * 规则：
 * - 每个任务仅使用首个 requirement id 对应的正文作为锚点文本；
 * - 已有锚点文本仅在与当前需求正文一致时保留；
 * - 任务不再关联需求时，移除其历史锚点文本，避免展示陈旧锚点。
 */
export function syncTaskAnchorTextsFromRequirements(result: SplitResult): SplitResult {
  const requirementTextById = new Map(
    listPrdRequirementIndexEntries(result.source).map((entry) => [entry.id, entry.content.trim()]),
  );
  const current = result.taskAnchorTexts ?? {};
  const currentPositions = result.taskAnchorPositions ?? {};
  const currentDescriptors = result.taskAnchorDescriptors ?? {};
  const next: Record<string, string> = {};
  const nextPositions: Record<string, { from: number; to: number }> = {};
  const nextDescriptors: Record<
    string,
    { from: number; to: number; textHash: string; contextBefore: string; contextAfter: string }
  > = {};
  for (const task of result.splitTasks) {
    const taskId = task.id.trim();
    if (!taskId) continue;
    const fallbackRequirementId = task.sourceRequirementIds?.[0];
    if (!fallbackRequirementId) continue;
    const requirementText = (requirementTextById.get(fallbackRequirementId) ?? "").trim();
    if (!requirementText) continue;
    const existing = (current[taskId] ?? "").trim();
    next[taskId] = existing && existing === requirementText ? existing : requirementText;
    const existingPos = currentPositions[taskId];
    if (existingPos && existingPos.to > existingPos.from) {
      nextPositions[taskId] = existingPos;
    }
    const existingDescriptor = currentDescriptors[taskId];
    if (existingDescriptor?.to > existingDescriptor?.from) {
      nextDescriptors[taskId] = existingDescriptor;
    }
  }
  return {
    ...result,
    taskAnchorDescriptors: Object.keys(nextDescriptors).length > 0 ? nextDescriptors : undefined,
    taskAnchorTexts: Object.keys(next).length > 0 ? next : undefined,
    taskAnchorPositions: Object.keys(nextPositions).length > 0 ? nextPositions : undefined,
  };
}

/**
 * 已不再包含内置规则拆分：始终返回空任务列表，仅保留 PRD 与上下文供展示与后续外部引擎写入。
 * 解析 PRD 后若需任务，应由 Claude Code 或其它流程生成并合并进 `SplitResult.splitTasks`。
 */
export function splitPrdToTasks(prd: PrdDocument, context: TaskSplitContext | null = null): SplitResult {
  const splitTasks: TaskItem[] = [];
  const tasksWithStatus = withInitialExecutionStatuses(context, splitTasks);
  const derived = refreshSplitResultDerivedFields({
    source: prd,
    context,
    splitTasks: tasksWithStatus,
    executableTasks: [],
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
  });
  const banner = "内置规则任务拆分已移除：解析后不会自动生成任务列表。";
  return {
    ...derived,
    unmetPreconditions: Array.from(new Set([banner, ...derived.unmetPreconditions])),
  };
}

/**
 * 从拆分结果中移除指定任务，并清理其它任务对它的依赖；重算关键路径、并行组与前置条件汇总。
 * 会修剪 `claudeSplitMapping` 中指向该任务的 link，以及 from/to 涉及该 id 的 `idRemap` 项。
 */
export function removeTaskFromSplitResult(result: SplitResult, taskId: string): SplitResult {
  const trimmed = taskId.trim();
  if (!trimmed) return result;

  const nextSplitTasks = result.splitTasks
    .filter((t) => t.id !== trimmed)
    .map((t) => ({
      ...t,
      dependencies: t.dependencies.filter((d) => d !== trimmed),
    }));
  const nextExecutableTasks = result.executableTasks
    .filter((t) => t.id !== trimmed && t.splitSourceTaskId !== trimmed)
    .map((t) => ({
      ...t,
      dependencies: t.dependencies.filter((d) => d !== trimmed),
    }));

  let next: SplitResult = { ...result, splitTasks: nextSplitTasks, executableTasks: nextExecutableTasks };
  if (next.taskAnchorTexts?.[trimmed]) {
    const rest = { ...next.taskAnchorTexts };
    delete rest[trimmed];
    next.taskAnchorTexts = Object.keys(rest).length > 0 ? rest : undefined;
  }
  if (next.taskAnchorPositions?.[trimmed]) {
    const rest = { ...next.taskAnchorPositions };
    delete rest[trimmed];
    next.taskAnchorPositions = Object.keys(rest).length > 0 ? rest : undefined;
  }
  if (next.taskAnchorDescriptors?.[trimmed]) {
    const rest = { ...next.taskAnchorDescriptors };
    delete rest[trimmed];
    next.taskAnchorDescriptors = Object.keys(rest).length > 0 ? rest : undefined;
  }
  next = refreshSplitResultDerivedFields(next);

  if (next.claudeSplitMapping) {
    const m = next.claudeSplitMapping;
    const links = m.taskRequirementLinks.filter((l) => l.taskId !== trimmed);
    const idRemap = (m.idRemap ?? []).filter((r) => r.from !== trimmed && r.to !== trimmed);
    next = {
      ...next,
      claudeSplitMapping: {
        ...m,
        taskRequirementLinks: links,
        idRemap: idRemap.length > 0 ? idRemap : undefined,
      },
    };
  }

  return next;
}
