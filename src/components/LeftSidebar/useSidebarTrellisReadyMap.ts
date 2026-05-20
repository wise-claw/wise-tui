import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectItem, Repository } from "../../types";
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

/** Sidebar: track Trellis init (.trellis/scripts/task.py) per workspace and repository. */
export function useSidebarTrellisReadyMap(
  projects: ProjectItem[],
  repositories: Repository[],
) {
  const [projectReadyById, setProjectReadyById] = useState<Record<string, boolean>>({});
  const [repositoryReadyById, setRepositoryReadyById] = useState<Record<number, boolean>>({});

  const scopeKey = useMemo(() => {
    const projectPart = projects
      .map((project) => `${project.id}:${project.rootPath ?? ""}:${project.repositoryIds.join(",")}`)
      .join("|");
    const repoPart = repositories.map((repository) => `${repository.id}:${repository.path}`).join("|");
    return `${projectPart}::${repoPart}`;
  }, [projects, repositories]);

  const refresh = useCallback(async () => {
    const repoById = new Map(repositories.map((repository) => [repository.id, repository] as const));
    const nextProjectReady: Record<string, boolean> = {};
    const nextRepositoryReady: Record<number, boolean> = {};

    await Promise.all(
      projects.map(async (project) => {
        const projectPath = resolveTrellisBootstrapPath({
          scope: "project",
          project,
          repositories,
          projects,
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
              repositories,
              projects,
            });
            nextRepositoryReady[repositoryId] = await pathHasTrellis(repositoryPath);
          }),
        );
      }),
    );

    const floatingRepositories = selectFloatingRepositories(projects, repositories);
    await Promise.all(
      floatingRepositories.map(async (repository) => {
        const repositoryPath = resolveTrellisBootstrapPath({
          scope: "repository",
          repository,
          repositories,
          projects,
        });
        nextRepositoryReady[repository.id] = await pathHasTrellis(repositoryPath);
      }),
    );

    setProjectReadyById(nextProjectReady);
    setRepositoryReadyById(nextRepositoryReady);
  }, [projects, repositories]);

  useEffect(() => {
    void refresh();
  }, [refresh, scopeKey]);

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
