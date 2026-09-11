import {
  WISE_GIT_REPOSITORY_STATUS_REFRESH,
  type GitRepositoryStatusRefreshDetail,
} from "../constants/gitUiEvents";
import { invalidateGitStatus } from "./gitStatusWarmCache";
import { refreshGitRepositoryExplorerStatus } from "../stores/gitRepositoryExplorerStatusStore";

/** 通知已挂载的 Git 面板刷新变更列表（不发起 IPC，由面板自行 loadStatus）。 */
export function requestGitRepositoryPanelStatusRefresh(repositoryPath: string): void {
  const path = repositoryPath.trim();
  if (!path || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GitRepositoryStatusRefreshDetail>(WISE_GIT_REPOSITORY_STATUS_REFRESH, {
      detail: { path },
    }),
  );
}

/** 本地文件变更后：丢弃旧 Git 状态并刷新文件树装饰、HUD 统计与 Git 面板。 */
export function refreshGitRepositoryUi(repositoryPath: string): void {
  const path = repositoryPath.trim();
  if (!path) return;
  invalidateGitStatus(path);
  refreshGitRepositoryExplorerStatus(path);
  requestGitRepositoryPanelStatusRefresh(path);
}
