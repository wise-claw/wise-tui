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
  /** 工作区内容默认全部展开；用户手动收起后不会被列表刷新强行打开。 */
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(projects.map((project) => project.id)),
  );
  /** 仓库即工作区：默认全部收起，仅用户点击文件夹展开。 */
  const [expandedRepositoryIds, setExpandedRepositoryIds] = useState<Set<number>>(
    () => new Set(),
  );
  /** 已见过的工作区 id；仅对「新出现」的 id 自动展开，保留用户折叠态。 */
  const knownProjectIdsRef = useRef<Set<string> | null>(null);
  const knownRepositoryIdsRef = useRef<Set<number> | null>(null);
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

  const toggleRepositoryExpand = useCallback((repositoryId: number) => {
    setExpandedRepositoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(repositoryId)) {
        next.delete(repositoryId);
      } else {
        next.add(repositoryId);
      }
      return next;
    });
  }, []);

  const projectIdsKey = useMemo(() => projects.map((project) => project.id).join(","), [projects]);
  const repositoryIdsKey = useMemo(
    () => repositories.map((repository) => repository.id).join(","),
    [repositories],
  );
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
    const ids = projectIdsKey.length > 0 ? projectIdsKey.split(",") : [];
    const valid = new Set(ids);
    const known = knownProjectIdsRef.current;
    // 首次同步 / 异步加载完成后：把当前全部工作区视为「新出现」并展开。
    const newlyAdded = known === null ? ids : ids.filter((id) => !known.has(id));
    knownProjectIdsRef.current = valid;

    setExpandedProjects((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      for (const id of newlyAdded) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [projectIdsKey]);

  useEffect(() => {
    const ids =
      repositoryIdsKey.length > 0 ? repositoryIdsKey.split(",").map((id) => Number(id)) : [];
    const valid = new Set(ids);
    knownRepositoryIdsRef.current = valid;

    // 仅 prune 已删除仓库的展开态；不自动展开新增仓库（默认全部收起）。
    setExpandedRepositoryIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (valid.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [repositoryIdsKey]);

  useEffect(() => {
    if (!selectionExpandProjectId) return;
    setExpandedProjects((prev) => {
      if (prev.has(selectionExpandProjectId)) return prev;
      const next = new Set(prev);
      next.add(selectionExpandProjectId);
      return next;
    });
  }, [selectionExpandProjectId]);

  /** 选中仓库时打开会话列表（不收起其它已展开仓库）。 */
  useEffect(() => {
    if (activeRepositoryId == null) return;
    setExpandedRepositoryIds((prev) => {
      if (prev.has(activeRepositoryId)) return prev;
      const next = new Set(prev);
      next.add(activeRepositoryId);
      return next;
    });
  }, [activeRepositoryId]);

  return {
    repositoriesById,
    expandedProjects,
    expandedRepositoryIds,
    projectDropTargetId,
    repoSidebarDragRef,
    clearRepoSidebarDrag,
    moveRepositoryWithExpand,
    setProjectDropTargetId,
    toggleProjectExpand,
    toggleRepositoryExpand,
  };
}
