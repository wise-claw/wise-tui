/**
 * Trellis 任务 JSON 的 TS 镜像（仅本任务关心的字段）。
 *
 * 兼容旧 task.json：所有新增字段以可选 + null 兜底处理。
 * 不在 `src/types.ts` 内扩展，避免污染主类型表面。
 */

export type TrellisTaskStatus =
  | "planning"
  | "in_progress"
  | "completed"
  | "archived";

export type TrellisTaskPriority = "P0" | "P1" | "P2" | "P3";

export interface TrellisTaskJson {
  id: string;
  name: string;
  title: string;
  description: string;
  status: TrellisTaskStatus;
  priority: TrellisTaskPriority;
  creator: string;
  assignee: string;
  parent: string | null;
  children: string[];
  /** 子任务归属仓库；cross-repo 父任务为 null。 */
  repositoryId?: number | null;
  /** Cluster 标识；父任务持有，子任务冗余指向父 clusterId。 */
  clusterId?: string | null;
  meta?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export function readRepositoryId(task: Pick<TrellisTaskJson, "repositoryId">): number | null {
  return task.repositoryId ?? null;
}

export function readClusterId(task: Pick<TrellisTaskJson, "clusterId">): string | null {
  return task.clusterId ?? null;
}
