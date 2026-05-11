import { CronExpressionParser } from "cron-parser";
import type { RepositoryScheduledClaudeTask } from "../types";
import { getAppSettingJson, setAppSettingJson } from "./appSettingsStore";

const STORAGE_PREFIX = "wise.repositoryScheduledClaudeTasks.v1";

export function repositoryScheduledClaudeTasksStorageKey(repositoryPath: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(repositoryPath.trim())}`;
}

function isRepositoryScheduledClaudeTask(x: unknown): x is RepositoryScheduledClaudeTask {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.cronExpression === "string" &&
    typeof o.contentMarkdown === "string" &&
    (o.employeeId === null || typeof o.employeeId === "string") &&
    typeof o.enabled === "boolean" &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number"
  );
}

export async function readRepositoryScheduledClaudeTasks(repositoryPath: string): Promise<RepositoryScheduledClaudeTask[]> {
  const raw = await getAppSettingJson<unknown[]>(repositoryScheduledClaudeTasksStorageKey(repositoryPath));
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRepositoryScheduledClaudeTask);
}

export async function writeRepositoryScheduledClaudeTasks(
  repositoryPath: string,
  tasks: RepositoryScheduledClaudeTask[],
): Promise<void> {
  await setAppSettingJson(repositoryScheduledClaudeTasksStorageKey(repositoryPath), tasks);
}

/** 新建任务时对齐到当前时刻的上一档，避免保存后立即误触发。 */
export function initialLastScheduledSlotForCron(cronExpression: string, nowMs: number): number | undefined {
  const expr = cronExpression.trim();
  if (!expr) return undefined;
  try {
    return CronExpressionParser.parse(expr, { currentDate: new Date(nowMs) }).prev().getTime();
  } catch {
    return undefined;
  }
}

export async function patchRepositoryScheduledClaudeTask(
  repositoryPath: string,
  taskId: string,
  patch: Partial<Omit<RepositoryScheduledClaudeTask, "id" | "createdAt">>,
): Promise<RepositoryScheduledClaudeTask[]> {
  const list = await readRepositoryScheduledClaudeTasks(repositoryPath);
  if (!list.some((t) => t.id === taskId)) {
    return list;
  }
  const now = Date.now();
  const next = list.map((t) =>
    t.id === taskId
      ? {
          ...t,
          ...patch,
          updatedAt: now,
        }
      : t,
  );
  await writeRepositoryScheduledClaudeTasks(repositoryPath, next);
  return next;
}
