/** 请求 Git 面板（DiffMode 变更列表）刷新指定仓库的 status。 */
export const WISE_GIT_REPOSITORY_STATUS_REFRESH = "wise:git-repository-status-refresh";

export interface GitRepositoryStatusRefreshDetail {
  path: string;
}
