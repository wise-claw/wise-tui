import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectItem, Repository } from "../../types";
import {
  resolveSidebarExpandedProjectId,
  type WorkspaceFocus,
} from "../../utils/workspaceMode";

interface UseProjectRepositorySidebarStateInput {
  projects: ProjectItem[];
  repositories: Repository[];
  activeProjectId?: string | null;
  activeRepositoryId?: number | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
}

export function useProjectRepositorySidebarState({
  projects,
  repositories,
  activeProjectId = null,
  activeRepositoryId = null,
  activeWorkspaceFocus = "repository",
  onMoveRepositoryToProject,
}: UseProjectRepositorySidebarStateInput) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const repoSidebarDragRef = useRef<{ sourceProjectId: string; repositoryId: number } | null>(null);
  const [projectDropTargetId, setProjectDropTargetId] = useState<string | null>(null);

  const repositoriesById = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories],
  );

  const clearRepoSidebarDrag = useCallback(() => {
    repoSidebarDragRef.current = null;
    setProjectDropTargetId(null);
  }, []);

  const moveRepositoryWithExpand = useCallback(
    async (targetProjectId: string, repositoryId: number) => {
      if (!onMoveRepositoryToProject) return;
      await onMoveRepositoryToProject(targetProjectId, repositoryId);
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(targetProjectId);
        return next;
      });
    },
    [onMoveRepositoryToProject],
  );

  const toggleProjectExpand = useCallback((id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const projectIdsKey = useMemo(() => projects.map((project) => project.id).join(","), [projects]);
  const selectionExpandProjectId = useMemo(
    () =>
      resolveSidebarExpandedProjectId(projects, {
        activeProjectId,
        activeRepositoryId,
        activeWorkspaceFocus,
      }),
    [projects, activeProjectId, activeRepositoryId, activeWorkspaceFocus],
  );

  useEffect(() => {
    const valid = new Set(projectIdsKey.length > 0 ? projectIdsKey.split(",") : []);
    setExpandedProjects((prev) => {
      const next = new Set(Array.from(prev).filter((id) => valid.has(id)));
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [projectIdsKey]);

  useEffect(() => {
    if (!selectionExpandProjectId) return;
    setExpandedProjects((prev) => {
      if (prev.has(selectionExpandProjectId)) return prev;
      const next = new Set(prev);
      next.add(selectionExpandProjectId);
      return next;
    });
  }, [selectionExpandProjectId]);

  return {
    repositoriesById,
    expandedProjects,
    projectDropTargetId,
    repoSidebarDragRef,
    clearRepoSidebarDrag,
    moveRepositoryWithExpand,
    setProjectDropTargetId,
    toggleProjectExpand,
  };
}
