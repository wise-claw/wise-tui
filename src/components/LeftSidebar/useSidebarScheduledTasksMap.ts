import { useCallback, useEffect, useMemo, useState } from "react";
import { WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED } from "../../constants/workflowUiEvents";
import type { Repository } from "../../types";
import { readRepositoryScheduledClaudeTasks } from "../../services/repositoryScheduledClaudeTasksStore";

export interface SidebarScheduledTasksSummary {
  total: number;
  enabled: number;
}

export function sumProjectScheduledTasksEnabled(
  repositoryIds: readonly number[],
  byRepoId: Record<number, SidebarScheduledTasksSummary>,
): number {
  return repositoryIds.reduce((sum, id) => sum + (byRepoId[id]?.enabled ?? 0), 0);
}

export function sumProjectScheduledTasksTotal(
  repositoryIds: readonly number[],
  byRepoId: Record<number, SidebarScheduledTasksSummary>,
): number {
  return repositoryIds.reduce((sum, id) => sum + (byRepoId[id]?.total ?? 0), 0);
}

/** 侧栏：按仓库 id 汇总定时任务数量（启用数用于角标）。 */
export function useSidebarScheduledTasksMap(
  repositories: Pick<Repository, "id" | "path">[],
) {
  const [byId, setById] = useState<Record<number, SidebarScheduledTasksSummary>>({});

  const repoEntries = useMemo(
    () =>
      repositories
        .filter((repo) => Number.isFinite(repo.id) && repo.path.trim())
        .map((repo) => ({ id: repo.id, path: repo.path.trim() })),
    [repositories],
  );
  const repoKey = repoEntries.map((entry) => `${entry.id}:${entry.path}`).join("|");

  const refresh = useCallback(async () => {
    if (repoEntries.length === 0) {
      setById({});
      return;
    }
    const entries = await Promise.all(
      repoEntries.map(async ({ id, path }) => {
        try {
          const tasks = await readRepositoryScheduledClaudeTasks(path);
          const enabled = tasks.filter((task) => task.enabled).length;
          return [id, { total: tasks.length, enabled }] as const;
        } catch {
          return [id, { total: 0, enabled: 0 }] as const;
        }
      }),
    );
    setById(Object.fromEntries(entries));
  }, [repoEntries]);

  useEffect(() => {
    void refresh();
  }, [refresh, repoKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener(WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED, onChanged);
    return () => window.removeEventListener(WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED, onChanged);
  }, [refresh]);

  return { byId, refresh };
}
