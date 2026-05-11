import { invoke } from "@tauri-apps/api/core";

export interface MaterializePrdSnapshotResult {
  runId: string;
  prdRelativePath: string;
  splitRelativePath: string | null;
  requirementsIndexRelativePath: string | null;
  splitMappingRelativePath: string | null;
}

export interface PrdSnapshotMetaInput {
  policyId?: string | null;
  policyFeatures?: Record<string, number | string | boolean> | null;
  routerRationale?: string[] | null;
}

/** 将 PRD Markdown 中的本地插图复制到 `~/.wise/prd-runs/<runId>/assets/`，并重写为绝对路径，供 Claude Code `@` 引用。 */
export async function materializePrdSnapshot(
  repositoryPath: string,
  prdMarkdown: string,
  splitMarkdown: string | null,
  runId?: string | null,
  requirementsIndexJson?: string | null,
  snapshotMeta?: PrdSnapshotMetaInput | null,
): Promise<MaterializePrdSnapshotResult> {
  return invoke<MaterializePrdSnapshotResult>("materialize_prd_snapshot", {
    projectPath: repositoryPath,
    prdMarkdown,
    splitMarkdown,
    runId: runId ?? null,
    requirementsIndexJson: requirementsIndexJson ?? null,
    snapshotMetaJson: snapshotMeta ? JSON.stringify(snapshotMeta) : null,
  });
}

/** 读取仓库根目录下的相对路径 UTF-8 文件（由 Tauri 侧做路径安全校验）。 */
export async function readProjectRelativeFile(repositoryPath: string, relativePath: string): Promise<string> {
  return invoke<string>("read_project_relative_file", {
    projectPath: repositoryPath,
    relativePath,
  });
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

/** 读取 `~/.wise/prd-runs` 下的快照文件（绝对路径）。 */
export async function readSnapshotFile(absolutePath: string): Promise<string> {
  return invoke<string>("read_snapshot_file", {
    filePath: absolutePath,
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
