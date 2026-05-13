import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectItem, Repository } from "../../types";

interface UseProjectRepositorySidebarStateInput {
  projects: ProjectItem[];
  repositories: Repository[];
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
}

export function useProjectRepositorySidebarState({
  projects,
  repositories,
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
  const firstProjectId = useMemo(() => projects[0]?.id ?? null, [projects]);

  useEffect(() => {
    const valid = new Set(projectIdsKey.length > 0 ? projectIdsKey.split(",") : []);
    setExpandedProjects((prev) => {
      const next = new Set(Array.from(prev).filter((id) => valid.has(id)));
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [projectIdsKey]);

  useEffect(() => {
    if (!firstProjectId) return;
    setExpandedProjects((prev) => {
      if (prev.has(firstProjectId)) return prev;
      const next = new Set(prev);
      next.add(firstProjectId);
      return next;
    });
  }, [firstProjectId]);

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
