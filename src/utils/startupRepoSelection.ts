import type { ProjectItem, Repository } from "../types";
import { selectFloatingRepositories } from "./floatingRepositories";
import type { WorkspaceFocus } from "./workspaceMode";

export const WORKSPACE_LAST_SESSION_REPO_ID_STORAGE_KEY =
  "wise.workspace.lastSessionRepoId.v1";

/** 侧栏工作区/仓库选中态（含焦点粒度），用于刷新后恢复。 */
export const WORKSPACE_LAST_SELECTION_STORAGE_KEY = "wise.workspace.lastSelection.v1";

const WORKSPACE_WINDOW_SELECTION_KEY_PREFIX = "wise.workspace.windowSelection.v1:";

/** 辅助主窗口侧栏选中态（按窗口 label 隔离，不污染主窗全局键）。 */
export function workspaceWindowSelectionStorageKey(windowLabel: string): string {
  const safe = windowLabel.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${WORKSPACE_WINDOW_SELECTION_KEY_PREFIX}${safe}`;
}

export interface WorkspaceLastSelection {
  focus: WorkspaceFocus;
  projectId: string | null;
  repositoryId: number | null;
}

export function parseWorkspaceLastSelection(raw: string | null): WorkspaceLastSelection | null {
  if (raw == null || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const focus = record.focus;
    if (focus !== "project" && focus !== "repository") return null;
    const projectId =
      typeof record.projectId === "string" && record.projectId.trim()
        ? record.projectId.trim()
        : null;
    let repositoryId: number | null = null;
    const repositoryIdRaw = record.repositoryId;
    if (typeof repositoryIdRaw === "number" && Number.isInteger(repositoryIdRaw) && repositoryIdRaw > 0) {
      repositoryId = repositoryIdRaw;
    } else if (typeof repositoryIdRaw === "string") {
      const trimmed = repositoryIdRaw.trim();
      if (/^\d+$/.test(trimmed)) {
        repositoryId = Number(trimmed);
      }
    }
    return { focus, projectId, repositoryId };
  } catch {
    return null;
  }
}

export interface StartupSelectionInput {
  /** v1 结构化选中态；优先于 legacy lastSessionRepoId。 */
  lastSelection: WorkspaceLastSelection | null;
  /** legacy：上一次活跃的 repo id；首次启动 / 缺失时为 null。 */
  lastSessionRepoId: number | null;
  /** 已按 pin 顺序排序的项目列表（与侧栏渲染顺序一致）。 */
  projects: ReadonlyArray<ProjectItem>;
  /** 已加载的全部仓库。 */
  repositories: ReadonlyArray<Repository>;
}

export interface StartupSelection {
  /** 启动后侧栏选中的 repo；工作区焦点下为 null。 */
  repositoryId: number | null;
  /** 启动后激活的 owner project；游离 repo 或空状态下为 null。 */
  projectId: string | null;
  workspaceFocus: WorkspaceFocus;
  /** lastSessionRepoId 指向已删除 repo 时为 true，调用方应清理该 setting。 */
  shouldClearLastSession: boolean;
}

/**
 * 根据持久化选中态 + 项目/仓库快照决定启动时侧栏首项。
 *
 * 优先级：
 * 1. lastSelection.focus === project 且 projectId 有效 → 恢复工作区焦点，不选成员仓
 * 2. lastSelection.focus === repository 且 repositoryId 有效 → 恢复该 repo
 * 3. legacy lastSessionRepoId 命中现存 repo → 恢复该 repo（repository 焦点）
 * 4. legacy 无效或缺失 → 首项策略（repository 焦点）
 */
export function resolveStartupSelection(
  input: StartupSelectionInput,
): StartupSelection {
  const { lastSelection, lastSessionRepoId, projects, repositories } = input;

  if (lastSelection?.focus === "project" && lastSelection.projectId) {
    const project = projects.find((item) => item.id === lastSelection.projectId);
    if (project) {
      return {
        repositoryId: null,
        projectId: project.id,
        workspaceFocus: "project",
        shouldClearLastSession: false,
      };
    }
  }

  if (lastSelection?.focus === "repository" && lastSelection.repositoryId != null) {
    const matched = repositories.find((repo) => repo.id === lastSelection.repositoryId);
    if (matched) {
      const owner = projects.find((p) => p.repositoryIds.includes(matched.id));
      return {
        repositoryId: matched.id,
        projectId: owner?.id ?? null,
        workspaceFocus: "repository",
        shouldClearLastSession: false,
      };
    }
  }

  if (lastSessionRepoId != null) {
    const matched = repositories.find((repo) => repo.id === lastSessionRepoId);
    if (matched) {
      const owner = projects.find((p) => p.repositoryIds.includes(matched.id));
      return {
        repositoryId: matched.id,
        projectId: owner?.id ?? null,
        workspaceFocus: "repository",
        shouldClearLastSession: false,
      };
    }
    const fallback = pickFirstItem(projects, repositories);
    return {
      repositoryId: fallback.repositoryId,
      projectId: fallback.projectId,
      workspaceFocus: "repository",
      shouldClearLastSession: true,
    };
  }

  const fallback = pickFirstItem(projects, repositories);
  return {
    repositoryId: fallback.repositoryId,
    projectId: fallback.projectId,
    workspaceFocus: "repository",
    shouldClearLastSession: false,
  };
}

function pickFirstItem(
  projects: ReadonlyArray<ProjectItem>,
  repositories: ReadonlyArray<Repository>,
): Pick<StartupSelection, "repositoryId" | "projectId"> {
  const floating = selectFloatingRepositories(projects, repositories);
  if (floating.length > 0) {
    return { repositoryId: floating[0].id, projectId: null };
  }
  for (const project of projects) {
    const firstId = project.repositoryIds.find((id) =>
      repositories.some((repo) => repo.id === id),
    );
    if (firstId != null) {
      return { repositoryId: firstId, projectId: project.id };
    }
  }
  return { repositoryId: null, projectId: null };
}
