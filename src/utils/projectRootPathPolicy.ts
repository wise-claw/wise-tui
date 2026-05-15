/**
 * 前端侧「仓库路径是否落在项目根下」的启发式判定（与后端 canonical 结果在常见布局下应一致）。
 * 最终准入以后端 `add_repository_to_project` / `reconcile_project_workspace` 为准。
 */
export function isRepositoryPathUnderProjectRoot(projectRoot: string, repositoryPath: string): boolean {
  const r = projectRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const c = repositoryPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!r || !c) return false;
  if (r === c) return true;
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return c.startsWith(prefix);
}
