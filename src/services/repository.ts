import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AddRepositoryOptions,
  ProjectItem,
  ProjectSddMode,
  Repository,
  SddMode,
} from "../types";

/**
 * Open native folder picker dialog.
 * Returns selected directory path, or null if user cancelled.
 */
export async function pickFolder(): Promise<string | null> {
  try {
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string") return result;
    if (Array.isArray(result)) {
      const arr = result as string[];
      if (arr.length > 0) return arr[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a new repository entry from a selected folder path.
 */
export async function createRepositoryFromPath(folderPath: string): Promise<Repository> {
  return invoke<Repository>("create_repository_from_path", {
    folderPath,
    repositoryType: "frontend",
    iconDisplayName: null,
    iconColor: null,
  });
}

export async function createRepositoryFromPathWithType(
  folderPath: string,
  repositoryType: Repository["repositoryType"],
  options?: AddRepositoryOptions,
): Promise<Repository> {
  const iconDisplayName = options?.iconDisplayName?.trim();
  const iconColor = options?.iconColor?.trim();
  const repository = await invoke<Repository>("create_repository_from_path", {
    folderPath,
    repositoryType,
    iconDisplayName: iconDisplayName && iconDisplayName.length > 0 ? iconDisplayName : null,
    iconColor: iconColor && iconColor.length > 0 ? iconColor : null,
  });
  if (options?.sddMode && options.sddMode !== "auto") {
    return updateRepositorySddMode(repository.id, options.sddMode);
  }
  return repository;
}

export async function updateRepositoryIconDisplay(
  id: number,
  iconDisplayName: string | null,
): Promise<Repository> {
  const trimmed = iconDisplayName?.trim();
  return invoke<Repository>("update_repository_icon_display", {
    id,
    iconDisplayName: trimmed && trimmed.length > 0 ? trimmed : null,
  });
}

export async function updateRepositoryMainOwnerAgent(
  id: number,
  mainOwnerAgentName: string | null,
): Promise<Repository> {
  const trimmed = mainOwnerAgentName?.trim();
  return invoke<Repository>("update_repository_main_owner_agent", {
    id,
    mainOwnerAgentName: trimmed && trimmed.length > 0 ? trimmed : null,
  });
}

export async function updateRepositorySddMode(
  id: number,
  sddMode: SddMode | null,
): Promise<Repository> {
  const allowed: SddMode[] = ["auto", "wise_trellis", "project_owned", "off"];
  if (sddMode !== null && !allowed.includes(sddMode)) {
    throw new Error(`WF_INVALID_INPUT: sddMode value not allowed: ${sddMode}`);
  }
  return invoke<Repository>("update_repository_sdd_mode", { id, sddMode });
}

/** 写入仓库的多角色标签数组。后端会去空白、去重、按 32 字符限制校验。 */
export async function updateRepositoryRoleTags(
  id: number,
  roleTags: ReadonlyArray<string>,
): Promise<Repository> {
  const normalized = Array.from(
    new Set(roleTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)),
  );
  return invoke<Repository>("update_repository_role_tags", {
    id,
    roleTags: normalized,
  });
}

/** 写入项目根目录绝对路径（持有 `.trellis/`）。空串会被后端拒绝。 */
export async function updateProjectRootPath(
  projectId: string,
  rootPath: string,
): Promise<ProjectItem> {
  return invoke<ProjectItem>("update_project_root_path", {
    projectId,
    rootPath: rootPath.trim(),
  });
}

/** 写入项目级 SDD 模式。 */
export async function updateProjectSddMode(
  projectId: string,
  sddMode: ProjectSddMode,
): Promise<ProjectItem> {
  const allowed: ProjectSddMode[] = ["wise_trellis", "project_owned"];
  if (!allowed.includes(sddMode)) {
    throw new Error(`WF_INVALID_INPUT: project sddMode not allowed: ${sddMode}`);
  }
  return invoke<ProjectItem>("update_project_sdd_mode", { projectId, sddMode });
}

/** 写入项目级主会话 Agent。传 null 清空。 */
export async function updateProjectMainAgent(
  projectId: string,
  mainAgent: string | null,
): Promise<ProjectItem> {
  const trimmed = mainAgent?.trim();
  return invoke<ProjectItem>("update_project_main_agent", {
    projectId,
    mainAgent: trimmed && trimmed.length > 0 ? trimmed : null,
  });
}

/**
 * Load all saved repositories from persistent storage.
 */
export async function loadRepositories(): Promise<Repository[]> {
  try {
    return invoke<Repository[]>("list_repositories");
  } catch {
    return [];
  }
}

/**
 * Remove a repository by its id.
 */
export async function removeRepository(id: number): Promise<void> {
  return invoke("remove_repository_global", { id });
}

/**
 * Open a path in the system file explorer (Finder on macOS).
 */
export async function openInFinder(path: string): Promise<void> {
  return invoke("open_in_finder", { path });
}

/**
 * Open a repository path with a specific application or command.
 */
export async function openWorkspaceIn(
  path: string,
  options: {
    appName?: string;
    command?: string;
    args?: string[];
    /** 与 VS Code / Cursor CLI `-g` 一致：1-based 行、列；仅对 `code`/`cursor`/`codium` 命令生效 */
    gotoLine?: number;
    gotoColumn?: number;
  },
): Promise<void> {
  return invoke("open_workspace_in", {
    path,
    appName: options.appName ?? null,
    command: options.command ?? null,
    args: options.args ?? [],
    gotoLine: options.gotoLine ?? null,
    gotoColumn: options.gotoColumn ?? null,
  });
}
