import type { SplitResult, TaskItem } from "../types";
import { allSplitResultTaskItems } from "./splitResultModel";

export interface TaskDiffItem {
  taskId: string;
  title: string;
  changes: string[];
}

function mapTasks(result: SplitResult): Map<string, TaskItem> {
  return new Map(allSplitResultTaskItems(result).map((task) => [task.id, task]));
}

function joinList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "无";
}

export function diffSplitResults(base: SplitResult, target: SplitResult): TaskDiffItem[] {
  const baseMap = mapTasks(base);
  const targetMap = mapTasks(target);
  const allIds = Array.from(new Set([...baseMap.keys(), ...targetMap.keys()]));
  const diffs: TaskDiffItem[] = [];

  for (const id of allIds) {
    const left = baseMap.get(id);
    const right = targetMap.get(id);
    if (!left && right) {
      diffs.push({
        taskId: id,
        title: right.title,
        changes: ["新增任务"],
      });
      continue;
    }
    if (left && !right) {
      diffs.push({
        taskId: id,
        title: left.title,
        changes: ["删除任务"],
      });
      continue;
    }
    if (!left || !right) continue;

    const changes: string[] = [];
    if (left.size !== right.size) changes.push(`大小: ${left.size} -> ${right.size}`);
    if (left.estimateDays !== right.estimateDays) {
      changes.push(`工时: ${left.estimateDays} -> ${right.estimateDays}`);
    }
    if (left.title !== right.title) changes.push(`标题: ${left.title} -> ${right.title}`);

    const leftDeps = joinList(left.dependencies);
    const rightDeps = joinList(right.dependencies);
    if (leftDeps !== rightDeps) changes.push(`依赖: ${leftDeps} -> ${rightDeps}`);

    const leftDod = joinList(left.dod);
    const rightDod = joinList(right.dod);
    if (leftDod !== rightDod) changes.push(`DoD: ${leftDod} -> ${rightDod}`);

    if (changes.length > 0) {
      diffs.push({
        taskId: id,
        title: right.title,
        changes,
      });
    }
  }

  return diffs;
}
