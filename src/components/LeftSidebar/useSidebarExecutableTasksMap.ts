import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ProjectItem, Repository } from "../../types";
import { countGlobalSplitTodoExecutableTasks } from "../../services/prdTaskSplitStore";
import {
  buildProjectRequirementWorkspaceInput,
  listTrellisRequirementWorkspace,
} from "../../services/trellisTaskBridge";
import { countExecutableTrellisTasksInSnapshot } from "../../utils/taskDrawerCounts";
import { selectFloatingRepositories } from "../../utils/floatingRepositories";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";

/** 侧栏：按 Workspace / 仓库统计可执行任务（规则与主会话「任务」抽屉一致）。 */
export function useSidebarExecutableTasksMap(
  projects: ProjectItem[],
  repositories: Repository[],
  activeProjectId: string | null,
) {
  const [projectExecutableById, setProjectExecutableById] = useState<Record<string, number>>({});
  const [repositoryExecutableById, setRepositoryExecutableById] = useState<Record<number, number>>({});

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
    const nextProjectExecutable: Record<string, number> = {};
    const nextRepositoryExecutable: Record<number, number> = {};
    const globalSplitTodoCount = await countGlobalSplitTodoExecutableTasks().catch(() => 0);

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
          nextProjectExecutable[project.id] = 0;
          return;
        }

        try {
          const snapshot = await listTrellisRequirementWorkspace({
            ...workspaceInput,
            includeArchived: false,
          });
          const trellisCount = countExecutableTrellisTasksInSnapshot(snapshot);
          const splitTodoCount = project.id === activeProjectId ? globalSplitTodoCount : 0;
          nextProjectExecutable[project.id] = trellisCount + splitTodoCount;

          for (const repositoryId of project.repositoryIds) {
            const count = countExecutableTrellisTasksInSnapshot(snapshot, { repositoryId });
            if (count > 0) nextRepositoryExecutable[repositoryId] = count;
            else if (!(repositoryId in nextRepositoryExecutable)) nextRepositoryExecutable[repositoryId] = 0;
          }
        } catch {
          nextProjectExecutable[project.id] = 0;
        }
      }),
    );

    const floatingRepositories = selectFloatingRepositories(projects, repositories);
    await Promise.all(
      floatingRepositories.map(async (repository) => {
        const path = repository.path?.trim();
        if (!path) {
          nextRepositoryExecutable[repository.id] = 0;
          return;
        }
        try {
          const snapshot = await listTrellisRequirementWorkspace({
            floatingRepositoryPaths: [path],
            includeArchived: false,
          });
          nextRepositoryExecutable[repository.id] = countExecutableTrellisTasksInSnapshot(snapshot, {
            repositoryId: repository.id,
          });
        } catch {
          nextRepositoryExecutable[repository.id] = 0;
        }
      }),
    );

    setProjectExecutableById(nextProjectExecutable);
    setRepositoryExecutableById(nextRepositoryExecutable);
  }, [activeProjectId, projects, repositories]);

  useEffect(() => {
    void refresh();
  }, [refresh, projectKey, repositoryKey, activeProjectId]);

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
    projectExecutableById,
    repositoryExecutableById,
    refresh,
  };
}
