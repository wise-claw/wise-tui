import {
  WISE_GIT_REPOSITORY_STATUS_REFRESH,
  type GitRepositoryStatusRefreshDetail,
} from "../constants/gitUiEvents";
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

/** 文件保存等本地写盘后：同步刷新文件树 Git 装饰与 Git 面板变更列表。 */
export function refreshGitRepositoryUi(repositoryPath: string): void {
  const path = repositoryPath.trim();
  if (!path) return;
  refreshGitRepositoryExplorerStatus(path);
  requestGitRepositoryPanelStatusRefresh(path);
}
