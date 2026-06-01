import { invoke } from "@tauri-apps/api/core";
import {
  WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED,
  type RepoWorktreesMayHaveChangedDetail,
} from "../constants/workflowUiEvents";
import type {
  GitStatusResponse,
  GitStatusSummaryResponse,
  GitLogResponse,
  GitBranchEntry,
  GitWorktreeEntry,
  GitWorktreeAddOmcBatchResult,
} from "../types";

export async function gitStatus(path: string): Promise<GitStatusResponse> {
  return invoke<GitStatusResponse>("git_status", { path });
}

export async function gitStatusSummary(path: string): Promise<GitStatusSummaryResponse> {
  return invoke<GitStatusSummaryResponse>("git_status_summary", { path });
}

export async function gitStage(path: string, filePath: string): Promise<void> {
  return invoke("git_stage", { path, filePath });
}

/** 按路径/目录批量暂存（目录在后端展开为 `dir/**`，单次 IPC）。 */
export async function gitStagePaths(path: string, filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) {
    return;
  }
  return invoke("git_stage_paths", { path, filePaths });
}

/** 一次性暂存全部未提交改动（单次 IPC，适合大量文件）。 */
export async function gitStageAll(path: string): Promise<void> {
  return invoke("git_stage_all", { path });
}

export async function gitUnstage(path: string, filePath: string): Promise<void> {
  return invoke("git_unstage", { path, filePath });
}

export async function gitUnstageAll(path: string): Promise<void> {
  return invoke("git_unstage_all", { path });
}

export async function gitCommit(path: string, message: string): Promise<string> {
  return invoke<string>("git_commit", { path, message });
}

export async function gitPush(path: string): Promise<void> {
  return invoke("git_push", { path });
}

export async function gitPull(path: string): Promise<void> {
  return invoke("git_pull", { path });
}

export async function gitFetch(path: string): Promise<void> {
  return invoke("git_fetch", { path });
}

/** `git show` 指定版本路径（如 `HEAD:foo/bar`、`:foo/bar` 索引）；非桌面或失败时返回空串。 */
export async function gitShowRevision(repositoryPath: string, revisionPath: string): Promise<string> {
  try {
    return await invoke<string>("git_show_revision", { repositoryPath, revisionPath });
  } catch {
    return "";
  }
}

export async function gitDiscard(path: string, filePath: string): Promise<void> {
  return invoke("git_discard", { path, filePath });
}

export async function gitDiscardAll(path: string): Promise<void> {
  return invoke("git_discard_all", { path });
}

export async function gitLog(
  path: string,
  limit: number,
  skip = 0,
): Promise<GitLogResponse> {
  return invoke<GitLogResponse>("git_log", { path, limit, skip });
}

export async function gitInit(path: string): Promise<string> {
  return invoke<string>("git_init", { path });
}

/** 在父目录下创建空文件夹（尚未 `git init`）。 */
export async function prepareEmptyRepositoryDir(
  parentPath: string,
  folderName: string,
): Promise<string> {
  return invoke<string>("prepare_empty_repository_dir", { parentPath, folderName });
}

/** 在父目录下 `git clone`，返回克隆后的仓库绝对路径。 */
export async function gitCloneRepository(
  parentPath: string,
  url: string,
  folderName?: string,
): Promise<string> {
  return invoke<string>("git_clone_repository", {
    parentPath,
    url,
    folderName: folderName?.trim() ? folderName.trim() : null,
  });
}

export async function gitRemoteUrl(path: string): Promise<string | null> {
  return invoke<string | null>("git_remote_url", { path });
}

export async function gitListBranches(path: string): Promise<GitBranchEntry[]> {
  return invoke<GitBranchEntry[]>("git_list_branches", { path });
}

export async function gitCheckoutBranch(path: string, branchName: string): Promise<void> {
  return invoke<void>("git_checkout_branch", { path, branchName });
}

export async function gitCreateBranch(
  path: string,
  branchName: string,
  fromRef?: string | null,
  checkout = true,
  noTrack = true,
): Promise<void> {
  return invoke<void>("git_create_branch", {
    path,
    branchName,
    fromRef: fromRef ?? null,
    checkout,
    noTrack,
  });
}

export async function gitWorktreeList(path: string): Promise<GitWorktreeEntry[]> {
  try {
    return await invoke<GitWorktreeEntry[]>("git_worktree_list", { path });
  } catch {
    return [];
  }
}

export async function gitWorktreeRemove(repoPath: string, worktreePath: string): Promise<void> {
  return invoke<void>("git_worktree_remove", { path: repoPath, worktreePath });
}

/** 在仓库上一级 `wise-worktrees/` 创建独立 worktree 并检出新分支（供批量 OMC / 工作流 OMC 使用）。 */
export async function gitWorktreeAddOmcBatch(
  repoPath: string,
  taskId: string,
  attempt: number,
): Promise<GitWorktreeAddOmcBatchResult> {
  const result = await invoke<GitWorktreeAddOmcBatchResult>("git_worktree_add_omc_batch", {
    repoPath,
    taskId,
    attempt: Math.max(0, Math.floor(attempt)),
  });
  const trimmed = repoPath.trim();
  if (trimmed) {
    const detail: RepoWorktreesMayHaveChangedDetail = { repositoryPath: trimmed };
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED, { detail }),
      );
    });
  }
  return result;
}

export async function startGitWatcher(paths: string | string[]): Promise<void> {
  const normalized = (Array.isArray(paths) ? paths : [paths])
    .map((item) => item.trim())
    .filter(Boolean);
  if (normalized.length === 0) return;
  return invoke("start_git_watcher", { paths: normalized });
}

export async function stopGitWatcher(): Promise<void> {
  return invoke("stop_git_watcher");
}
