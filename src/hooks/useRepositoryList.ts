import { useState, useEffect, useCallback, useMemo } from "react";
import type { AddRepositoryOptions, ProjectItem, Repository } from "../types";
import {
  pickFolder,
  createRepositoryFromPathWithType,
  loadRepositories,
  removeRepository,
} from "../services/repository";
import {
  addRepositoryToProject,
  createProject,
  deleteProject,
  listProjects,
  removeRepositoryFromProject,
  reorderProjectRepositoriesInProject,
  setActiveProjectId as persistActiveProjectId,
  updateProjectName,
} from "../services/projectState";
import { deleteAppSetting, getAppSetting, setAppSetting } from "../services/appSettingsStore";
import { normalizeRepositoryPathKey } from "../utils/repositoryMainSessionBinding";
import {
  PINNED_PROJECT_IDS_STORAGE_KEY,
  parsePinnedProjectIdsFromSetting,
  sortProjectsByPinOrder,
} from "../utils/projectPinOrder";

const LEGACY_APP_SETTING_KEY_PROJECTS = "wise.projects.v1";

interface LegacyProjectItem {
  id: string;
  name: string;
  repositoryIds: number[];
}

interface LegacyProjectsPayload {
  projects: LegacyProjectItem[];
  activeProjectId: string | null;
}

export function useRepositoryList() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [activeRepositoryId, setActiveRepositoryId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [repositoryList, dbProjects, rawPins] = await Promise.all([
          loadRepositories(),
          listProjects(),
          getAppSetting(PINNED_PROJECT_IDS_STORAGE_KEY),
        ]);
        let projectList = dbProjects;

        if (projectList.length === 0) {
          const raw = await getAppSetting(LEGACY_APP_SETTING_KEY_PROJECTS);
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as LegacyProjectsPayload;
              const validRepositoryIds = new Set(repositoryList.map((repo) => repo.id));
              const idMap = new Map<string, string>();
              for (const legacy of parsed.projects ?? []) {
                const name = legacy.name?.trim();
                if (!name) continue;
                const created = await createProject(name);
                idMap.set(legacy.id, created.id);
                for (const repositoryId of legacy.repositoryIds ?? []) {
                  if (!validRepositoryIds.has(repositoryId)) continue;
                  await addRepositoryToProject(created.id, repositoryId);
                }
              }
              projectList = await listProjects();
              await deleteAppSetting(LEGACY_APP_SETTING_KEY_PROJECTS);
            } catch {
              // ignore bad legacy payload
            }
          }
        }

        const pinsDirty = parsePinnedProjectIdsFromSetting(rawPins);
        const pins = pinsDirty.filter((id) => projectList.some((p) => p.id === id));
        if (pins.length !== pinsDirty.length) {
          void setAppSetting(PINNED_PROJECT_IDS_STORAGE_KEY, JSON.stringify(pins));
        }
        const sortedProjects = sortProjectsByPinOrder(projectList, pins);

        setRepositories(repositoryList);
        setPinnedProjectIds(pins);
        setProjects(sortedProjects);
        /** 进入应用：默认排序后的第一个项目及其下第一个仓库（与侧栏展示顺序一致），不再恢复上次活动项目。 */
        const firstProjectForDefault = sortedProjects[0] ?? null;
        const active = firstProjectForDefault?.id ?? null;
        setActiveProjectId(active);
        await persistActiveProjectId(active);
        setActiveRepositoryId(firstProjectForDefault?.repositoryIds[0] ?? repositoryList[0]?.id ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const projectRepositories = useMemo(() => {
    if (!activeProject) return [];
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    return activeProject.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
  }, [activeProject, repositories]);

  const handleCreateProject = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextProject = await createProject(trimmed);
    setProjects((prev) => [...prev, nextProject]);
    setActiveProjectId(nextProject.id);
    await persistActiveProjectId(nextProject.id);
    setActiveRepositoryId(null);
  }, []);

  const handleUpdateProject = useCallback(async (projectId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const updated = await updateProjectName(projectId, trimmed);
    setProjects((prev) => prev.map((project) => (project.id === projectId ? updated : project)));
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    await deleteProject(projectId);
    const nextPins = pinnedProjectIds.filter((id) => id !== projectId);
    if (nextPins.length !== pinnedProjectIds.length) {
      void setAppSetting(PINNED_PROJECT_IDS_STORAGE_KEY, JSON.stringify(nextPins));
    }
    setPinnedProjectIds(nextPins);
    const nextProjects = sortProjectsByPinOrder(
      projects.filter((project) => project.id !== projectId),
      nextPins,
    );
    setProjects(nextProjects);
    const nextActive = activeProjectId === projectId ? (nextProjects[0]?.id ?? null) : activeProjectId;
    setActiveProjectId(nextActive);
    setActiveRepositoryId(
      nextProjects.find((project) => project.id === nextActive)?.repositoryIds[0] ?? null,
    );
    void persistActiveProjectId(nextActive);
  }, [activeProjectId, projects, pinnedProjectIds]);

  const handleSelectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    const selected = projects.find((project) => project.id === projectId) ?? null;
    setActiveRepositoryId(selected?.repositoryIds[0] ?? null);
    void persistActiveProjectId(projectId);
  }, [projects]);

  const togglePinProject = useCallback((projectId: string) => {
    setPinnedProjectIds((prevPins) => {
      const isPinned = prevPins.includes(projectId);
      const nextPins = isPinned
        ? prevPins.filter((id) => id !== projectId)
        : [projectId, ...prevPins.filter((id) => id !== projectId)];
      void setAppSetting(PINNED_PROJECT_IDS_STORAGE_KEY, JSON.stringify(nextPins));
      setProjects((prevProjects) => sortProjectsByPinOrder(prevProjects, nextPins));
      return nextPins;
    });
  }, []);

  /** 同时激活项目与仓库（不切到项目下「第一个」仓库），供跨项目跳转会话等场景使用。 */
  const selectProjectAndRepository = useCallback((projectId: string, repositoryId: number) => {
    setActiveProjectId(projectId);
    setActiveRepositoryId(repositoryId);
    void persistActiveProjectId(projectId);
  }, []);

  const handleAddRepositoryToProject = useCallback(async (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
  ) => {
    const folderPath = await pickFolder();
    if (!folderPath) return;
    let repository = repositories.find((item) => item.path === folderPath) ?? null;
    if (!repository) {
      repository = await createRepositoryFromPathWithType(folderPath, repositoryType, options);
      setRepositories((prev) => [...prev, repository as Repository]);
    }
    const repositoryId = repository.id;
    await addRepositoryToProject(projectId, repositoryId);
    setProjects((prev) => {
      const next = prev.map((project) => {
        if (project.id !== projectId) return project;
        if (project.repositoryIds.includes(repositoryId)) return project;
        return {
          ...project,
          repositoryIds: [...project.repositoryIds, repositoryId],
          updatedAt: Date.now(),
        };
      });
      return next;
    });
    setActiveProjectId(projectId);
    void persistActiveProjectId(projectId);
    setActiveRepositoryId(repositoryId);
  }, [repositories]);

  /**
   * 将指定磁盘目录作为仓库加入项目（不弹文件夹选择器），供 worktree 等已知路径场景使用。
   * @returns `added` 新关联；`already_in_project` 已在该项目中（仍会切到该仓库）。
   */
  const handleAddRepositoryPathToProject = useCallback(
    async (
      projectId: string,
      folderPath: string,
      repositoryType: Repository["repositoryType"],
    ): Promise<"added" | "already_in_project"> => {
      const trimmed = folderPath.trim();
      if (!trimmed) {
        throw new Error("路径为空");
      }
      const pathKey = normalizeRepositoryPathKey(trimmed);
      let repository =
        repositories.find((item) => normalizeRepositoryPathKey(item.path) === pathKey) ?? null;
      if (!repository) {
        repository = await createRepositoryFromPathWithType(trimmed, repositoryType);
        setRepositories((prev) => [...prev, repository as Repository]);
      }
      const repositoryId = repository.id;
      const project = projects.find((p) => p.id === projectId);
      if (project?.repositoryIds.includes(repositoryId)) {
        selectProjectAndRepository(projectId, repositoryId);
        return "already_in_project";
      }
      await addRepositoryToProject(projectId, repositoryId);
      setProjects((prev) =>
        prev.map((proj) => {
          if (proj.id !== projectId) return proj;
          if (proj.repositoryIds.includes(repositoryId)) return proj;
          return {
            ...proj,
            repositoryIds: [...proj.repositoryIds, repositoryId],
            updatedAt: Date.now(),
          };
        }),
      );
      selectProjectAndRepository(projectId, repositoryId);
      return "added";
    },
    [repositories, projects, selectProjectAndRepository],
  );

  /** 从 Wise 全局仓库列表移除，并解除与所有项目的关联（原「彻底删除仓库」逻辑）。 */
  const removeRepositoryGloballyFromState = useCallback(async (repositoryId: number) => {
    await removeRepository(repositoryId);
    setRepositories((prev) => prev.filter((p) => p.id !== repositoryId));
    setProjects((prev) =>
      prev.map((project) => ({
        ...project,
        repositoryIds: project.repositoryIds.filter((id) => id !== repositoryId),
      })),
    );
    setActiveRepositoryId((prev) => (prev === repositoryId ? null : prev));
  }, []);

  /** 侧栏「移出项目」：与全局移除仓库一致。 */
  const handleDetachRepositoryFromProject = useCallback(
    async (_projectId: string, repositoryId: number) => {
      await removeRepositoryGloballyFromState(repositoryId);
    },
    [removeRepositoryGloballyFromState],
  );

  const handleRemoveRepository = useCallback(
    async (repository: Repository) => {
      await removeRepositoryGloballyFromState(repository.id);
    },
    [removeRepositoryGloballyFromState],
  );

  const handleReorderRepositoriesInProject = useCallback(async (projectId: string, repositoryIds: number[]) => {
    await reorderProjectRepositoriesInProject(projectId, repositoryIds);
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, repositoryIds: [...repositoryIds], updatedAt: Date.now() }
          : project,
      ),
    );
  }, []);

  /** 将仓库从其它项目移入目标项目（目标项目已有该仓库时仅解除其它项目关联） */
  const handleMoveRepositoryToProject = useCallback(
    async (targetProjectId: string, repositoryId: number) => {
      const owningIds = projects.filter((p) => p.repositoryIds.includes(repositoryId)).map((p) => p.id);
      if (owningIds.length === 1 && owningIds[0] === targetProjectId) {
        selectProjectAndRepository(targetProjectId, repositoryId);
        return;
      }
      for (const pid of owningIds) {
        if (pid !== targetProjectId) {
          await removeRepositoryFromProject(pid, repositoryId);
        }
      }
      const inTarget = owningIds.includes(targetProjectId);
      if (!inTarget) {
        await addRepositoryToProject(targetProjectId, repositoryId);
      }
      const refreshed = await listProjects();
      setProjects(sortProjectsByPinOrder(refreshed, pinnedProjectIds));
      selectProjectAndRepository(targetProjectId, repositoryId);
    },
    [projects, pinnedProjectIds, selectProjectAndRepository],
  );

  return {
    repositories,
    projects,
    pinnedProjectIds,
    activeProject,
    activeProjectId,
    projectRepositories,
    activeRepositoryId,
    loading,
    setActiveRepositoryId,
    setActiveProjectId: handleSelectProject,
    selectProjectAndRepository,
    handleCreateProject,
    handleUpdateProject,
    handleDeleteProject,
    handleAddRepositoryToProject,
    handleAddRepositoryPathToProject,
    handleDetachRepositoryFromProject,
    handleRemoveRepository,
    handleReorderRepositoriesInProject,
    handleMoveRepositoryToProject,
    togglePinProject,
  };
}
