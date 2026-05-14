import type { PrdDocument, SplitResult } from "../../types";
import { listPrdRequirementIndexEntries } from "../../services/prdRequirementIndex";
import { includesLoosely } from "./helpers";
import type { SplitQualitySummary } from "./types";

export interface TaskAnchorFormatInspection {
  issueCount: number;
  arrayAnchorTaskIds: string[];
  emptyHashTaskIds: string[];
}

export function summarizeSplitQuality(doc: PrdDocument, normalized: SplitResult): SplitQualitySummary {
  const totalTasks = normalized.splitTasks.length;
  const mappedTaskCount = normalized.splitTasks.filter((task) => (task.sourceRequirementIds?.length ?? 0) > 0).length;
  const traceability = inspectAnchorTraceability(doc, normalized);
  return {
    totalTasks,
    mappedTaskCount,
    traceableTaskCount: traceability.traceableTaskCount,
    untraceableTaskIds: traceability.untraceableTaskIds,
  };
}

export function inspectTaskAnchorFormatIssues(payload: unknown): TaskAnchorFormatInspection {
  if (typeof payload !== "object" || payload === null) {
    return { issueCount: 0, arrayAnchorTaskIds: [], emptyHashTaskIds: [] };
  }
  const root = payload as { tasks?: unknown };
  if (!Array.isArray(root.tasks)) {
    return { issueCount: 0, arrayAnchorTaskIds: [], emptyHashTaskIds: [] };
  }
  const arrayAnchorTaskIds: string[] = [];
  const emptyHashTaskIds: string[] = [];
  for (let index = 0; index < root.tasks.length; index += 1) {
    const task = root.tasks[index];
    if (typeof task !== "object" || task === null) continue;
    const typedTask = task as { id?: unknown; taskAnchors?: unknown; task_anchors?: unknown };
    const taskId = typeof typedTask.id === "string" && typedTask.id.trim() ? typedTask.id.trim() : `task@${index + 1}`;
    const anchors = typedTask.taskAnchors ?? typedTask.task_anchors;
    if (Array.isArray(anchors)) {
      arrayAnchorTaskIds.push(taskId);
      const first = anchors.find((item) => typeof item === "object" && item !== null) as
        | { textHash?: unknown; text_hash?: unknown }
        | undefined;
      const hash = typeof first?.textHash === "string"
        ? first.textHash.trim()
        : typeof first?.text_hash === "string"
          ? first.text_hash.trim()
          : "";
      if (!hash) emptyHashTaskIds.push(taskId);
      continue;
    }
    if (typeof anchors !== "object" || anchors === null) {
      emptyHashTaskIds.push(taskId);
      continue;
    }
    const anchorObject = anchors as { textHash?: unknown; text_hash?: unknown };
    const hash = typeof anchorObject.textHash === "string"
      ? anchorObject.textHash.trim()
      : typeof anchorObject.text_hash === "string"
        ? anchorObject.text_hash.trim()
        : "";
    if (!hash) emptyHashTaskIds.push(taskId);
  }
  return {
    issueCount: arrayAnchorTaskIds.length + emptyHashTaskIds.length,
    arrayAnchorTaskIds,
    emptyHashTaskIds,
  };
}

function inspectAnchorTraceability(
  doc: PrdDocument,
  normalized: SplitResult,
): Pick<SplitQualitySummary, "traceableTaskCount" | "untraceableTaskIds"> {
  const reqTextById = new Map(listPrdRequirementIndexEntries(doc).map((entry) => [entry.id, entry.content]));
  let traceableTaskCount = 0;
  const untraceableTaskIds: string[] = [];
  for (const task of normalized.splitTasks) {
    const descriptor = task.taskAnchors ?? normalized.taskAnchorDescriptors?.[task.id];
    const ctxAfter = (descriptor?.contextAfter ?? "").trim();
    const ctxBefore = (descriptor?.contextBefore ?? "").trim();
    const probe = ctxAfter || ctxBefore;
    const reqTexts = (task.sourceRequirementIds ?? [])
      .map((id) => reqTextById.get(id) ?? "")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const ok = probe.length >= 4 && reqTexts.some((reqText) => includesLoosely(probe, reqText));
    if (ok) traceableTaskCount += 1;
    else untraceableTaskIds.push(task.id);
  }
  return { traceableTaskCount, untraceableTaskIds };
}
