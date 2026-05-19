import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ProjectItem, Repository } from "../../types";
import {
  buildProjectRequirementWorkspaceInput,
  listTrellisRequirementWorkspace,
} from "../../services/trellisTaskBridge";
import { countUnsplitRequirementsInSnapshot } from "../../utils/requirementWorkspaceUnsplit";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";

/** 侧栏：按 Workspace / 仓库统计尚未拆分为任务的 demand 条数。 */
export function useSidebarRequirementUnsplitMap(
  projects: ProjectItem[],
  repositories: Repository[],
) {
  const [projectUnsplitById, setProjectUnsplitById] = useState<Record<string, number>>({});
  const [repositoryUnsplitById, setRepositoryUnsplitById] = useState<Record<number, number>>({});

  const projectKey = useMemo(
    () =>
      projects
        .map((project) => `${project.id}:${project.rootPath ?? ""}:${project.repositoryIds.join(",")}`)
        .join("|"),
    [projects],
  );
  const repositoryKey = useMemo(
    () => repositories.map((repository) => `${repository.id}:${repository.path}`).join("|"),
    [repositories],
  );

  const refresh = useCallback(async () => {
    if (projects.length === 0) {
      setProjectUnsplitById({});
      setRepositoryUnsplitById({});
      return;
    }

    const nextProjectUnsplit: Record<string, number> = {};
    const nextRepositoryUnsplit: Record<number, number> = {};

    await Promise.all(
      projects.map(async (project) => {
        const workspaceInput = buildProjectRequirementWorkspaceInput({
          project,
          projects,
          repositories,
        });
        const hasScope =
          Boolean(workspaceInput.projectRootPath?.trim()) ||
          (workspaceInput.projectRepositoryPaths?.length ?? 0) > 0;
        if (!hasScope) {
          nextProjectUnsplit[project.id] = 0;
          return;
        }

        try {
          const snapshot = await listTrellisRequirementWorkspace({
            ...workspaceInput,
            includeArchived: false,
          });
          nextProjectUnsplit[project.id] = countUnsplitRequirementsInSnapshot(snapshot);
          for (const repositoryId of project.repositoryIds) {
            const count = countUnsplitRequirementsInSnapshot(snapshot, { repositoryId });
            if (count > 0) nextRepositoryUnsplit[repositoryId] = count;
            else if (!(repositoryId in nextRepositoryUnsplit)) nextRepositoryUnsplit[repositoryId] = 0;
          }
        } catch {
          nextProjectUnsplit[project.id] = 0;
        }
      }),
    );

    setProjectUnsplitById(nextProjectUnsplit);
    setRepositoryUnsplitById(nextRepositoryUnsplit);
  }, [projects, repositories]);

  useEffect(() => {
    void refresh();
  }, [refresh, projectKey, repositoryKey]);

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      const attach = async (eventName: string) => {
        const unlisten = await listen(eventName, () => {
          if (!cancelled) void refresh();
        });
        if (cancelled) {
          safeUnlisten(unlisten);
          return;
        }
        cleanups.push(() => safeUnlisten(unlisten));
      };

      await attach("trellis-runtime-event");
      await attach("wise:split-todo-count-updated");
      await attach("wise:repo-worktrees-may-have-changed");
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [refresh]);

  return {
    projectUnsplitById,
    repositoryUnsplitById,
    refresh,
  };
}
