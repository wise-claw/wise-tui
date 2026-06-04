import { useCallback, useEffect, useState } from "react";
import { WISE_WORKSPACE_TODOS_CHANGED } from "../constants/workspaceTodosEvents";
import {
  loadProjectWorkspaceTodos,
  loadRepositoryWorkspaceTodos,
} from "../services/workspaceTodosStore";
import type { ProjectItem, Repository } from "../types";

export interface SidebarWorkspaceTodoCounts {
  byProjectId: Record<string, number>;
  byRepositoryId: Record<number, number>;
  loading: boolean;
}

function countIncomplete(items: { completed: boolean }[]): number {
  let n = 0;
  for (const item of items) {
    if (!item.completed) n += 1;
  }
  return n;
}

export function useSidebarWorkspaceTodoCounts(
  projects: ProjectItem[],
  floatingRepositories: Repository[],
  enabled = true,
): SidebarWorkspaceTodoCounts {
  const [byProjectId, setByProjectId] = useState<Record<string, number>>({});
  const [byRepositoryId, setByRepositoryId] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setByProjectId({});
      setByRepositoryId({});
      setLoading(false);
      return;
    }

    const projectIds = projects.map((p) => p.id).filter((id) => id.trim().length > 0);
    const repositoryIds = new Set<number>();
    for (const project of projects) {
      for (const repositoryId of project.repositoryIds) {
        if (Number.isFinite(repositoryId)) repositoryIds.add(repositoryId);
      }
    }
    for (const repo of floatingRepositories) {
      if (Number.isFinite(repo.id)) repositoryIds.add(repo.id);
    }

    if (projectIds.length === 0 && repositoryIds.size === 0) {
      setByProjectId({});
      setByRepositoryId({});
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [projectResults, repositoryResults] = await Promise.all([
        Promise.all(
          projectIds.map(async (projectId) => {
            const payload = await loadProjectWorkspaceTodos(projectId);
            return [projectId, countIncomplete(payload.items)] as const;
          }),
        ),
        Promise.all(
          [...repositoryIds].map(async (repositoryId) => {
            const payload = await loadRepositoryWorkspaceTodos(repositoryId);
            return [repositoryId, countIncomplete(payload.items)] as const;
          }),
        ),
      ]);

      const nextProjects: Record<string, number> = {};
      for (const [projectId, count] of projectResults) {
        if (count > 0) nextProjects[projectId] = count;
      }
      const nextRepos: Record<number, number> = {};
      for (const [repositoryId, count] of repositoryResults) {
        if (count > 0) nextRepos[repositoryId] = count;
      }
      setByProjectId(nextProjects);
      setByRepositoryId(nextRepos);
    } catch {
      /* 侧栏角标失败时静默，避免打断主流程 */
    } finally {
      setLoading(false);
    }
  }, [enabled, projects, floatingRepositories]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener(WISE_WORKSPACE_TODOS_CHANGED, onChanged);
    return () => window.removeEventListener(WISE_WORKSPACE_TODOS_CHANGED, onChanged);
  }, [enabled, refresh]);

  return { byProjectId, byRepositoryId, loading };
}
