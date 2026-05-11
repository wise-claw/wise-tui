import type { PrdSplitMappingPayload, PrdStoredClaudeSplitMapping, PrdTaskRequirementLink, SplitResult, TaskItem } from "../types";
import { listPrdRequirementIndexEntries } from "./prdRequirementIndex";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLinks(raw: unknown): PrdTaskRequirementLink[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PrdTaskRequirementLink[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const taskId = item.taskId;
    const requirementIds = item.requirementIds;
    if (typeof taskId !== "string" || !taskId.trim()) return null;
    if (!Array.isArray(requirementIds) || requirementIds.some((id) => typeof id !== "string")) return null;
    const rationale = item.rationale;
    out.push({
      taskId: taskId.trim(),
      requirementIds: requirementIds.map((id) => String(id).trim()).filter(Boolean),
      rationale: typeof rationale === "string" && rationale.trim() ? rationale.trim() : undefined,
    });
  }
  return out;
}

function parseIdRemap(raw: unknown): { from: string; to: string }[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out: { from: string; to: string }[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return undefined;
    const from = item.from;
    const to = item.to;
    if (typeof from !== "string" || typeof to !== "string" || !from.trim() || !to.trim()) return undefined;
    out.push({ from: from.trim(), to: to.trim() });
  }
  return out;
}

/** 解析 Claude 写入的或从输出中截取的 `split-mapping.json` 正文。 */
export function parseSplitMappingJson(raw: string): PrdSplitMappingPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const version = parsed.version;
  if (version !== 1) return null;
  const links = parseLinks(parsed.taskRequirementLinks);
  if (!links) return null;
  const idRemap = parseIdRemap(parsed.idRemap);
  return { version: 1, taskRequirementLinks: links, idRemap };
}

/**
 * 从拆分主 JSON 根级读取 `taskRequirementLinks`（及可选 `idRemap`），
 * 用于与 `split-result.raw.json` 同文件携带的映射（不要求单独 version 文件头）。
 */
export function extractSplitMappingFromSplitResultRoot(payload: unknown): PrdSplitMappingPayload | null {
  if (!isRecord(payload)) return null;
  const rawLinks = payload.taskRequirementLinks ?? payload.task_requirement_links;
  const links = parseLinks(rawLinks);
  if (!links || links.length === 0) return null;
  const ver = payload.version;
  if (ver !== undefined && ver !== 1) return null;
  const idRemap = parseIdRemap(payload.idRemap ?? payload.id_remap);
  return { version: 1, taskRequirementLinks: links, idRemap };
}

/** 依次合并多条映射（如 sidecar 文件 + stdout 代码块）；后者覆盖前者冲突字段由 apply 内部规则处理。 */
export function mergeSplitMappingPayloadsIntoSplitResult(
  result: SplitResult,
  payloads: PrdSplitMappingPayload[],
  meta: { capturedAtMs: number; runId?: string },
): SplitResult {
  let out = result;
  for (const p of payloads) {
    const hasLinks = p.taskRequirementLinks.length > 0;
    const hasRemap = (p.idRemap?.length ?? 0) > 0;
    if (!hasLinks && !hasRemap) continue;
    out = applySplitMappingToSplitResult(out, p, meta).result;
  }
  return out;
}

/** 从会话输出中提取 ```json ...``` 块（取第一个合法 mapping）。 */
export function extractSplitMappingFromClaudeOutput(text: string): PrdSplitMappingPayload | null {
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]?.trim();
    if (!inner) continue;
    const parsed = parseSplitMappingJson(inner);
    if (parsed) return parsed;
  }
  return null;
}

function applyIdRemapToTaskId(id: string, remap: Map<string, string>): string {
  return remap.get(id) ?? id;
}

function remapTaskList(tasks: TaskItem[], remap: Map<string, string>): TaskItem[] {
  if (remap.size === 0) return tasks;
  return tasks.map((task) => ({
    ...task,
    id: applyIdRemapToTaskId(task.id, remap),
    dependencies: task.dependencies.map((d) => applyIdRemapToTaskId(d, remap)),
  }));
}

function remapIdArrays(ids: string[][], remap: Map<string, string>): string[][] {
  if (remap.size === 0) return ids;
  return ids.map((group) => group.map((id) => applyIdRemapToTaskId(id, remap)));
}

/** 折叠 idRemap 链（a→b、b→c 得到 a→c），供映射校验与合并共用。 */
export function buildIdRemapMap(entries: { from: string; to: string }[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const { from, to } of entries ?? []) {
    map.set(from, to);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of [...map.entries()]) {
      const next = map.get(to);
      if (next && next !== to) {
        map.set(from, next);
        changed = true;
      }
    }
  }
  return map;
}

export interface ApplySplitMappingResult {
  result: SplitResult;
  warnings: string[];
  appliedLinkCount: number;
}

interface SplitMappingDeltaPlan {
  affectedTaskIds: string[];
  boundaryTaskIds: string[];
}

/**
 * 将 Claude 产出的映射合并进 `SplitResult`：先应用 idRemap，再按 link 覆盖对应任务的 `sourceRequirementIds`。
 */
export function applySplitMappingToSplitResult(
  result: SplitResult,
  mapping: PrdSplitMappingPayload,
  meta: { capturedAtMs: number; runId?: string },
  options?: {
    deltaPlan?: SplitMappingDeltaPlan;
    mode?: "full" | "delta";
  },
): ApplySplitMappingResult {
  const warnings: string[] = [];
  const validReq = new Set(listPrdRequirementIndexEntries(result.source).map((e) => e.id));
  const mode = options?.mode ?? "full";
  const deltaPlan = options?.deltaPlan;
  const impactedTaskIds =
    mode === "delta" && deltaPlan ? new Set(deltaPlan.affectedTaskIds) : null;
  const boundaryTaskIds =
    mode === "delta" && deltaPlan ? new Set(deltaPlan.boundaryTaskIds) : null;

  const remap = buildIdRemapMap(mapping.idRemap);
  if (boundaryTaskIds && remap.size > 0) {
    for (const [from, to] of remap.entries()) {
      if (boundaryTaskIds.has(from) || boundaryTaskIds.has(to)) {
        warnings.push(`idRemap 触及 boundary 任务：${from} -> ${to}`);
      }
    }
  }
  let splitTasks = remapTaskList(result.splitTasks, remap);
  const executableTasks = result.executableTasks.map((task) => ({
    ...task,
    splitSourceTaskId: task.splitSourceTaskId ? applyIdRemapToTaskId(task.splitSourceTaskId, remap) : undefined,
  }));
  let criticalPath = result.criticalPath.map((id) => applyIdRemapToTaskId(id, remap));
  let parallelGroups = remapIdArrays(result.parallelGroups, remap);

  const linkedByTask = new Map<string, PrdTaskRequirementLink[]>();
  for (const link of mapping.taskRequirementLinks) {
    const tid = applyIdRemapToTaskId(link.taskId, remap);
    const list = linkedByTask.get(tid) ?? [];
    list.push({ ...link, taskId: tid });
    linkedByTask.set(tid, list);
  }

  const taskIdsSet = new Set(splitTasks.map((t) => t.id));
  for (const [tid, links] of linkedByTask.entries()) {
    if (!taskIdsSet.has(tid)) {
      warnings.push(`映射中引用了不存在的 taskId：${tid}（已忽略 ${links.length} 条 link）`);
    }
  }

  let appliedLinkCount = 0;
  const mergedTasks = splitTasks.map((task) => {
    const linksForTask = linkedByTask.get(task.id);
    if (!linksForTask?.length) return task;
    if (impactedTaskIds && !impactedTaskIds.has(task.id)) {
      warnings.push(`delta 模式忽略非 impacted 任务映射：${task.id}`);
      return task;
    }
    if (boundaryTaskIds && boundaryTaskIds.has(task.id)) {
      warnings.push(`映射触及 boundary 任务：${task.id}`);
    }

    const reqSet = new Set<string>();
    for (const link of linksForTask) {
      for (const rid of link.requirementIds) {
        if (validReq.has(rid)) reqSet.add(rid);
        else warnings.push(`忽略未知需求 id：${rid}（任务 ${task.id}）`);
      }
    }
    appliedLinkCount += linksForTask.length;
    if (reqSet.size === 0) {
      warnings.push(`任务 ${task.id} 的映射未包含任何有效需求 id，保留原 sourceRequirementIds`);
      return task;
    }
    return { ...task, sourceRequirementIds: Array.from(reqSet) };
  });

  const claudeSplitMapping: PrdStoredClaudeSplitMapping = {
    ...mapping,
    capturedAtMs: meta.capturedAtMs,
    runId: meta.runId,
  };

  return {
    result: {
      ...result,
      splitTasks: mergedTasks,
      executableTasks,
      criticalPath,
      parallelGroups,
      claudeSplitMapping,
    },
    warnings,
    appliedLinkCount,
  };
}
