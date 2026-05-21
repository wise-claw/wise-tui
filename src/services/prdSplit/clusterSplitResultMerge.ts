import type { PrdDocument, SplitResult, TaskSplitContext } from "../../types";
import { remapSplitResultAnchorOffsetsFromMarkdown } from "../markdownAnchorOffsets";
import {
  refreshSplitResultDerivedFields,
  syncTaskAnchorTextsFromRequirements,
} from "../taskSplitter";

export interface ClusterSplitResultInput {
  clusterId: string;
  result: SplitResult;
}

export function mergeClusterSplitResults(
  prd: PrdDocument,
  context: TaskSplitContext | null,
  clusterResults: readonly ClusterSplitResultInput[],
  prdMarkdown: string,
): SplitResult {
  const shouldNamespace = clusterResults.length > 1;
  const normalizedResults = clusterResults.map(({ clusterId, result }) => (
    shouldNamespace ? namespaceClusterSplitResult(clusterId, result) : result
  ));
  const tasks = normalizedResults.flatMap((result) => result.splitTasks);
  const anchorDescriptors = Object.assign(
    {},
    ...normalizedResults.map((result) => result.taskAnchorDescriptors ?? {}),
  ) as SplitResult["taskAnchorDescriptors"];
  const anchorTexts = Object.assign(
    {},
    ...normalizedResults.map((result) => result.taskAnchorTexts ?? {}),
  ) as SplitResult["taskAnchorTexts"];
  const claudeLinks = normalizedResults.flatMap((result) => result.claudeSplitMapping?.taskRequirementLinks ?? []);
  const merged = refreshSplitResultDerivedFields({
    source: prd,
    context,
    splitTasks: tasks,
    executableTasks: [],
    taskAnchorDescriptors: anchorDescriptors && Object.keys(anchorDescriptors).length > 0
      ? anchorDescriptors
      : undefined,
    taskAnchorTexts: anchorTexts && Object.keys(anchorTexts).length > 0 ? anchorTexts : undefined,
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
    claudeSplitMapping: claudeLinks.length > 0
      ? {
        version: 1,
        taskRequirementLinks: claudeLinks,
        capturedAtMs: Date.now(),
      }
      : undefined,
  });
  return syncTaskAnchorTextsFromRequirements(
    remapSplitResultAnchorOffsetsFromMarkdown(prdMarkdown, merged),
  );
}

export function namespaceClusterSplitResult(clusterId: string, result: SplitResult): SplitResult {
  const idMap = new Map(result.splitTasks.map((task) => [task.id, namespaceTaskId(clusterId, task.id)]));
  const remapTaskId = (taskId: string): string => idMap.get(taskId) ?? taskId;
  const remapRecord = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!record) return undefined;
    const out: Record<string, T> = {};
    for (const [taskId, value] of Object.entries(record)) {
      out[remapTaskId(taskId)] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    ...result,
    splitTasks: result.splitTasks.map((task) => ({
      ...task,
      id: remapTaskId(task.id),
      dependencies: task.dependencies.map(remapTaskId),
    })),
    taskAnchorDescriptors: remapRecord(result.taskAnchorDescriptors),
    taskAnchorTexts: remapRecord(result.taskAnchorTexts),
    taskAnchorPositions: remapRecord(result.taskAnchorPositions),
    claudeSplitMapping: result.claudeSplitMapping
      ? {
        ...result.claudeSplitMapping,
        taskRequirementLinks: result.claudeSplitMapping.taskRequirementLinks.map((link) => ({
          ...link,
          taskId: remapTaskId(link.taskId),
        })),
        idRemap: [
          ...(result.claudeSplitMapping.idRemap ?? []),
          ...Array.from(idMap.entries()).map(([from, to]) => ({ from, to })),
        ],
      }
      : undefined,
  };
}

function namespaceTaskId(clusterId: string, taskId: string): string {
  return `${clusterId}-${taskId}`;
}
