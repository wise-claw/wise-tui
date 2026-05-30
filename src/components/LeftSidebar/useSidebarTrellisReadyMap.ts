import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectItem, Repository } from "../../types";
import { runWhenIdle } from "../../utils/deferIdle";
import { TRELLIS_UI_EVENT_BOOTSTRAP_COMPLETE } from "../../constants/trellisUiEvents";
import { trellisTaskPyExistsAtPath } from "../../services/trellisBootstrap";
import { selectFloatingRepositories } from "../../utils/floatingRepositories";
import { resolveTrellisBootstrapPath } from "../../utils/trellisBootstrapPath";

async function pathHasTrellis(path: string | null): Promise<boolean> {
  const trimmed = path?.trim();
  if (!trimmed) return false;
  try {
    return await trellisTaskPyExistsAtPath(trimmed);
  } catch {
    return false;
  }
}

function stringBoolRecordEqual(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function idBoolRecordEqual(left: Record<number, boolean>, right: Record<number, boolean>): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (left[Number(key)] !== right[Number(key)]) return false;
  }
  return true;
}

/** Sidebar: track Trellis init (.trellis/scripts/task.py) per workspace and repository. */
export function useSidebarTrellisReadyMap(
  projects: ProjectItem[],
  repositories: Repository[],
) {
  const [projectReadyById, setProjectReadyById] = useState<Record<string, boolean>>({});
  const [repositoryReadyById, setRepositoryReadyById] = useState<Record<number, boolean>>({});
  const projectsRef = useRef(projects);
  const repositoriesRef = useRef(repositories);
  projectsRef.current = projects;
  repositoriesRef.current = repositories;

  const scopeKey = useMemo(() => {
    const projectPart = projects
      .map((project) => `${project.id}:${project.rootPath ?? ""}:${project.repositoryIds.join(",")}`)
      .join("|");
    const repoPart = repositories.map((repository) => `${repository.id}:${repository.path}`).join("|");
    return `${projectPart}::${repoPart}`;
  }, [projects, repositories]);

  const refresh = useCallback(async () => {
    const currentProjects = projectsRef.current;
    const currentRepositories = repositoriesRef.current;
    const repoById = new Map(currentRepositories.map((repository) => [repository.id, repository] as const));
    const nextProjectReady: Record<string, boolean> = {};
    const nextRepositoryReady: Record<number, boolean> = {};

    await Promise.all(
      currentProjects.map(async (project) => {
        const projectPath = resolveTrellisBootstrapPath({
          scope: "project",
          project,
          repositories: currentRepositories,
          projects: currentProjects,
        });
        nextProjectReady[project.id] = await pathHasTrellis(projectPath);

        await Promise.all(
          project.repositoryIds.map(async (repositoryId) => {
            const repository = repoById.get(repositoryId);
            if (!repository) return;
            const repositoryPath = resolveTrellisBootstrapPath({
              scope: "repository",
              project,
              repository,
              repositories: currentRepositories,
              projects: currentProjects,
            });
            nextRepositoryReady[repositoryId] = await pathHasTrellis(repositoryPath);
          }),
        );
      }),
    );

    const floatingRepositories = selectFloatingRepositories(currentProjects, currentRepositories);
    await Promise.all(
      floatingRepositories.map(async (repository) => {
        const repositoryPath = resolveTrellisBootstrapPath({
          scope: "repository",
          repository,
          repositories: currentRepositories,
          projects: currentProjects,
        });
        nextRepositoryReady[repository.id] = await pathHasTrellis(repositoryPath);
      }),
    );

    setProjectReadyById((prev) =>
      stringBoolRecordEqual(prev, nextProjectReady) ? prev : nextProjectReady,
    );
    setRepositoryReadyById((prev) =>
      idBoolRecordEqual(prev, nextRepositoryReady) ? prev : nextRepositoryReady,
    );
  }, []);

  useEffect(() => {
    const cancelIdle = runWhenIdle(() => {
      void refresh();
    }, { timeoutMs: 1800 });
    return cancelIdle;
  }, [scopeKey, refresh]);

  useEffect(() => {
    const onBootstrapComplete = () => {
      void refresh();
    };
    window.addEventListener(TRELLIS_UI_EVENT_BOOTSTRAP_COMPLETE, onBootstrapComplete);
    return () => window.removeEventListener(TRELLIS_UI_EVENT_BOOTSTRAP_COMPLETE, onBootstrapComplete);
  }, [refresh]);

  return {
    projectTrellisReadyById: projectReadyById,
    repositoryTrellisReadyById: repositoryReadyById,
    refreshTrellisReadyMap: refresh,
  };
}
