import { invoke } from "@tauri-apps/api/core";

/** 读取仓库根目录下的相对路径 UTF-8 文件（由 Tauri 侧做路径安全校验）。 */
export async function readProjectRelativeFile(repositoryPath: string, relativePath: string): Promise<string> {
  return invoke<string>("read_project_relative_file", {
    projectPath: repositoryPath,
    relativePath,
  });
}

export interface ProjectRelativeFileText {
  content: string;
  byteLen: number;
}

/**
 * 仓库文件编辑器专用读取：超过 4MiB 由后端拒绝，避免多 MB 正文整包 IPC。
 * 错误信息含「4MB 编辑器上限」时可引导用户用系统应用打开。
 */
export async function readProjectRelativeFileForEditor(
  repositoryPath: string,
  relativePath: string,
): Promise<ProjectRelativeFileText> {
  return invoke<ProjectRelativeFileText>("read_project_relative_file_for_editor", {
    projectPath: repositoryPath,
    relativePath,
  });
}

/** 是否为编辑器封顶读拒绝（文件过大）。 */
export function isEditorFileTooLargeError(error: unknown): boolean {
  let msg = "";
  if (error instanceof Error) msg = error.message;
  else if (typeof error === "string") msg = error;
  else if (typeof error === "object" && error !== null) {
    const maybe = (error as { message?: unknown }).message;
    if (typeof maybe === "string") msg = maybe;
    else msg = String(error);
  } else {
    msg = String(error ?? "");
  }
  return msg.includes("4MB 编辑器上限") || msg.includes("超过 4MB");
}

/** 读取仓库内文件的原始字节（Base64），用于图片预览等不受 asset protocol scope 限制的场景。 */
export async function readProjectRelativeFileBase64(
  repositoryPath: string,
  relativePath: string,
): Promise<string> {
  return invoke<string>("read_project_relative_file_base64", {
    projectPath: repositoryPath,
    relativePath,
  });
}

/** 列出仓库内相对目录下的文件名（单层，不递归）。 */
export async function listProjectRelativeDirectory(
  repositoryPath: string,
  relativePath: string,
): Promise<string[]> {
  return invoke<string[]>("list_project_relative_directory", {
    projectPath: repositoryPath,
    relativePath,
  });
}

/** 覆盖写入仓库根目录下相对路径 UTF-8 文件（由 Tauri 侧做路径安全校验）。 */
export async function writeProjectRelativeFile(
  repositoryPath: string,
  relativePath: string,
  payload: string,
): Promise<void> {
  return invoke<void>("write_project_relative_file", {
    projectPath: repositoryPath,
    relativePath,
    payload,
  });
}

/** 向仓库 `.wise/` 下相对路径文件追加 UTF-8 内容。 */
export async function appendProjectRelativeFile(
  repositoryPath: string,
  relativePath: string,
  payload: string,
): Promise<void> {
  return invoke<void>("append_project_relative_file", {
    projectPath: repositoryPath,
    relativePath,
    payload,
  });
}

/** 读取 `~/.wise` 下的相对路径 UTF-8 文件。 */
export async function readWiseRelativeFile(relativePath: string): Promise<string> {
  return invoke<string>("read_wise_relative_file", {
    relativePath,
  });
}

/** 向 `~/.wise` 下的相对路径文件追加 UTF-8 内容。 */
export async function appendWiseRelativeFile(relativePath: string, payload: string): Promise<void> {
  return invoke<void>("append_wise_relative_file", {
    relativePath,
    payload,
  });
}
