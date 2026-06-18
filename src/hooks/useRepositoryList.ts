import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { runWhenIdle } from "../utils/deferIdle";
import type { AddRepositoryOptions, ProjectItem, Repository, RepositoryAcquireParams } from "../types";
import {
  createRepositoryFromPathWithType,
  loadRepositories,
  removeRepository,
  resolveRepositoryAcquirePath,
  updateRepositoryMainOwnerAgent,
  updateRepositoryIconBadge,
  type RepositoryIconBadgePatch,
  updateProjectSddMode,
  updateRepositorySddMode,
} from "../services/repository";
import { updateRepositoryExecutionEngine } from "../services/repositoryExecutionEngine";
import {
  updateProjectOpenAppId,
  updateRepositoryOpenAppId,
} from "../services/openAppScopePreference";
import type { SessionExecutionEngine } from "../types";
import {
  addRepositoryToProject,
  createProject,
  deleteProject,
  listProjects,
  reconcileProjectWorkspace,
  resolveProjectRootFromRepository,
  removeRepositoryFromProject,
  reorderProjectRepositoriesInProject,
  setActiveProjectId as persistActiveProjectId,
  updateProjectName,
} from "../services/projectState";
import type { WorkspaceBootstrapSelection } from "../constants/workspaceBootstrapAddons";
import {
  DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION,
  workspaceBootstrapSelectionToSddMode,
} from "../constants/workspaceBootstrapAddons";
import { runWorkspaceBootstrap } from "../services/workspaceBootstrap";
import { regenerateProjectWorkflowGraphsFromTemplates } from "../services/rebuildProjectWorkflowGraphs";
import {
  deleteAppSetting,
  getAppSetting,
  getAppSettingsBatch,
  setAppSetting,
} from "../services/appSettingsStore";
import { normalizeRepositoryPathKey } from "../utils/repositoryMainSessionBinding";
import { selectFloatingRepositories } from "../utils/floatingRepositories";
import {
  PINNED_PROJECT_IDS_STORAGE_KEY,
  parsePinnedProjectIdsFromSetting,
  sortProjectsByPinOrder,
} from "../utils/projectPinOrder";
import type { WorkspaceFocus } from "../utils/workspaceMode";
import {
  WORKSPACE_LAST_SELECTION_STORAGE_KEY,
  WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY,
  parseWorkspaceLastSelection,
  resolveStartupSelection,
  workspaceWindowSelectionStorageKey,
} from "../utils/startupRepoSelection";
import { buildWorkspaceLastSelection } from "../utils/workspaceSelectionState";
import type { ReconcileProjectMode } from "../constants/reconcileProjectMode";
import { resolveProjectCreationSeedRepository } from "../utils/projectCreationContext";
import {
  getCurrentMainWorkspaceWindowLabel,
  isMainWorkspaceWindowLabel,
  isPrimaryMainWorkspaceWindowLabel,
} from "../services/mainWindow";

const LEGACY_APP_SETTING_KEY_PROJECTS = "wise.projects.v1";

function parseLastSessionRepoId(raw: string | null): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

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
  const [activeWorkspaceFocus, setActiveWorkspaceFocus] = useState<WorkspaceFocus>("repository");
  const [loading, setLoading] = useState(true);
  const isPrimaryMainWindowRef = useRef(true);
  const mainWorkspaceWindowLabelRef = useRef<string | null>(null);
  const persistActiveProjectIdleCleanupRef = useRef<(() => void) | null>(null);
  const selectionPersistIdleCleanupRef = useRef<(() => void) | null>(null);
  const selectionPersistStateRef = useRef({
    focus: "repository" as WorkspaceFocus,
    projectId: null as string | null,
    repositoryId: null as number | null,
  });

  const schedulePersistActiveProjectId = useCallback((projectId: string | null) => {
    persistActiveProjectIdleCleanupRef.current?.();
    persistActiveProjectIdleCleanupRef.current = runWhenIdle(() => {
      persistActiveProjectIdleCleanupRef.current = null;
      void persistActiveProjectId(projectId);
    }, { timeoutMs: 3000 });
  }, []);

  useEffect(
    () => () => {
      persistActiveProjectIdleCleanupRef.current?.();
      selectionPersistIdleCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        const windowLabel = getCurrentMainWorkspaceWindowLabel();
        mainWorkspaceWindowLabelRef.current = windowLabel;
        const isPrimary = isPrimaryMainWorkspaceWindowLabel(windowLabel);
        isPrimaryMainWindowRef.current = isPrimary;
        const selectionStorageKey =
          !isPrimary && windowLabel && isMainWorkspaceWindowLabel(windowLabel)
            ? workspaceWindowSelectionStorageKey(windowLabel)
            : WORKSPACE_LAST_SELECTION_STORAGE_KEY;
        const settingsKeys = [
          PINNED_PROJECT_IDS_STORAGE_KEY,
          selectionStorageKey,
          ...(isPrimary ? [WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY] : []),
        ];
        const [repositoryList, dbProjects, settingsBatch] = await Promise.all([
          loadRepositories(),
          listProjects(),
          getAppSettingsBatch(settingsKeys),
        ]);
        const rawPins = settingsBatch[PINNED_PROJECT_IDS_STORAGE_KEY] ?? null;
        const rawLastSelection = settingsBatch[selectionStorageKey] ?? null;
        const rawLastSessionRepoId = isPrimary
          ? settingsBatch[WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY] ?? null
          : null;
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
                const firstRepoId = (legacy.repositoryIds ?? []).find((repositoryId) =>
                  validRepositoryIds.has(repositoryId),
                );
                const firstRepo = firstRepoId
                  ? repositoryList.find((repo) => repo.id === firstRepoId) ?? null
                  : null;
                const resolvedRoot = firstRepo
                  ? await resolveProjectRootFromRepository(firstRepo.path)
                  : null;
                const created = await createProject(name, resolvedRoot);
                idMap.set(legacy.id, created.id);
                let currentProject = created;
                for (const repositoryId of legacy.repositoryIds ?? []) {
                  if (!validRepositoryIds.has(repositoryId)) continue;
                  currentProject = await addRepositoryToProject(created.id, repositoryId);
                }
                projectList = projectList.concat(currentProject);
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

        const parsedLastSessionRepoId = parseLastSessionRepoId(rawLastSessionRepoId);
        const parsedLastSelection = parseWorkspaceLastSelection(rawLastSelection);
        const startup = resolveStartupSelection({
          lastSelection: parsedLastSelection,
          lastSessionRepoId: parsedLastSessionRepoId,
          projects: sortedProjects,
          repositories: repositoryList,
        });
        if (startup.shouldClearLastSession && isPrimaryMainWindowRef.current) {
          void deleteAppSetting(WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY);
        }

        setRepositories(repositoryList);
        setPinnedProjectIds(pins);
        setProjects(sortedProjects);
        setActiveWorkspaceFocus(startup.workspaceFocus);
        setActiveProjectId(startup.projectId);
        await persistActiveProjectId(startup.projectId);
        setActiveRepositoryId(startup.repositoryId);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  /**
   * 持久化侧栏选中态（工作区焦点 / 仓库焦点 + id）。
   * 初次启动由 loader 直接装填，effect 跳过首次以避免覆盖 loader 的恢复结果。
   */
  selectionPersistStateRef.current = {
    focus: activeWorkspaceFocus,
    projectId: activeProjectId,
    repositoryId: activeRepositoryId,
  };

  const lastSessionPersistInitialRef = useRef(true);
  useEffect(() => {
    if (loading) return;
    const windowLabel = mainWorkspaceWindowLabelRef.current;
    const isPrimary = isPrimaryMainWindowRef.current;
    const isAuxMain =
      !isPrimary && Boolean(windowLabel && isMainWorkspaceWindowLabel(windowLabel));
    if (!isPrimary && !isAuxMain) return;
    if (lastSessionPersistInitialRef.current) {
      lastSessionPersistInitialRef.current = false;
      return;
    }
    selectionPersistIdleCleanupRef.current?.();
    selectionPersistIdleCleanupRef.current = runWhenIdle(() => {
      selectionPersistIdleCleanupRef.current = null;
      const { focus, projectId, repositoryId } = selectionPersistStateRef.current;
      const selectionPayload = JSON.stringify(
        buildWorkspaceLastSelection({
          focus,
          projectId,
          repositoryId,
        }),
      );
      if (isPrimary) {
        void setAppSetting(WORKSPACE_LAST_SELECTION_STORAGE_KEY, selectionPayload);
        if (focus === "repository" && repositoryId != null) {
          void setAppSetting(
            WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY,
            String(repositoryId),
          );
        } else {
          void deleteAppSetting(WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY);
        }
        return;
      }
      if (windowLabel) {
        void setAppSetting(workspaceWindowSelectionStorageKey(windowLabel), selectionPayload);
      }
    }, { timeoutMs: 1200 });
    return () => {
      selectionPersistIdleCleanupRef.current?.();
      selectionPersistIdleCleanupRef.current = null;
    };
  }, [activeWorkspaceFocus, activeProjectId, activeRepositoryId, loading]);

  const projectRepositories = useMemo(() => {
    if (!activeProject) return [];
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    return activeProject.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
  }, [activeProject, repositories]);

  /** 未关联到任何 project 的 repo（侧栏顶层游离区数据源）。 */
  const floatingRepositories = useMemo(
    () => selectFloatingRepositories(projects, repositories),
    [projects, repositories],
  );
  const standaloneRepos = floatingRepositories;

  const handleCreateProject = useCallback(async (
    name: string,
    options?: {
      rootPath?: string | null;
      bootstrap?: WorkspaceBootstrapSelection;
      /** @deprecated 使用 `bootstrap.trellis` */
      embedTrellis?: boolean;
    },
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const rootPathRaw = options?.rootPath?.trim();
    if (!rootPathRaw) {
      throw new Error("请先选择 Workspace 根目录");
    }
    const bootstrap: WorkspaceBootstrapSelection =
      options?.bootstrap ??
      (options?.embedTrellis === false
        ? { ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION, trellis: false }
        : DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION);
    await runWorkspaceBootstrap(rootPathRaw, bootstrap);
    const createdProject = await createProject(trimmed, rootPathRaw);
    const projectSddMode = workspaceBootstrapSelectionToSddMode(bootstrap);
    const modeRegisteredProject =
      projectSddMode === "wise_trellis" || projectSddMode === "project_owned"
        ? await updateProjectSddMode(createdProject.id, projectSddMode)
        : createdProject;
    const seedRepository = resolveProjectCreationSeedRepository({
      activeRepositoryId,
      projects,
      repositories,
    });
    let nextProject = modeRegisteredProject;
    if (seedRepository) {
      nextProject = await addRepositoryToProject(createdProject.id, seedRepository.id);
    }
    try {
      await reconcileProjectWorkspace(nextProject.id);
    } catch (err) {
      console.error("reconcile_project_workspace after create", err);
    }
    const [repositoryList, dbProjects] = await Promise.all([loadRepositories(), listProjects()]);
    setRepositories(repositoryList);
    setProjects(sortProjectsByPinOrder(dbProjects, pinnedProjectIds));
    const refreshed = dbProjects.find((p) => p.id === nextProject.id) ?? nextProject;
    setActiveProjectId(refreshed.id);
    await persistActiveProjectId(refreshed.id);
    const memberIds = refreshed.repositoryIds;
    const preferredRepoId =
      seedRepository && memberIds.includes(seedRepository.id)
        ? seedRepository.id
        : memberIds[0] ?? null;
    setActiveRepositoryId(preferredRepoId);
  }, [activeRepositoryId, projects, repositories, pinnedProjectIds]);

  const handleUpdateProject = useCallback(async (projectId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const updated = await updateProjectName(projectId, trimmed);
    setProjects((prev) => prev.map((project) => (project.id === projectId ? updated : project)));
  }, []);

  const handleUpdateProjectSddMode = useCallback(async (
    projectId: string,
    sddMode: "wise_trellis" | "project_owned",
  ) => {
    const updated = await updateProjectSddMode(projectId, sddMode);
    setProjects((prev) => prev.map((project) => (project.id === projectId ? updated : project)));
    return updated;
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    await deleteProject(projectId);
    const nextPins = pinnedProjectIds.filter((id) => id !== projectId);
    if (nextPins.length !== pinnedProjectIds.length) {
      void setAppSetting(PINNED_PROJECT_IDS_STORAGE_KEY, JSON.stringify(nextPins));
    }
    const [repositoryList, dbProjects] = await Promise.all([loadRepositories(), listProjects()]);
    const nextProjects = sortProjectsByPinOrder(dbProjects, nextPins);
    const validIds = new Set(repositoryList.map((r) => r.id));
    const nextActive = activeProjectId === projectId ? (nextProjects[0]?.id ?? null) : activeProjectId;
    const nextActiveProj = nextActive ? (nextProjects.find((project) => project.id === nextActive) ?? null) : null;
    const keepRepoId =
      activeRepositoryId != null &&
      validIds.has(activeRepositoryId) &&
      (!nextActiveProj || nextActiveProj.repositoryIds.includes(activeRepositoryId))
        ? activeRepositoryId
        : null;
    setPinnedProjectIds(nextPins);
    setProjects(nextProjects);
    setRepositories(repositoryList);
    if (!nextActive) {
      setActiveProjectId(null);
      setActiveRepositoryId(null);
      setActiveWorkspaceFocus("repository");
    } else if (keepRepoId != null) {
      setActiveProjectId(nextActive);
      setActiveRepositoryId(keepRepoId);
      setActiveWorkspaceFocus("repository");
    } else {
      setActiveProjectId(nextActive);
      setActiveRepositoryId(null);
      setActiveWorkspaceFocus("project");
    }
    void persistActiveProjectId(nextActive);
  }, [activeProjectId, activeRepositoryId, projects, pinnedProjectIds]);

  const handleSelectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setActiveWorkspaceFocus("project");
    setActiveRepositoryId(null);
    schedulePersistActiveProjectId(projectId);
  }, [schedulePersistActiveProjectId]);

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
    setActiveWorkspaceFocus("repository");
    schedulePersistActiveProjectId(projectId);
  }, [schedulePersistActiveProjectId]);

  /**
   * 选中 repo 并把 activeProjectId 同步到其 owner project（Standalone Repo 时清空）。
   *
   * 取代散落在 AppImpl 的 `ownerProject ? selectProjectAndRepository : setActiveRepositoryId`
   * 模式，避免选中 Standalone Repo 时残留 stale activeProjectId 污染右侧面板。
   */
  const setActiveRepositoryWithOwner = useCallback(
    (repositoryId: number) => {
      const ownerProject = projects.find((p) => p.repositoryIds.includes(repositoryId));
      const ownerProjectId = ownerProject?.id ?? null;
      setActiveProjectId(ownerProjectId);
      setActiveRepositoryId(repositoryId);
      setActiveWorkspaceFocus("repository");
      schedulePersistActiveProjectId(ownerProjectId);
    },
    [projects, schedulePersistActiveProjectId],
  );

  const handleAddRepositoryToProject = useCallback(async (
    projectId: string,
    repositoryType: Repository["repositoryType"],
    options?: AddRepositoryOptions,
    acquire?: RepositoryAcquireParams,
    explicitFolderPath?: string,
  ) => {
    let folderPath = explicitFolderPath?.trim() ?? "";
    if (!folderPath) {
      const project = projects.find((item) => item.id === projectId);
      const resolved = await resolveRepositoryAcquirePath(acquire, {
        defaultParentPath: project?.rootPath,
      });
      if (!resolved.ok) return;
      folderPath = resolved.path;
    }
    const folderPathKey = normalizeRepositoryPathKey(folderPath);
    let repository =
      repositories.find((item) => normalizeRepositoryPathKey(item.path) === folderPathKey) ?? null;
    if (!repository) {
      const freshList = await loadRepositories();
      repository =
        freshList.find((item) => normalizeRepositoryPathKey(item.path) === folderPathKey) ?? null;
    }
    if (!repository) {
      if (options?.bootstrap) {
        await runWorkspaceBootstrap(folderPath, options.bootstrap);
      }
      repository = await createRepositoryFromPathWithType(folderPath, repositoryType, options);
    }
    const repositoryId = repository.id;
    const updatedProject = await addRepositoryToProject(projectId, repositoryId);
    const repositoryList = await loadRepositories();
    setProjects((prev) => prev.map((project) => (project.id === projectId ? updatedProject : project)));
    setRepositories(repositoryList);
    setActiveProjectId(projectId);
    void persistActiveProjectId(projectId);
    setActiveRepositoryId(repositoryId);
  }, [projects, repositories]);

  /**
   * 创建不属于任何 project 的 Standalone Repo；选目录后立即在侧栏顶层平铺显示，
   * 同时清空 activeProjectId 避免右侧面板残留 stale 项目上下文。
   */
  const handleAddFloatingRepository = useCallback(
    async (
      repositoryType: Repository["repositoryType"],
      options?: AddRepositoryOptions,
      acquire?: RepositoryAcquireParams,
      explicitFolderPath?: string,
    ) => {
      let folderPath = explicitFolderPath?.trim() ?? "";
      if (!folderPath) {
        const resolved = await resolveRepositoryAcquirePath(acquire);
        if (!resolved.ok) return;
        folderPath = resolved.path;
      }
      const folderPathKey = normalizeRepositoryPathKey(folderPath);
      let repository =
        repositories.find((item) => normalizeRepositoryPathKey(item.path) === folderPathKey) ?? null;
      if (!repository) {
        const freshList = await loadRepositories();
        repository =
          freshList.find((item) => normalizeRepositoryPathKey(item.path) === folderPathKey) ?? null;
      }
      if (!repository) {
        if (options?.bootstrap) {
          await runWorkspaceBootstrap(folderPath, options.bootstrap);
        }
        repository = await createRepositoryFromPathWithType(folderPath, repositoryType, options);
      }
      setRepositories((prev) => {
        const key = normalizeRepositoryPathKey(repository!.path);
        if (prev.some((item) => normalizeRepositoryPathKey(item.path) === key)) {
          return prev.map((item) =>
            normalizeRepositoryPathKey(item.path) === key ? (repository as Repository) : item,
          );
        }
        return [...prev, repository as Repository];
      });
      setActiveProjectId(null);
      setActiveRepositoryId(repository.id);
      setActiveWorkspaceFocus("repository");
      void persistActiveProjectId(null);
    },
    [repositories],
  );

  /**
   * 将 Standalone Repo 升格为 Workspace：创建 project 记录 → 关联 repo → 切换到该 Workspace 卡。
   * repo 一旦关联即从游离区出栈（M:N 关联表更新，前端派生自动反映）。
   */
  const handlePromoteFloatingRepositoryToProject = useCallback(
    async (repositoryId: number, projectName: string) => {
      const trimmed = projectName.trim();
      if (!trimmed) return;
      const repository = repositories.find((item) => item.id === repositoryId) ?? null;
      const createdProject = await createProject(
        trimmed,
        repository?.path.trim() ? repository.path : null,
      );
      const updatedProject = await addRepositoryToProject(createdProject.id, repositoryId);
      setProjects((prev) => [...prev, updatedProject]);
      setActiveProjectId(updatedProject.id);
      setActiveRepositoryId(repositoryId);
      void persistActiveProjectId(updatedProject.id);
    },
    [repositories],
  );

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
        const freshList = await loadRepositories();
        repository =
          freshList.find((item) => normalizeRepositoryPathKey(item.path) === pathKey) ?? null;
      }
      if (!repository) {
        repository = await createRepositoryFromPathWithType(trimmed, repositoryType);
      }
      const repositoryId = repository.id;
      const project = projects.find((p) => p.id === projectId);
      if (project?.repositoryIds.includes(repositoryId)) {
        selectProjectAndRepository(projectId, repositoryId);
        return "already_in_project";
      }
      const updatedProject = await addRepositoryToProject(projectId, repositoryId);
      const repositoryList = await loadRepositories();
      setRepositories(repositoryList);
      setProjects((prev) => prev.map((proj) => (proj.id === projectId ? updatedProject : proj)));
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

  const handleUpdateRepositorySddMode = useCallback(async (
    repositoryId: number,
    sddMode: Repository["sddMode"],
  ) => {
    const updated = await updateRepositorySddMode(repositoryId, sddMode ?? null);
    setRepositories((prev) => prev.map((repo) => (repo.id === repositoryId ? updated : repo)));
  }, []);

  const handleUpdateRepositoryIconBadge = useCallback(
    async (repositoryId: number, patch: RepositoryIconBadgePatch) => {
      const updated = await updateRepositoryIconBadge(repositoryId, patch);
      setRepositories((prev) => prev.map((repo) => (repo.id === repositoryId ? updated : repo)));
    },
    [],
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
  const handleUpdateRepositoryMainOwnerAgent = useCallback(async (repositoryId: number, mainOwnerAgentName: string | null) => {
    const updated = await updateRepositoryMainOwnerAgent(repositoryId, mainOwnerAgentName);
    setRepositories((prev) => prev.map((r) => (r.id === repositoryId ? updated : r)));
  }, []);

  const handleUpdateRepositoryExecutionEngine = useCallback(
    async (repositoryId: number, executionEngine: SessionExecutionEngine) => {
      const updated = await updateRepositoryExecutionEngine(repositoryId, executionEngine);
      setRepositories((prev) => prev.map((r) => (r.id === repositoryId ? updated : r)));
    },
    [],
  );

  const handleUpdateRepositoryOpenAppId = useCallback(
    async (repositoryId: number, openAppId: string | null) => {
      const updated = await updateRepositoryOpenAppId(repositoryId, openAppId);
      setRepositories((prev) => prev.map((r) => (r.id === repositoryId ? updated : r)));
    },
    [],
  );

  const handleUpdateProjectOpenAppId = useCallback(
    async (projectId: string, openAppId: string | null) => {
      const updated = await updateProjectOpenAppId(projectId, openAppId);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)));
    },
    [],
  );

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

  const handleReconcileProjectWorkspace = useCallback(
    async (projectId: string, mode: ReconcileProjectMode = "repos_and_graphs") => {
      const result = await reconcileProjectWorkspace(projectId);
      let refreshedWorkflowCount = 0;
      if (mode === "repos_and_graphs") {
        try {
          refreshedWorkflowCount = await regenerateProjectWorkflowGraphsFromTemplates(projectId);
        } catch (err) {
          console.error("regenerateProjectWorkflowGraphsFromTemplates", err);
        }
      }
      const [repositoryList, dbProjects] = await Promise.all([loadRepositories(), listProjects()]);
      setRepositories(repositoryList);
      setProjects(sortProjectsByPinOrder(dbProjects, pinnedProjectIds));
      return { ...result, refreshedWorkflowCount };
    },
    [pinnedProjectIds],
  );

  return {
    repositories,
    projects,
    pinnedProjectIds,
    activeProject,
    activeProjectId,
    projectRepositories,
    floatingRepositories,
    standaloneRepos,
    activeRepositoryId,
    activeWorkspaceFocus,
    loading,
    setActiveRepositoryId,
    setActiveProjectId: handleSelectProject,
    setActiveWorkspaceFocus,
    selectProjectAndRepository,
    setActiveRepositoryWithOwner,
    handleCreateProject,
    handleUpdateProject,
    handleUpdateProjectSddMode,
    handleDeleteProject,
    handleAddRepositoryToProject,
    handleAddRepositoryPathToProject,
    handleAddFloatingRepository,
    handlePromoteFloatingRepositoryToProject,
    handleDetachRepositoryFromProject,
    handleRemoveRepository,
    handleUpdateRepositorySddMode,
    handleUpdateRepositoryIconBadge,
    handleReorderRepositoriesInProject,
    handleMoveRepositoryToProject,
    handleReconcileProjectWorkspace,
    handleUpdateRepositoryMainOwnerAgent,
    handleUpdateRepositoryExecutionEngine,
    handleUpdateRepositoryOpenAppId,
    handleUpdateProjectOpenAppId,
    togglePinProject,
  };
}
