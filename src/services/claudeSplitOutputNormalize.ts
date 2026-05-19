import type {
  PrdDocument,
  SplitResult,
  TaskAnchorDescriptor,
  TaskFlowStatus,
  TaskItem,
  TaskRole,
  TaskSize,
  TaskSplitContext,
} from "../types";
import { defaultTaskRoleForRepositoryType } from "../utils/repositoryType";
import { listPrdRequirementIndexEntries } from "./prdRequirementIndex";
import {
  applySplitMappingToSplitResult,
  extractSplitMappingFromSplitResultRoot,
} from "./splitMappingMerge";
import { normalizeSplitResultAfterTasksMutation } from "./taskSplitter";

interface PlainObject {
  [key: string]: unknown;
}

export interface ClaudeSplitStrictValidationIssue {
  path: string;
  message: string;
}

export interface ClaudeSplitStrictValidationResult {
  ok: boolean;
  issues: ClaudeSplitStrictValidationIssue[];
}

function isRecord(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asString).filter((x): x is string => Boolean(x));
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

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForContainment(value: string): string {
  return collapseWs(value).toLowerCase();
}

function requirementTraceable(anchorText: string, requirementTexts: string[]): boolean {
  const probe = normalizeForContainment(anchorText);
  if (probe.length < 4) return false;
  for (const requirement of requirementTexts) {
    const normalizedReq = normalizeForContainment(requirement);
    if (!normalizedReq) continue;
    if (normalizedReq.includes(probe) || probe.includes(normalizedReq)) return true;
    if (probe.length >= 8) {
      const prefix = probe.slice(0, 24);
      if (prefix.length >= 8 && normalizedReq.includes(prefix)) return true;
    }
  }
  return false;
}

function parseOrdinal(rawId: string | null, fallback: number): number {
  if (!rawId) return fallback;
  const m = /(\d+)$/.exec(rawId);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function estimateSize(subtasks: string[], dod: string[]): TaskSize {
  const score = subtasks.length + dod.length;
  if (score <= 3) return "S";
  if (score <= 7) return "M";
  return "L";
}

function estimateDays(size: TaskSize): number {
  if (size === "S") return 1;
  if (size === "M") return 2;
  return 4;
}

function normalizeRole(raw: unknown, fallback: TaskRole): TaskRole {
  if (raw === "frontend" || raw === "backend" || raw === "document") return raw;
  return fallback;
}

function normalizeExecutionStatus(raw: unknown): "executable" | "not_executable" {
  if (raw === "executable") return "executable";
  if (raw === "not_executable" || raw === "non_executable") return "not_executable";
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

function collectRequirementIdsFromTexts(texts: string[]): string[] {
  const ids = new Set<string>();
  const re = /\breq-(?:functional|nonfunctional|acceptance)-\d+\b/g;
  for (const text of texts) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      ids.add(m[0]);
    }
  }
  return [...ids];
}

function parseTaskAnchorDescriptor(raw: unknown): TaskAnchorDescriptor | undefined {
  // 兼容模型误返回数组：取首个合法锚点对象。
  const candidate = Array.isArray(raw) ? raw.find((item) => isRecord(item)) : raw;
  if (!isRecord(candidate)) return undefined;
  const from = typeof candidate.from === "number" ? Math.floor(candidate.from) : NaN;
  const to = typeof candidate.to === "number" ? Math.floor(candidate.to) : NaN;
  const mdFromRaw = Number(
    candidate.mdFrom
    ?? candidate.md_from
    ?? candidate.oldFrom
    ?? candidate.old_from
    ?? candidate.markdownFrom
    ?? candidate.markdown_from,
  );
  const mdToRaw = Number(
    candidate.mdTo
    ?? candidate.md_to
    ?? candidate.oldTo
    ?? candidate.old_to
    ?? candidate.markdownTo
    ?? candidate.markdown_to,
  );
  const contextBefore = asString(candidate.contextBefore ?? candidate.context_before) ?? "";
  const contextAfter = asString(candidate.contextAfter ?? candidate.context_after) ?? "";
  const textHashRaw = asString(candidate.textHash ?? candidate.text_hash);
  const textHash = textHashRaw ?? `anchor-${from}-${to}-${contextAfter.slice(0, 24)}`;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return undefined;
  if (!textHash.trim()) return undefined;
  const out: TaskAnchorDescriptor = { from, to, textHash, contextBefore, contextAfter };
  if (Number.isFinite(mdFromRaw)) out.mdFrom = Math.floor(mdFromRaw);
  if (Number.isFinite(mdToRaw)) out.mdTo = Math.floor(mdToRaw);
  return out;
}

function parseDependencyRationale(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [taskId, rationale] of Object.entries(raw)) {
    const key = taskId.trim();
    const value = asString(rationale)?.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function remapDependencyRationale(
  raw: Record<string, string>,
  idRemap: Map<string, string>,
  dependencies: string[],
): Record<string, string> | undefined {
  const dependencySet = new Set(dependencies);
  const out: Record<string, string> = {};
  for (const [rawTaskId, rationale] of Object.entries(raw)) {
    const canonical = idRemap.get(rawTaskId) ?? rawTaskId;
    if (!dependencySet.has(canonical)) continue;
    const value = rationale.trim();
    if (!value) continue;
    out[canonical] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function validateClaudeSplitPayloadStrict(input: {
  payload: unknown;
  source: PrdDocument;
}): ClaudeSplitStrictValidationResult {
  const issues: ClaudeSplitStrictValidationIssue[] = [];
  const root = isRecord(input.payload) ? input.payload : null;
  if (!root) {
    return { ok: false, issues: [{ path: "$", message: "输出必须为 JSON 对象" }] };
  }
  const rawTasks = Array.isArray(root.tasks) ? root.tasks : [];
  if (rawTasks.length === 0) {
    issues.push({ path: "$.tasks", message: "tasks 必须为非空数组" });
    return { ok: false, issues };
  }
  const reqEntries = listPrdRequirementIndexEntries(input.source);
  const validReqIds = new Set(reqEntries.map((r) => r.id));
  const reqContentById = new Map(reqEntries.map((r) => [r.id, r.content]));
  rawTasks.forEach((rawTask, i) => {
    const path = `tasks[${i}]`;
    if (!isRecord(rawTask)) {
      issues.push({ path, message: "任务必须是对象" });
      return;
    }
    const taskId = asString(rawTask.id) ?? `task@${i + 1}`;
    const sourceRequirementIds = asStringArray(rawTask.sourceRequirementIds ?? rawTask.source_requirement_ids);
    if (sourceRequirementIds.length === 0) {
      issues.push({
        path: `${path}.sourceRequirementIds`,
        message: `${taskId} 缺少 requirement 映射（至少需要 1 个 requirement id）`,
      });
    } else {
      const invalid = sourceRequirementIds.filter((id) => !validReqIds.has(id));
      if (invalid.length > 0) {
        issues.push({
          path: `${path}.sourceRequirementIds`,
          message: `${taskId} 包含无效 requirement id: ${invalid.join(", ")}`,
        });
      }
    }
    const status = asString(rawTask.executionStatus ?? rawTask.status);
    if (status !== "executable" && status !== "not_executable") {
      issues.push({
        path: `${path}.executionStatus`,
        message: `${taskId} 的 executionStatus 必须是 executable 或 not_executable`,
      });
    }
    const missing = asStringArray(rawTask.missingPrerequisites ?? rawTask.missing_prerequisites);
    if (status === "executable" && missing.length > 0) {
      issues.push({
        path: `${path}.missingPrerequisites`,
        message: `${taskId} 标记 executable 时 missingPrerequisites 必须为空`,
      });
    }
    if (status === "not_executable" && missing.length === 0) {
      issues.push({
        path: `${path}.missingPrerequisites`,
        message: `${taskId} 标记 not_executable 时 missingPrerequisites 不能为空`,
      });
    }
    const subtasks = asStringArray(rawTask.subtasks ?? rawTask.deliverables);
    if (subtasks.length === 0) {
      issues.push({ path: `${path}.subtasks`, message: `${taskId} 的 subtasks/deliverables 至少需要 1 条` });
    }
    const dod = asStringArray(rawTask.dod ?? rawTask.acceptance_criteria);
    if (dod.length === 0) {
      issues.push({ path: `${path}.dod`, message: `${taskId} 的 dod/acceptance_criteria 至少需要 1 条` });
    }
    const anchors = rawTask.taskAnchors ?? rawTask.task_anchors;
    if (!isRecord(anchors)) {
      issues.push({ path: `${path}.taskAnchors`, message: `${taskId} 的 taskAnchors 必须是对象` });
    } else {
      const from = Number((anchors as PlainObject).from);
      const to = Number((anchors as PlainObject).to);
      const textHash = asString((anchors as PlainObject).textHash ?? (anchors as PlainObject).text_hash);
      const contextAfter = asString((anchors as PlainObject).contextAfter ?? (anchors as PlainObject).context_after) ?? "";
      const contextBefore = asString((anchors as PlainObject).contextBefore ?? (anchors as PlainObject).context_before) ?? "";
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) {
        issues.push({
          path: `${path}.taskAnchors`,
          message: `${taskId} 的 taskAnchors.from/to 必须是有效区间（from>=0 且 to>from）`,
        });
      }
      if (!textHash) {
        issues.push({
          path: `${path}.taskAnchors.textHash`,
          message: `${taskId} 的 taskAnchors.textHash 必须为非空字符串`,
        });
      }
      const reqTexts = sourceRequirementIds
        .map((id) => reqContentById.get(id) ?? "")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      const hasTraceableContext = requirementTraceable(contextAfter, reqTexts)
        || requirementTraceable(contextBefore, reqTexts);
      if (reqTexts.length > 0 && !hasTraceableContext) {
        issues.push({
          path: `${path}.taskAnchors`,
          message: `${taskId} 的 taskAnchors.contextBefore/contextAfter 无法追溯到 sourceRequirementIds 对应原文`,
        });
      }
    }
    const classification = asString(rawTask.classification);
    if (classification != null && classification !== "lightweight" && classification !== "complex") {
      issues.push({
        path: `${path}.classification`,
        message: `${taskId} 的 classification 必须是 lightweight 或 complex（收到 ${classification}）`,
      });
    }
    if (classification === "complex") {
      const designMarkdown = (asString(rawTask.designMarkdown ?? rawTask.design_markdown) ?? "").trim();
      const implementMarkdown = (asString(rawTask.implementMarkdown ?? rawTask.implement_markdown) ?? "").trim();
      if (designMarkdown.length === 0) {
        issues.push({
          path: `${path}.designMarkdown`,
          message: `${taskId} classification=complex 时 designMarkdown 不能为空`,
        });
      }
      if (implementMarkdown.length === 0) {
        issues.push({
          path: `${path}.implementMarkdown`,
          message: `${taskId} classification=complex 时 implementMarkdown 不能为空`,
        });
      }
    }
  });
  return { ok: issues.length === 0, issues };
}

type RawTaskWithMeta = TaskItem & {
  ordinal: number;
  rawDeps: string[];
  rawDependencyRationale: Record<string, string>;
  rawAnchorDescriptor?: TaskAnchorDescriptor;
};

function normalizeRawTask(
  rawTask: unknown,
  index: number,
  fallbackRole: TaskRole,
  validReqIds: Set<string>,
): RawTaskWithMeta | null {
  if (!isRecord(rawTask)) return null;
  const rawId = asString(rawTask.id);
  const ordinal = typeof rawTask.ordinal === "number" && rawTask.ordinal > 0
    ? Math.floor(rawTask.ordinal)
    : parseOrdinal(rawId, index + 1);
  const id = rawId ?? `task-${ordinal}`;
  const title = asString(rawTask.title) ?? `任务 ${ordinal}`;
  const description = sanitizeLegacyGeneratedDescription(
    asString(rawTask.description) ?? asString(rawTask.scope) ?? "（未提供详细描述）",
  );
  const role = normalizeRole(rawTask.role ?? rawTask.repo_type, fallbackRole);
  const rawDeps = asStringArray(rawTask.dependencies ?? rawTask.depends_on);
  const rawDependencyRationale = parseDependencyRationale(rawTask.dependencyRationale ?? rawTask.dependency_rationale);
  const subtasks = asStringArray(rawTask.subtasks ?? rawTask.deliverables);
  const dod = asStringArray(rawTask.dod ?? rawTask.acceptance_criteria);
  const sourceRefs = asStringArray(rawTask.sourceRefs);
  const missingPrerequisites = asStringArray(rawTask.missingPrerequisites ?? rawTask.missing_prerequisites);
  const explicitReqIds = asStringArray(
    rawTask.sourceRequirementIds ?? rawTask.source_requirement_ids,
  );
  const inferredReqIds = collectRequirementIdsFromTexts([
    title,
    description,
    ...subtasks,
    ...dod,
    ...missingPrerequisites,
    ...sourceRefs,
  ]);
  const sourceRequirementIds = [...new Set([...explicitReqIds, ...inferredReqIds])].filter((id0) => validReqIds.has(id0));
  const size = estimateSize(subtasks, dod);
  const rawAnchorDescriptor = parseTaskAnchorDescriptor(rawTask.taskAnchors ?? rawTask.task_anchors);
  const classificationRaw = asString(rawTask.classification);
  const classification: "lightweight" | "complex" =
    classificationRaw === "complex" ? "complex" : "lightweight";
  const designMarkdown = asString(rawTask.designMarkdown ?? rawTask.design_markdown) ?? "";
  const implementMarkdown = asString(rawTask.implementMarkdown ?? rawTask.implement_markdown) ?? "";

  return {
    id,
    title,
    description,
    role,
    size,
    estimateDays: estimateDays(size),
    dependencies: [],
    sourceRefs,
    sourceRequirementIds,
    subtasks,
    dod,
    executionStatus: normalizeExecutionStatus(rawTask.executionStatus ?? rawTask.status),
    executionStatusManual: false,
    flowStatus: normalizeFlowStatus(rawTask.flowStatus ?? rawTask.taskStatus),
    classification,
    designMarkdown: designMarkdown.trim().length > 0 ? designMarkdown : undefined,
    implementMarkdown: implementMarkdown.trim().length > 0 ? implementMarkdown : undefined,
    ordinal,
    rawDeps,
    rawDependencyRationale,
    rawAnchorDescriptor,
  };
}

/**
 * 归一 Claude 拆分输出到 `SplitResult`（spec §6 D2）：
 * - 补默认字段
 * - 按 ordinal 排序
 * - 去重并过滤非法 sourceRequirementIds
 * - 裁剪非法 dependencies 引用
 */
export function normalizeClaudeSplitOutputToSplitResult(input: {
  payload: unknown;
  source: PrdDocument;
  context: TaskSplitContext | null;
}): SplitResult {
  const validReqIds = new Set(listPrdRequirementIndexEntries(input.source).map((r) => r.id));
  const fallbackRole: TaskRole = defaultTaskRoleForRepositoryType(input.context?.repositoryType);
  const root = isRecord(input.payload) ? input.payload : {};
  const rawTasks = Array.isArray(root.tasks) ? root.tasks : [];

  const prepared = rawTasks
    .map((task, i) => normalizeRawTask(task, i, fallbackRole, validReqIds))
    .filter((t): t is RawTaskWithMeta => t !== null)
    .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));

  const rawIdFrequency = new Map<string, number>();
  for (const task of prepared) {
    rawIdFrequency.set(task.id, (rawIdFrequency.get(task.id) ?? 0) + 1);
  }
  const idRemap = new Map<string, string>();
  const used = new Set<string>();
  prepared.forEach((task, i) => {
    const rawId = task.id;
    const canonical = `task-${i + 1}`;
    // 重复 raw taskId 无法无歧义重映射：仅对唯一 id 建 remap，避免把映射错误集中到最后一条任务。
    if ((rawIdFrequency.get(rawId) ?? 0) === 1) {
      idRemap.set(rawId, canonical);
    }
    task.id = canonical;
    used.add(canonical);
  });
  const remapTaskAnchorDescriptors = (
    input0: Record<string, TaskAnchorDescriptor>,
  ): Record<string, TaskAnchorDescriptor> | undefined => {
    const out: Record<string, TaskAnchorDescriptor> = {};
    for (const [rawTaskId, descriptor] of Object.entries(input0)) {
      const canonicalTaskId = idRemap.get(rawTaskId) ?? rawTaskId;
      out[canonicalTaskId] = descriptor;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const taskAnchorByRawId: Record<string, TaskAnchorDescriptor> = {};
  for (const task of prepared) {
    if (!task.rawAnchorDescriptor) continue;
    taskAnchorByRawId[task.id] = task.rawAnchorDescriptor;
  }
  const anchorDescriptors = remapTaskAnchorDescriptors(taskAnchorByRawId);

  const tasks: TaskItem[] = prepared.map((task) => {
    const dependencies = [...new Set(task.rawDeps.map((d) => idRemap.get(d) ?? d))]
      .filter((dep) => dep !== task.id && used.has(dep));
    const dependencyRationale = remapDependencyRationale(task.rawDependencyRationale, idRemap, dependencies);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      role: task.role,
      size: task.size,
      estimateDays: task.estimateDays,
      dependencies,
      dependencyRationale,
      sourceRefs: [...new Set(task.sourceRefs)],
      sourceRequirementIds: [...new Set(task.sourceRequirementIds)],
      subtasks: [...new Set(task.subtasks)],
      dod: [...new Set(task.dod)],
      taskAnchors: task.rawAnchorDescriptor,
      executionStatus: "not_executable",
      executionStatusManual: false,
      flowStatus: normalizeFlowStatus((task as { flowStatus?: unknown }).flowStatus),
      classification: task.classification,
      designMarkdown: task.designMarkdown,
      implementMarkdown: task.implementMarkdown,
    };
  });

  let merged = normalizeSplitResultAfterTasksMutation({
    source: input.source,
    context: input.context,
    splitTasks: tasks,
    executableTasks: [],
    taskAnchorDescriptors: anchorDescriptors,
    taskAnchorTexts: anchorDescriptors
      ? Object.fromEntries(
        Object.entries(anchorDescriptors)
          .map(([taskId, descriptor]) => [taskId, descriptor.contextAfter.trim()])
          .filter(([, text]) => text.length > 0),
      )
      : undefined,
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
  });

  const canonicalizationRemap = [...idRemap.entries()].map(([from, to]) => ({ from, to }));
  const embeddedMapping = extractSplitMappingFromSplitResultRoot(input.payload);
  const meta = { capturedAtMs: Date.now() };
  if (embeddedMapping) {
    const combined: typeof embeddedMapping = {
      ...embeddedMapping,
      idRemap: [...canonicalizationRemap, ...(embeddedMapping.idRemap ?? [])],
    };
    merged = applySplitMappingToSplitResult(merged, combined, meta).result;
  }

  const reqEntries = listPrdRequirementIndexEntries(input.source);
  const allTasksLackReq = merged.splitTasks.every((t) => (t.sourceRequirementIds?.length ?? 0) === 0);
  if (allTasksLackReq && reqEntries.length > 0 && merged.splitTasks.length > 0) {
    const fallbackTasks = merged.splitTasks.map((t, i) => {
      const e = reqEntries[i];
      if (!e) return t;
      return { ...t, sourceRequirementIds: [e.id] };
    });
    merged = normalizeSplitResultAfterTasksMutation({
      ...merged,
      splitTasks: fallbackTasks,
    });
    if (!merged.claudeSplitMapping) {
      merged = {
        ...merged,
        claudeSplitMapping: {
          version: 1,
          taskRequirementLinks: fallbackTasks.map((t) => ({
            taskId: t.id,
            requirementIds: t.sourceRequirementIds,
            rationale: "本地自动映射：按当前 PRD 需求顺序生成 task-requirement 关联",
          })),
          capturedAtMs: Date.now(),
        },
      };
    }
  }

  return merged;
}
