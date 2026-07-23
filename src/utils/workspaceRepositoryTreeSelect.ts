import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "./repositoryType";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";
import type { WorkspaceFocus } from "./workspaceMode";

export interface WorkspaceRepositoryTreeNode {
  title: string;
  value: string;
  selectable: boolean;
  nodeType: "project" | "repo" | "group";
  projectId?: string;
  repositoryId?: number;
  children?: WorkspaceRepositoryTreeNode[];
}

export function findProjectOwningRepository(
  projects: readonly ProjectItem[],
  repositoryId: number,
): ProjectItem | null {
  for (const project of projects) {
    if ((project.repositoryIds ?? []).includes(repositoryId)) {
      return project;
    }
  }
  return null;
}

export function repositoryDisplayName(repository: Repository | null | undefined): string {
  if (!repository) return "未选择仓库";
  const name = repository.name?.trim();
  if (name) return name;
  const path = repository.path?.trim() ?? "";
  if (!path) return "未命名仓库";
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function formatWorkspaceRepositoryContextLabel(
  project: ProjectItem | null,
  repository: Repository | null | undefined,
  options?: { workspaceFocus?: WorkspaceFocus },
): string {
  const projectName = project?.name?.trim();
  if (options?.workspaceFocus === "project" && projectName) {
    return projectName;
  }
  return repositoryDisplayName(repository ?? null);
}

/** 工作区在 IDE / 打开方式菜单中使用的目录（rootPath 或成员仓公共父路径）。 */
export function resolveProjectDirectoryOpenPath(
  project: ProjectItem,
  repositories: readonly Repository[],
): string {
  return resolveProjectMainSessionAnchor(project, repositories).path.trim();
}

/**
 * 文件树 / Git 面板用的工作区目录：在会话锚点为空时回退到首个成员仓库路径，
 * 避免多仓无公共父路径时左栏完全不展示。
 */
export function resolveProjectExplorerOpenPath(
  project: ProjectItem,
  repositories: readonly Repository[],
): string {
  const anchorPath = resolveProjectDirectoryOpenPath(project, repositories);
  if (anchorPath) return anchorPath;
  const repoById = new Map(repositories.map((repo) => [repo.id, repo] as const));
  for (const repoId of project.repositoryIds ?? []) {
    const path = repoById.get(repoId)?.path?.trim() ?? "";
    if (path) return path;
  }
  return "";
}

export function resolveGitPanelContextOpenPath(input: {
  activeWorkspaceFocus: WorkspaceFocus;
  activeProject: ProjectItem | null;
  activeRepositoryPath: string;
  repositories: readonly Repository[];
}): string {
  if (input.activeWorkspaceFocus === "project" && input.activeProject) {
    const projectPath = resolveProjectExplorerOpenPath(input.activeProject, input.repositories);
    if (projectPath) return projectPath;
  }
  return input.activeRepositoryPath.trim();
}

export interface GitPanelRepositoryEntry {
  repositoryId: number;
  path: string;
  name: string;
  /** 仓库默认执行引擎；Git 面板 AI 润色提交信息时使用。 */
  executionEngine?: SessionExecutionEngine;
}

/**
 * 解析 Git 面板应展示的仓库列表。
 * - 选中工作区 → 仅该工作区成员仓库
 * - 选中仓库 → 仅该仓库
 */
export function resolveGitPanelRepositoryEntries(input: {
  treeSelection: WorkspaceRepositoryTreeSelection | null;
  projects: readonly ProjectItem[];
  repositories: readonly Repository[];
  fallbackPath?: string;
  fallbackName?: string;
  fallbackRepositoryId?: number | null;
}): GitPanelRepositoryEntry[] {
  const {
    treeSelection,
    projects,
    repositories,
    fallbackPath = "",
    fallbackName = "",
    fallbackRepositoryId = null,
  } = input;
  const repoById = new Map(repositories.map((repo) => [repo.id, repo] as const));

  if (treeSelection?.kind === "project") {
    const project = projects.find((item) => item.id === treeSelection.projectId) ?? null;
    if (!project) return [];
    return (project.repositoryIds ?? [])
      .map((repoId) => repoById.get(repoId))
      .filter((repo): repo is Repository => Boolean(repo?.path?.trim()))
      .map((repo) => ({
        repositoryId: repo.id,
        path: repo.path.trim(),
        name: repositoryDisplayName(repo),
        executionEngine: normalizeSessionExecutionEngine(repo.executionEngine),
      }));
  }

  if (treeSelection?.kind === "repository") {
    const repo = repoById.get(treeSelection.repositoryId);
    if (repo?.path?.trim()) {
      return [
        {
          repositoryId: repo.id,
          path: repo.path.trim(),
          name: repositoryDisplayName(repo),
          executionEngine: normalizeSessionExecutionEngine(repo.executionEngine),
        },
      ];
    }
    return [];
  }

  const trimmedFallback = fallbackPath.trim();
  if (trimmedFallback) {
    const fallbackRepo =
      fallbackRepositoryId != null
        ? repoById.get(fallbackRepositoryId)
        : repositories.find((item) => item.path.trim() === trimmedFallback);
    return [
      {
        repositoryId: fallbackRepositoryId ?? -1,
        path: trimmedFallback,
        name: fallbackName.trim() || repositoryFolderBasename({ path: trimmedFallback, name: "" }),
        executionEngine: normalizeSessionExecutionEngine(fallbackRepo?.executionEngine),
      },
    ];
  }

  return [];
}

export function buildWorkspaceRepositoryTreeData(
  projects: readonly ProjectItem[],
  repositories: readonly Repository[],
): WorkspaceRepositoryTreeNode[] {
  const repoById = new Map(repositories.map((repo) => [repo.id, repo] as const));
  const assignedRepoIds = new Set<number>();
  const tree: WorkspaceRepositoryTreeNode[] = [];

  for (const project of projects) {
    const children: WorkspaceRepositoryTreeNode[] = [];
    for (const repoId of project.repositoryIds ?? []) {
      const repo = repoById.get(repoId);
      if (!repo) continue;
      children.push({
        title: repositoryDisplayName(repo),
        value: `repo:${repo.id}`,
        selectable: true,
        nodeType: "repo",
        repositoryId: repo.id,
      });
      assignedRepoIds.add(repoId);
    }
    tree.push({
      title: project.name?.trim() || "未命名工作区",
      value: `project:${project.id}`,
      selectable: true,
      nodeType: "project",
      projectId: project.id,
      children,
    });
  }

  const standalone = repositories
    .filter((repo) => !assignedRepoIds.has(repo.id))
    .map((repo) => ({
      title: repositoryDisplayName(repo),
      value: `repo:${repo.id}`,
      selectable: true,
      nodeType: "repo" as const,
      repositoryId: repo.id,
    }));

  if (standalone.length > 0) {
    tree.push({
      title: "独立仓库",
      value: "__standalone__",
      selectable: false,
      nodeType: "group",
      children: standalone,
    });
  }

  return tree;
}

export type WorkspaceRepositoryTreeSelection =
  | { kind: "repository"; repositoryId: number }
  | { kind: "project"; projectId: string };

export function resolveTreeNodeOpenPath(
  node: WorkspaceRepositoryTreeNode,
  projects: readonly ProjectItem[],
  repositories: readonly Repository[],
): string {
  if (node.nodeType === "project" && node.projectId) {
    const project = projects.find((item) => item.id === node.projectId);
    if (!project) return "";
    return resolveProjectExplorerOpenPath(project, repositories);
  }
  if (node.nodeType === "repo" && node.repositoryId != null) {
    return repositories.find((item) => item.id === node.repositoryId)?.path.trim() ?? "";
  }
  return "";
}

export function parseWorkspaceRepositoryTreeValue(raw: string): WorkspaceRepositoryTreeSelection | null {
  if (raw.startsWith("repo:")) {
    const repositoryId = Number(raw.slice("repo:".length));
    if (!Number.isFinite(repositoryId)) return null;
    return { kind: "repository", repositoryId };
  }
  if (raw.startsWith("project:")) {
    const projectId = raw.slice("project:".length).trim();
    if (!projectId) return null;
    return { kind: "project", projectId };
  }
  return null;
}

export function globalWorkspaceToTreeSelection(input: {
  activeWorkspaceFocus: WorkspaceFocus;
  activeProjectId: string | null;
  activeRepositoryId: number | null;
}): WorkspaceRepositoryTreeSelection | null {
  if (input.activeWorkspaceFocus === "project" && input.activeProjectId) {
    return { kind: "project", projectId: input.activeProjectId };
  }
  if (input.activeRepositoryId != null) {
    return { kind: "repository", repositoryId: input.activeRepositoryId };
  }
  return null;
}

export interface WorkspaceRepositoryTreeSelectionView {
  selection: WorkspaceRepositoryTreeSelection;
  path: string;
  label: string;
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  activeWorkspaceFocus: WorkspaceFocus;
}

/** 将树选择解析为文件树展示路径与选择器高亮状态（不触发全局工作区切换）。 */
export function resolveWorkspaceRepositoryTreeSelectionView(
  selection: WorkspaceRepositoryTreeSelection,
  projects: readonly ProjectItem[],
  repositories: readonly Repository[],
): WorkspaceRepositoryTreeSelectionView | null {
  if (selection.kind === "project") {
    const project = projects.find((item) => item.id === selection.projectId);
    if (!project) return null;
    const path = resolveProjectExplorerOpenPath(project, repositories);
    const firstRepoId = project.repositoryIds?.[0];
    const firstRepo =
      firstRepoId != null ? (repositories.find((item) => item.id === firstRepoId) ?? null) : null;
    return {
      selection,
      path,
      label: formatWorkspaceRepositoryContextLabel(project, firstRepo, {
        workspaceFocus: "project",
      }),
      activeProjectId: project.id,
      activeRepositoryId: firstRepoId ?? null,
      activeWorkspaceFocus: "project",
    };
  }

  const repository = repositories.find((item) => item.id === selection.repositoryId);
  if (!repository) return null;
  const project = findProjectOwningRepository(projects, repository.id);
  return {
    selection,
    path: repository.path.trim(),
    label: formatWorkspaceRepositoryContextLabel(project, repository, {
      workspaceFocus: "repository",
    }),
    activeProjectId: project?.id ?? null,
    activeRepositoryId: repository.id,
    activeWorkspaceFocus: "repository",
  };
}
