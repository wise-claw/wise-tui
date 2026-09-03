import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED } from "../../constants/workflowUiEvents";
import type { Repository } from "../../types";
import { runWhenIdle } from "../../utils/deferIdle";
import { startAdaptiveInterval } from "../../utils/adaptivePoll";
import { readRepositoryScheduledClaudeTasks } from "../../services/repositoryScheduledClaudeTasksStore";
import { mapWithConcurrency } from "../../utils/mapWithConcurrency";

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

function scheduledSummaryRecordEqual(
  left: Record<number, SidebarScheduledTasksSummary>,
  right: Record<number, SidebarScheduledTasksSummary>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    const id = Number(key);
    const a = left[id];
    const b = right[id];
    if (!a || !b || a.total !== b.total || a.enabled !== b.enabled) return false;
  }
  return true;
}

/** 侧栏：按仓库 id 汇总定时任务数量（启用数用于角标）。 */
export function useSidebarScheduledTasksMap(
  repositories: Pick<Repository, "id" | "path">[],
) {
  const [byId, setById] = useState<Record<number, SidebarScheduledTasksSummary>>({});
  const repositoriesRef = useRef(repositories);
  const refreshSequenceRef = useRef(0);
  repositoriesRef.current = repositories;

  const repoKey = useMemo(
    () =>
      repositories
        .filter((repo) => Number.isFinite(repo.id) && repo.path.trim())
        .map((repo) => `${repo.id}:${repo.path.trim()}`)
        .join("|"),
    [repositories],
  );

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    const repoEntries = repositoriesRef.current
      .filter((repo) => Number.isFinite(repo.id) && repo.path.trim())
      .map((repo) => ({ id: repo.id, path: repo.path.trim() }));

    if (repoEntries.length === 0) {
      if (sequence === refreshSequenceRef.current) {
        setById((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      }
      return;
    }

    const entries = await mapWithConcurrency(
      repoEntries,
      6,
      async ({ id, path }) => {
        try {
          const tasks = await readRepositoryScheduledClaudeTasks(path);
          const enabled = tasks.filter((task) => task.enabled).length;
          return [id, { total: tasks.length, enabled }] as const;
        } catch {
          return [id, { total: 0, enabled: 0 }] as const;
        }
      },
    );
    if (sequence !== refreshSequenceRef.current) return;
    const next = Object.fromEntries(entries) as Record<number, SidebarScheduledTasksSummary>;
    setById((prev) => (scheduledSummaryRecordEqual(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => {
      void refresh();
    }, { timeoutMs: 2000 });
    return cancelIdle;
  }, [repoKey, refresh]);

  useEffect(() => {
    return startAdaptiveInterval(refresh, 45_000, 120_000);
  }, [refresh]);

  useEffect(() => {
    const onChanged = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refresh();
    };
    window.addEventListener(WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED, onChanged);
    return () => window.removeEventListener(WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED, onChanged);
  }, [refresh]);

  return { byId, refresh };
}
