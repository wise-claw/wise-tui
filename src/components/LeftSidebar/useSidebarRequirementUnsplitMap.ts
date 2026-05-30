import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ProjectItem, Repository } from "../../types";
import { runWhenIdle } from "../../utils/deferIdle";
import {
  buildProjectRequirementWorkspaceInput,
  listTrellisRequirementWorkspace,
} from "../../services/trellisTaskBridge";
import { countUnsplitRequirementsInSnapshot } from "../../utils/requirementWorkspaceUnsplit";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";

function stringNumberRecordEqual(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function idNumberRecordEqual(
  left: Record<number, number>,
  right: Record<number, number>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (left[Number(key)] !== right[Number(key)]) return false;
  }
  return true;
}

/** 侧栏：按 Workspace / 仓库统计尚未拆分为任务的 demand 条数。 */
export function useSidebarRequirementUnsplitMap(
  projects: ProjectItem[],
  repositories: Repository[],
) {
  const [projectUnsplitById, setProjectUnsplitById] = useState<Record<string, number>>({});
  const [repositoryUnsplitById, setRepositoryUnsplitById] = useState<Record<number, number>>({});
  const projectsRef = useRef(projects);
  const repositoriesRef = useRef(repositories);
  projectsRef.current = projects;
  repositoriesRef.current = repositories;

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
    const currentProjects = projectsRef.current;
    const currentRepositories = repositoriesRef.current;

    if (currentProjects.length === 0) {
      setProjectUnsplitById((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      setRepositoryUnsplitById((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const nextProjectUnsplit: Record<string, number> = {};
    const nextRepositoryUnsplit: Record<number, number> = {};

    await Promise.all(
      currentProjects.map(async (project) => {
        const workspaceInput = buildProjectRequirementWorkspaceInput({
          project,
          projects: currentProjects,
          repositories: currentRepositories,
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
          nextProjectUnsplit[project.id] = countUnsplitRequirementsInSnapshot(snapshot, {
            kind: "workspace",
          });
          for (const repositoryId of project.repositoryIds) {
            const count = countUnsplitRequirementsInSnapshot(snapshot, {
              kind: "repository",
              repositoryId,
            });
            if (count > 0) nextRepositoryUnsplit[repositoryId] = count;
            else if (!(repositoryId in nextRepositoryUnsplit)) nextRepositoryUnsplit[repositoryId] = 0;
          }
        } catch {
          nextProjectUnsplit[project.id] = 0;
        }
      }),
    );

    setProjectUnsplitById((prev) =>
      stringNumberRecordEqual(prev, nextProjectUnsplit) ? prev : nextProjectUnsplit,
    );
    setRepositoryUnsplitById((prev) =>
      idNumberRecordEqual(prev, nextRepositoryUnsplit) ? prev : nextRepositoryUnsplit,
    );
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => {
      void refresh();
    }, { timeoutMs: 1800 });
    return cancelIdle;
  }, [projectKey, repositoryKey, refresh]);

  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanups: Array<() => void> = [];

    const scheduleRefresh = () => {
      if (cancelled) return;
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!cancelled) void refresh();
      }, 900);
    };

    void (async () => {
      const attach = async (eventName: string) => {
        const unlisten = await listen(eventName, scheduleRefresh);
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
      if (debounceTimer != null) clearTimeout(debounceTimer);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [refresh]);

  return {
    projectUnsplitById,
    repositoryUnsplitById,
    refresh,
  };
}
