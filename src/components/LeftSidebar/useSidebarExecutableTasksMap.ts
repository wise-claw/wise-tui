import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ProjectItem, Repository } from "../../types";
import { runWhenIdle } from "../../utils/deferIdle";
import { countGlobalSplitTodoExecutableTasks } from "../../services/prdTaskSplitStore";
import {
  buildProjectRequirementWorkspaceInput,
  listTrellisRequirementWorkspace,
} from "../../services/trellisTaskBridge";
import { countExecutableTrellisTasksInSnapshot } from "../../utils/taskDrawerCounts";
import { selectFloatingRepositories } from "../../utils/floatingRepositories";
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

const SIDEBAR_TRELLIS_REFRESH_DEBOUNCE_MS = 900;

/** 侧栏：按 Workspace / 仓库统计可执行任务（规则与主会话「任务」抽屉一致）。 */
export function useSidebarExecutableTasksMap(
  projects: ProjectItem[],
  repositories: Repository[],
  activeProjectId: string | null,
) {
  const [projectExecutableById, setProjectExecutableById] = useState<Record<string, number>>({});
  const [repositoryExecutableById, setRepositoryExecutableById] = useState<Record<number, number>>({});
  const projectsRef = useRef(projects);
  const repositoriesRef = useRef(repositories);
  const activeProjectIdRef = useRef(activeProjectId);
  projectsRef.current = projects;
  repositoriesRef.current = repositories;
  activeProjectIdRef.current = activeProjectId;

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
    const currentActiveProjectId = activeProjectIdRef.current;

    const nextProjectExecutable: Record<string, number> = {};
    const nextRepositoryExecutable: Record<number, number> = {};
    const globalSplitTodoCount = await countGlobalSplitTodoExecutableTasks().catch(() => 0);

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
          nextProjectExecutable[project.id] = 0;
          return;
        }

        try {
          const snapshot = await listTrellisRequirementWorkspace({
            ...workspaceInput,
            includeArchived: false,
          });
          const trellisCount = countExecutableTrellisTasksInSnapshot(snapshot);
          const splitTodoCount = project.id === currentActiveProjectId ? globalSplitTodoCount : 0;
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

    const floatingRepositories = selectFloatingRepositories(currentProjects, currentRepositories);
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

    setProjectExecutableById((prev) =>
      stringNumberRecordEqual(prev, nextProjectExecutable) ? prev : nextProjectExecutable,
    );
    setRepositoryExecutableById((prev) =>
      idNumberRecordEqual(prev, nextRepositoryExecutable) ? prev : nextRepositoryExecutable,
    );
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => {
      void refresh();
    }, { timeoutMs: 1800 });
    return cancelIdle;
    // 仅在 projects/repositories 结构变化时刷新；activeProjectId 切换不应重发
    // O(P×IPC) 的 Trellis 工作区拉取——它只影响 splitTodoCount 的归属，
    // Trellis 事件监听器 + 用户后续操作会重新触发刷新足以覆盖。
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
      }, SIDEBAR_TRELLIS_REFRESH_DEBOUNCE_MS);
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
    projectExecutableById,
    repositoryExecutableById,
    refresh,
  };
}
