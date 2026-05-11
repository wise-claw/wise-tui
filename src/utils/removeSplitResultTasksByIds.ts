import type { SplitResult } from "../types";
import { refreshSplitResultDerivedFields } from "../services/taskSplitter";

function omitTaskKeys<T extends Record<string, unknown>>(record: T | undefined, remove: Set<string>): T | undefined {
  if (!record) return undefined;
  const next = { ...record } as Record<string, unknown>;
  for (const id of remove) {
    delete next[id];
  }
  return Object.keys(next).length > 0 ? (next as T) : undefined;
}

/** 从拆分结果中移除指定任务 id，并清理依赖、锚点与需求映射后刷新派生字段。 */
export function removeSplitResultTasksByIds(split: SplitResult, rawIds: readonly string[]): SplitResult {
  const remove = new Set(rawIds.map((id) => id.trim()).filter(Boolean));
  if (remove.size === 0) return split;

  const removedSplitIds = new Set(
    split.splitTasks.filter((t) => remove.has(t.id)).map((t) => t.id),
  );

  const splitTasks = split.splitTasks
    .filter((t) => !remove.has(t.id))
    .map((t) => ({
      ...t,
      dependencies: t.dependencies.filter((dep) => !remove.has(dep)),
    }));

  const executableTasks = split.executableTasks
    .filter((t) => !remove.has(t.id) && !(t.splitSourceTaskId && removedSplitIds.has(t.splitSourceTaskId)))
    .map((t) => ({
      ...t,
      dependencies: t.dependencies.filter((dep) => !remove.has(dep)),
    }));

  const taskAnchorDescriptors = omitTaskKeys(split.taskAnchorDescriptors, remove);
  const taskAnchorTexts = omitTaskKeys(split.taskAnchorTexts, remove);
  const taskAnchorPositions = omitTaskKeys(split.taskAnchorPositions, remove);

  const claudeSplitMapping = split.claudeSplitMapping
    ? {
        ...split.claudeSplitMapping,
        taskRequirementLinks: split.claudeSplitMapping.taskRequirementLinks.filter((link) => !remove.has(link.taskId)),
      }
    : undefined;

  return refreshSplitResultDerivedFields({
    ...split,
    splitTasks,
    executableTasks,
    taskAnchorDescriptors,
    taskAnchorTexts,
    taskAnchorPositions,
    claudeSplitMapping,
  });
}
