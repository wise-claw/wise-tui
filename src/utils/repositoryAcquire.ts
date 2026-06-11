/** 关联仓库 / 添加单仓：磁盘路径获取方式。 */
export type RepositoryAcquireMode = "pick_existing" | "create_empty" | "git_clone";

export interface RepositoryAcquireParams {
  mode: RepositoryAcquireMode;
  /** `pick_existing`：用户填写的已有仓库绝对路径；有值时跳过目录选择器。 */
  existingPath?: string;
  /** `create_empty` / `git_clone`：父目录绝对路径。 */
  parentPath?: string;
  /** `create_empty` / `git_clone`：在父目录下创建的文件夹名。 */
  folderName?: string;
  /** `git_clone`：远程仓库地址。 */
  gitUrl?: string;
}

const FOLDER_NAME_RE = /^[^/\\]+$/;

export function isValidRepositoryFolderName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return false;
  return FOLDER_NAME_RE.test(trimmed);
}

/** 从 Git URL 推断默认克隆目录名（去掉 `.git` 与尾部斜杠）。 */
export function deriveFolderNameFromGitUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "repository";
  const withoutGit = trimmed.replace(/\.git$/i, "");
  const parts = withoutGit.split(/[/:]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return last.length > 0 ? last : "repository";
}

export function normalizeRepositoryAcquireParams(
  raw: RepositoryAcquireParams | undefined,
): RepositoryAcquireParams {
  if (!raw?.mode) return { mode: "pick_existing" };
  return raw;
}

export function validateRepositoryAcquireParams(
  acquire: RepositoryAcquireParams,
): string | null {
  if (acquire.mode === "pick_existing") return null;
  const parent = acquire.parentPath?.trim() ?? "";
  if (!parent) return "请选择父目录";
  if (acquire.mode === "create_empty") {
    const folder = acquire.folderName?.trim() ?? "";
    if (!isValidRepositoryFolderName(folder)) {
      return "请填写有效的仓库文件夹名（不含 / 或 \\）";
    }
    return null;
  }
  if (acquire.mode === "git_clone") {
    const url = acquire.gitUrl?.trim() ?? "";
    if (!url) return "请填写 Git 仓库地址";
    const folder = acquire.folderName?.trim() ?? "";
    if (folder && !isValidRepositoryFolderName(folder)) {
      return "目标文件夹名无效（不含 / 或 \\）";
    }
    return null;
  }
  return null;
}
