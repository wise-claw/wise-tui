import { invoke } from "@tauri-apps/api/core";
import { trackAsyncOperation } from "../stores/operationWatchdogStore";
import {
  GIT_COMMIT_TIMEOUT_MS,
  GIT_FETCH_TIMEOUT_MS,
  GIT_PULL_TIMEOUT_MS,
  GIT_PUSH_TIMEOUT_MS,
  GIT_STAGE_TIMEOUT_MS,
  GIT_STATUS_TIMEOUT_MS,
} from "./gitOperationTimeouts";
import {
  WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED,
  type RepoWorktreesMayHaveChangedDetail,
} from "../constants/workflowUiEvents";
import type {
  GitStatusResponse,
  GitStatusSummaryResponse,
  GitLogResponse,
  GitGraphResponse,
  GitCommitDetailResponse,
  GitCompareCommitsResponse,
  GitBlameFileResponse,
  GitBranchEntry,
  GitWorktreeEntry,
  GitWorktreeAddOmcBatchResult,
  GitFlowInfo,
} from "../types";

export async function gitStatus(path: string): Promise<GitStatusResponse> {
  return trackAsyncOperation(
    "读取 Git 状态",
    invoke<GitStatusResponse>("git_status", { path }),
    GIT_STATUS_TIMEOUT_MS,
  );
}

export async function gitStatusSummary(path: string): Promise<GitStatusSummaryResponse> {
  return trackAsyncOperation(
    "读取 Git 状态",
    invoke<GitStatusSummaryResponse>("git_status_summary", { path }),
    GIT_STATUS_TIMEOUT_MS,
  );
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
  return trackAsyncOperation(
    "暂存",
    invoke("git_stage_all", { path }),
    GIT_STAGE_TIMEOUT_MS,
  );
}

export async function gitUnstage(path: string, filePath: string): Promise<void> {
  return invoke("git_unstage", { path, filePath });
}

export async function gitUnstageAll(path: string): Promise<void> {
  return invoke("git_unstage_all", { path });
}

export async function gitCommit(path: string, message: string): Promise<string> {
  return trackAsyncOperation(
    "提交",
    invoke<string>("git_commit", { path, message }),
    GIT_COMMIT_TIMEOUT_MS,
  );
}

export async function gitPush(path: string): Promise<void> {
  return trackAsyncOperation("推送", invoke("git_push", { path }), GIT_PUSH_TIMEOUT_MS);
}

export async function gitPull(path: string): Promise<void> {
  return trackAsyncOperation("拉取", invoke("git_pull", { path }), GIT_PULL_TIMEOUT_MS);
}

export async function gitFetch(path: string): Promise<void> {
  return trackAsyncOperation("拉取远程", invoke("git_fetch", { path }), GIT_FETCH_TIMEOUT_MS);
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

export type GitResetMode = "soft" | "mixed" | "hard";

export async function gitGraph(
  path: string,
  limit: number,
  skip = 0,
  branchFilter?: string | null,
  searchQuery?: string | null,
  authorFilter?: string | null,
): Promise<GitGraphResponse> {
  return invoke<GitGraphResponse>("git_graph", {
    path,
    limit,
    skip,
    branchFilter: branchFilter?.trim() ? branchFilter.trim() : null,
    searchQuery: searchQuery?.trim() ? searchQuery.trim() : null,
    authorFilter: authorFilter?.trim() ? authorFilter.trim() : null,
  });
}

export async function gitCommitDetail(
  path: string,
  sha: string,
): Promise<GitCommitDetailResponse> {
  return invoke<GitCommitDetailResponse>("git_commit_detail", { path, sha });
}

export async function gitCompareCommits(
  path: string,
  baseSha: string,
  headSha: string,
): Promise<GitCompareCommitsResponse> {
  return invoke<GitCompareCommitsResponse>("git_compare_commits", { path, baseSha, headSha });
}

export async function gitCreateTag(
  path: string,
  sha: string,
  tagName: string,
  message?: string | null,
): Promise<void> {
  return invoke<void>("git_create_tag", {
    path,
    sha,
    tagName,
    message: message?.trim() ? message.trim() : null,
  });
}

/** 推送单个 tag 到指定远端（默认 origin），与 `gitCreateTag` 组合使用于"创建即推送"场景。
 *  `force` 为 true 时使用 `--force`，可覆盖远端同名 tag；否则远端 tag 已存在会被 [rejected]。 */
export async function gitPushTag(
  path: string,
  tagName: string,
  remote: string = "origin",
  force: boolean = false,
): Promise<void> {
  return trackAsyncOperation(
    "推送标签",
    invoke<void>("git_push_tag", { path, tagName, remote, force }),
    GIT_PUSH_TIMEOUT_MS,
  );
}

export async function gitDeleteTag(path: string, tagName: string): Promise<void> {
  return invoke<void>("git_delete_tag", { path, tagName });
}

export async function gitBlameFile(
  path: string,
  revision: string,
  filePath: string,
): Promise<GitBlameFileResponse> {
  return invoke<GitBlameFileResponse>("git_blame_file", {
    path,
    revision,
    filePath,
  });
}

export async function gitCheckoutRevision(path: string, revision: string): Promise<void> {
  return invoke<void>("git_checkout_revision", { path, revision });
}

export async function gitCherryPick(path: string, sha: string): Promise<void> {
  return invoke<void>("git_cherry_pick", { path, sha });
}

export async function gitRevert(path: string, sha: string): Promise<void> {
  return invoke<void>("git_revert", { path, sha });
}

export async function gitReset(path: string, revision: string, mode: GitResetMode): Promise<void> {
  return invoke<void>("git_reset", { path, revision, mode });
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

export async function gitDeleteBranch(
  path: string,
  branchName: string,
  force = false,
): Promise<void> {
  return invoke<void>("git_delete_branch", { path, branchName, force });
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

// ── Git Flow Operations ──

export async function gitFlowInfo(path: string): Promise<GitFlowInfo> {
  return invoke<GitFlowInfo>("git_flow_info", { path });
}

export async function gitFlowInit(path: string): Promise<string> {
  return invoke<string>("git_flow_init", { path });
}

export async function gitFlowFeatureStart(path: string, name: string): Promise<void> {
  return invoke<void>("git_flow_feature_start", { path, name });
}

export async function gitFlowFeatureFinish(path: string, name: string): Promise<void> {
  return invoke<void>("git_flow_feature_finish", { path, name });
}

export async function gitFlowReleaseStart(path: string, version: string): Promise<void> {
  return invoke<void>("git_flow_release_start", { path, version });
}

export async function gitFlowReleaseFinish(path: string, version: string): Promise<void> {
  return invoke<void>("git_flow_release_finish", { path, version });
}

export async function gitFlowHotfixStart(path: string, version: string): Promise<void> {
  return invoke<void>("git_flow_hotfix_start", { path, version });
}

export async function gitFlowHotfixFinish(path: string, version: string): Promise<void> {
  return invoke<void>("git_flow_hotfix_finish", { path, version });
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
