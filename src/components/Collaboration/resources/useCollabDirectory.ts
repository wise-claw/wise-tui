import { useCallback, useEffect, useState } from "react";
import { listCollabAgents, listCollabSpaces, onCollabChanged, projectWorkspaceLabel } from "../../../services/collaboration";
import { listProjects } from "../../../services/projectState";
import { loadRepositories } from "../../../services/repository";
import type { ProjectItem, Repository } from "../../../types";
import type { CollabAgentSummary, CollabSpace } from "../../../types/collaboration";

export interface CollabDirectory {
  projects: ProjectItem[];
  repositories: Repository[];
  agents: CollabAgentSummary[];
  spaces: CollabSpace[];
  reloadSpaces: () => void;
}

/** 共享资源/协作空间界面所需的项目、仓库、智能体与空间目录。 */
export function useCollabDirectory(active: boolean): CollabDirectory {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [agents, setAgents] = useState<CollabAgentSummary[]>([]);
  const [spaces, setSpaces] = useState<CollabSpace[]>([]);

  const reloadSpaces = useCallback(() => {
    void listCollabSpaces()
      .then(setSpaces)
      .catch(() => setSpaces([]));
  }, []);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listProjects()
      .then((p) => !disposed && setProjects(p))
      .catch(() => {});
    void loadRepositories()
      .then((r) => !disposed && setRepositories(r))
      .catch(() => {});
    const loadAgents = () =>
      void listCollabAgents(false)
        .then((a) => !disposed && setAgents(a))
        .catch(() => {});
    loadAgents();
    reloadSpaces();
    void onCollabChanged((rid) => {
      if (rid != null) return;
      loadAgents();
      reloadSpaces();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, reloadSpaces]);

  return { projects, repositories, agents, spaces, reloadSpaces };
}

export function projectLabel(
  projects: ProjectItem[],
  id: string | null | undefined,
  repositories: readonly Repository[] = [],
): string {
  if (!id) return "—";
  const project = projects.find((p) => p.id === id);
  if (!project) return id;
  return projectWorkspaceLabel(project, repositories);
}
